// TCV-7191: read test case review feedback (status, people, comments, case links).
// Reviews live on test case revisions. A rejected edit can restore an earlier version
// without a review, so project lists also look up the latest historical review when the
// current revision has none. Keep those reads scoped to case IDs, never all project revisions.
import { z } from "zod";
import type { TestCollabApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";
import { handleTool, listAll, relationId, type ApiRecord } from "../test-plans/shared.js";
import { idSchema } from "../test-plans/schemas.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Bound each page's work even when most cases have never been reviewed.
const CASE_SCAN_WINDOW = 100;
const REVIEW_LOOKUP_CONCURRENCY = 5;
const NO_REVIEW = 0;
const REVIEW_STATUSES: Record<number, string> = {
  1: "review_pending",
  2: "approved",
  3: "update_requested",
  4: "rejected",
};
// The local API runs on 1337 and the local app on 8080; hosted APIs use an api. or
// api-<region>. host in front of the app host.
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const LOCAL_API_PORT = "1337";
const LOCAL_APP_PORT = "8080";
const API_HOST_PREFIX = /^api(-[a-z0-9]+)?\./i;
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export const getTestCaseReviewsSchema = z.object({
  project_id: idSchema.optional().describe("Project ID; falls back to the transport's default project"),
  test_case_id: idSchema.optional().describe("Internal test case ID, not the TC- display number. Omit it to list the project's reviewed test cases"),
  include_history: z.boolean().default(false).describe("Also return the earlier review rounds of each case, newest first"),
  only_with_comments: z.boolean().default(false).describe("Project list only: keep cases whose latest review has at least one comment"),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(`Project list only: cases per page (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
  offset: z.number().int().min(0).default(0).describe("Project list only: position to start from; pass nextOffset from the previous page"),
}).strict();

type ReviewsInput = z.infer<typeof getTestCaseReviewsSchema>;

export const getTestCaseReviewsTool = {
  name: "get_test_case_reviews",
  description: `Read test case review feedback: status (review_pending, approved, update_requested, rejected), author, reviewer or reviewer group, review comments as plain text, and a link to each case.
Without test_case_id, lists the project's cases with a review, including rejected edits whose earlier version was restored, most recently updated first. totalCases counts all visible cases, not just reviewed cases. Each call checks up to 100 cases; a page can be empty or hold fewer than limit results while nextOffset is set. Pass nextOffset back as offset until it is null.
With test_case_id, returns that case and its latest review, even when the case changed after that review (isCurrentRevision false), for example when a rejected edit restored the earlier version.
Set include_history to add earlier review rounds, newest first.
IDs are internal test case IDs, not TC- display numbers.`,
};

export function appBaseUrl(apiUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return null;
  }
  if (LOCAL_HOSTS.includes(url.hostname) && url.port === LOCAL_API_PORT) {
    return `${url.protocol}//${url.hostname}:${LOCAL_APP_PORT}`;
  }
  return API_HOST_PREFIX.test(url.hostname) ? `${url.protocol}//${url.hostname.replace(API_HOST_PREFIX, "")}` : null;
}

// Stored comments are escape()d editor HTML or plain text; the review panel shows
// unescape(comment) as HTML. Return the same content as plain text and keep link targets.
export function commentText(stored: unknown): string {
  if (typeof stored !== "string") return "";
  return unescape(stored)
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_link, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, "").trim();
      return !text || text === href ? href : `${text} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== "#") return HTML_ENTITIES[code.toLowerCase()] ?? entity;
      const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function storedComments(row: ApiRecord): ApiRecord[] {
  let comments = row.review_comments;
  if (typeof comments === "string") {
    try {
      comments = JSON.parse(comments);
    } catch {
      return [];
    }
  }
  return Array.isArray(comments) ? comments.filter(comment => comment && typeof comment === "object") : [];
}

function query(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
}

// Review rounds of the given cases, newest first. The case filter keeps the query on the
// revision table's test case index.
async function reviewRounds(client: TestCollabApiClient, projectId: number, caseIds: number[]): Promise<ApiRecord[]> {
  if (!caseIds.length) return [];
  const rows = await listAll(client, "/testcaserevisions", {
    project: projectId, review_status_gt: NO_REVIEW, filter: JSON.stringify({ testcase_in: caseIds }),
  });
  return rows.sort((a, b) => Number(b.id) - Number(a.id));
}

async function latestReviewRound(client: TestCollabApiClient, projectId: number, caseId: number): Promise<ApiRecord | undefined> {
  const rounds = await client.request<ApiRecord[]>("GET", `/testcaserevisions?${query({ project: projectId, testcase: caseId, review_status_gt: NO_REVIEW, _sort: "id:DESC", _limit: 1 })}`);
  if (!Array.isArray(rounds)) throw new Error("Invalid response from /testcaserevisions");
  return rounds[0];
}

// A grid row is the case's current revision; give it the shape of a revision record.
function fromGridRow(row: ApiRecord): ApiRecord {
  return {
    id: row.testcaserevisionid,
    revision: row.revision,
    is_head: true,
    review_status: row.review_status,
    poster: row.poster,
    reviewer: row.reviewer,
    reviewer_group: row.reviewer_group ? { id: row.reviewer_group, name: row.reviewer_group_name ?? null } : null,
    review_comments: row.review_comments,
    created_at: row.revisionCreatedAt,
    testcase: { id: row.id, title: row.title, display_number: row.display_number, under_review: row.under_review, archived: row.archived },
  };
}

async function knownUsers(client: TestCollabApiClient, projectId: number, rows: ApiRecord[]): Promise<Map<number, ApiRecord>> {
  const users = new Map<number, ApiRecord>();
  const remember = (value: unknown) => {
    if (value && typeof value === "object" && relationId(value)) users.set(relationId(value)!, value as ApiRecord);
  };
  rows.forEach(row => [row.poster, row.reviewer, row.created_by].forEach(remember));
  // Comments store only a user ID; people who are not on the revision come from the project.
  const missing = rows.some(row => storedComments(row).some(comment => relationId(comment.user) && !users.has(relationId(comment.user)!)));
  if (missing) {
    const members = await client.request<ApiRecord[]>("GET", `/projectusers?${query({ project: projectId, _limit: -1 })}`);
    if (Array.isArray(members)) members.forEach(member => remember(member.user));
  }
  return users;
}

function userRef(value: unknown, users: Map<number, ApiRecord>) {
  const id = relationId(value);
  if (!id) return null;
  const user = value && typeof value === "object" ? value as ApiRecord : users.get(id);
  return { id, name: user?.name ?? null, email: user?.email ?? null };
}

function toReview(row: ApiRecord, users: Map<number, ApiRecord>) {
  const group = row.reviewer_group;
  return {
    revision: row.revision ?? null,
    isCurrentRevision: !!row.is_head,
    status: REVIEW_STATUSES[Number(row.review_status)] ?? null,
    author: userRef(row.poster, users),
    reviewer: userRef(row.reviewer, users),
    reviewerGroup: relationId(group) ? { id: relationId(group), name: group && typeof group === "object" ? group.name ?? null : null } : null,
    createdAt: row.created_at ?? null,
    comments: storedComments(row).map(comment => {
      const author = userRef(comment.user, users);
      return { author: author && { id: author.id, name: author.name }, text: commentText(comment.comment), createdAt: comment.commented_on ?? null };
    }),
  };
}

function toCase(testCase: ApiRecord, projectId: number, appBase: string | null, latest: ApiRecord | undefined, history: ApiRecord[] | undefined, users: Map<number, ApiRecord>) {
  const id = Number(testCase.id);
  return {
    id,
    displayNumber: testCase.display_number ?? null,
    title: testCase.title ?? null,
    url: appBase ? `${appBase}/project/${projectId}/manage/test_cases/${id}` : null,
    underReview: !!testCase.under_review,
    archived: !!testCase.archived,
    latestReview: latest ? toReview(latest, users) : null,
    ...(history ? { history: history.map(row => toReview(row, users)) } : {}),
  };
}

async function getCaseReviews(client: TestCollabApiClient, projectId: number, input: ReviewsInput, appBase: string | null) {
  const caseId = input.test_case_id!;
  const rounds = input.include_history
    ? await reviewRounds(client, projectId, [caseId])
    : [await latestReviewRound(client, projectId, caseId)].filter((round): round is ApiRecord => !!round);
  const populated = rounds[0]?.testcase;
  let testCase: ApiRecord = populated && typeof populated === "object" ? populated : { id: caseId };
  if (!rounds.length) {
    // No review yet: still confirm the case and its project, and return its link.
    testCase = await client.request<ApiRecord>("GET", `/testcases/${caseId}?${query({ project: projectId })}`);
    if (Number(testCase?.id) !== caseId || relationId(testCase?.project) !== projectId) {
      throw new Error("Test case was not found in the requested project");
    }
  }
  const users = await knownUsers(client, projectId, rounds);
  const history = input.include_history ? rounds.slice(1) : undefined;
  return { testCases: [toCase(testCase, projectId, appBase, rounds[0], history, users)], nextOffset: null };
}

async function listProjectReviews(client: TestCollabApiClient, projectId: number, input: ReviewsInput, appBase: string | null) {
  // Do not filter on current Review Status: that would hide historical rejections.
  const page = await client.listTestCases({
    projectId,
    sort: [{ colId: "updated_at", sort: "desc" }, { colId: "id", sort: "desc" }],
    limit: CASE_SCAN_WINDOW,
    offset: input.offset,
  });
  const selected: Array<{ testCase: ApiRecord; latest: ApiRecord }> = [];
  let scanned = 0;
  while (scanned < page.rows.length && selected.length < input.limit) {
    // Never look ahead beyond the remaining result slots. A full page resumes at
    // precisely the first unprocessed case, including when comments are filtered.
    const batch = page.rows.slice(scanned, scanned + Math.min(REVIEW_LOOKUP_CONCURRENCY, input.limit - selected.length)) as unknown as ApiRecord[];
    const latest = await Promise.all(batch.map(row => Number(row.review_status) > NO_REVIEW
      ? Promise.resolve(fromGridRow(row))
      : latestReviewRound(client, projectId, Number(row.id))));
    for (const [index, testCase] of batch.entries()) {
      scanned++;
      const review = latest[index];
      if (!review || (input.only_with_comments && !storedComments(review).length)) continue;
      selected.push({ testCase, latest: review });
    }
  }
  const rounds = input.include_history ? await reviewRounds(client, projectId, selected.map(row => Number(row.testCase.id))) : [];
  const users = await knownUsers(client, projectId, [...selected.map(row => row.latest), ...rounds]);
  const total = Number(page.filteredCount) || 0;
  const position = input.offset + scanned;
  return {
    totalCases: total,
    testCases: selected.map(({ testCase, latest }) => {
      const caseId = Number(testCase.id);
      const history = input.include_history
        ? rounds.filter(round => relationId(round.testcase) === caseId && Number(round.id) < Number(latest.id))
        : undefined;
      return toCase(testCase, projectId, appBase, latest, history, users);
    }),
    nextOffset: scanned > 0 && position < total ? position : null,
  };
}

export async function handleGetTestCaseReviews(args: unknown) {
  return handleTool(getTestCaseReviewsSchema, args, async (input, client, projectId) => {
    const context = getRequestContext();
    const appBase = appBaseUrl(context ? context.apiUrl : getConfig().apiBaseUrl);
    return input.test_case_id
      ? getCaseReviews(client, projectId, input, appBase)
      : listProjectReviews(client, projectId, input, appBase);
  });
}
