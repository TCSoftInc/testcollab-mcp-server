// TCV-7191: exercise the review feedback handler against recorded API shapes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithContext, type RequestContext } from "../../src/context.js";
import { appBaseUrl, commentText, handleGetTestCaseReviews } from "../../src/tools/test-cases/reviews.js";
import type { ApiRecord, ToolResult } from "../../src/tools/test-plans/shared.js";

const context = { apiToken: "secret-fixture-token", apiUrl: "http://localhost:1337", defaultProjectId: 8 };
const author = { id: 5014, name: "Susan Wilson", email: "author@example.com", username: "t1" };
const reviewer = { id: 5011, name: "David Hernandez", email: "reviewer@example.com", username: "admin1" };
const reviewedCase = { id: 1724, title: "Login", display_number: 12, under_review: 0, archived: false, project: 8 };
// Case 1724: an approved round, then an edit that the reviewer rejected. The reject restored
// the approved version as revision 3, which has no review, so revision 2 is the latest review.
const rejectedEdit = {
  id: 1348, revision: 2, is_head: false, review_status: 4, poster: author, reviewer, reviewer_group: null,
  created_at: "2026-11-20T22:02:26.000Z", testcase: reviewedCase, steps: [{ step: "not returned" }],
  review_comments: [
    { comment: "Renamed%20the%20case.", user: 5014, commented_on: "2026-11-20T22:02:25.000Z" },
    { comment: "Keep the old title, 50% of runs use it.", user: 5011, commented_on: "2026-11-20T22:02:26.000Z" },
  ],
};
const approvedRound = {
  id: 1347, revision: 1, is_head: false, review_status: 2, poster: author, reviewer, reviewer_group: null,
  created_at: "2026-11-20T22:02:25.000Z", testcase: reviewedCase,
  review_comments: [
    { comment: "%3Cp%3EPlease%20review%20the%20%3Cstrong%3Elogin%3C/strong%3E%20steps%20%26amp%3B%20data%3C/p%3E", user: 5014, commented_on: "2026-11-20T22:02:25.000Z" },
    { comment: "Reviewer changed to David Hernandez by Linda Davis", user: 5008, commented_on: "2026-11-20T22:02:25.000Z" },
  ],
};
// Grid rows are current revisions: users are joined objects and comments are JSON text.
const gridRow = (id: number, extra: ApiRecord = {}): ApiRecord => ({
  id, title: `Case ${id}`, display_number: id - 1700, revision: 1, testcaserevisionid: id + 1000, review_status: 1,
  poster: author, reviewer, reviewer_group: null, reviewer_group_name: null, under_review: 1, archived: 0,
  revisionCreatedAt: "2026-11-20T22:08:35.000Z", review_comments: "[]", ...extra,
});
const commented = (text: string, user = 5014) => JSON.stringify([{ comment: escape(text), user, commented_on: "2026-11-20T22:08:35.000Z" }]);

let revisions: ApiRecord[];
let gridRows: ApiRecord[];
let calls: Array<{ method: string; url: URL; body: any }>;

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function unpack(result: ToolResult) { return JSON.parse(result.content[0]!.text); }
function call(input: unknown, requestContext: RequestContext = context) { return runWithContext(requestContext, () => handleGetTestCaseReviews(input)); }
function requests(pathname: string) { return calls.filter(row => row.url.pathname === pathname); }

beforeEach(() => {
  revisions = [approvedRound, rejectedEdit];
  gridRows = [];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ method, url, body });
    expect(url.searchParams.get("token")).toBe(context.apiToken);
    if (method === "POST" && url.pathname === "/testcases/aggrid") {
      const rows = gridRows.slice(body.startRow, body.endRow);
      return response({ rows, lastRow: null, totalCount: 55, filteredCount: gridRows.length });
    }
    if (method !== "GET") throw new Error(`Unexpected write ${method} ${url.pathname}`);
    switch (url.pathname) {
      case "/testcaserevisions": {
        const filter = JSON.parse(url.searchParams.get("filter") || "{}");
        const ids: number[] = filter.testcase_in ?? [Number(url.searchParams.get("testcase"))];
        let rows = revisions.filter(row => ids.includes(row.testcase.id));
        rows = url.searchParams.get("_sort") === "id:DESC" ? rows.sort((a, b) => b.id - a.id) : rows.sort((a, b) => a.id - b.id);
        const start = Number(url.searchParams.get("_start") || 0);
        return response(rows.slice(start, start + Number(url.searchParams.get("_limit"))));
      }
      case "/projectusers": return response([{ id: 1, user: author }, { id: 2, user: reviewer }, { id: 3, user: { id: 5008, name: "Linda Davis", email: "admin2@example.com" } }]);
      case "/testcases/1": return response({ id: 1, title: "Never reviewed", display_number: null, under_review: 0, archived: false, project: { id: 8 } });
      case "/testcases/52": return response({ id: 52, title: "Other project", project: { id: 9 } });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("case links", () => {
  it.each([
    ["https://api.testcollab.io", "https://testcollab.io"],
    ["https://api-eu.testcollab.io/", "https://testcollab.io"],
    ["https://api.testcollab-dev.io", "https://testcollab-dev.io"],
    ["http://localhost:1337", "http://localhost:8080"],
    ["http://127.0.0.1:1337", "http://127.0.0.1:8080"],
    ["https://testcollab.example.com", null],
    ["not a url", null],
  ])("maps the API URL %s to the app URL %s", (apiUrl, appUrl) => {
    expect(appBaseUrl(apiUrl)).toBe(appUrl);
  });
});

describe("comment text", () => {
  it("reads stored editor HTML and plain reviewer text the way the review panel shows them", () => {
    expect(commentText(escape('<p>First line</p><p>See <a href="https://example.com/spec">the spec</a> &lt;tag&gt; &amp; <span class="mention">@Linda</span></p>'))).toBe("First line\nSee the spec (https://example.com/spec) <tag> & @Linda");
    expect(commentText(escape("<p>Line one<br>line two</p>"))).toBe("Line one\nline two");
    expect(commentText("Keep the old title, 50% of runs use it.")).toBe("Keep the old title, 50% of runs use it.");
    expect(commentText(escape('<a href="https://example.com">https://example.com</a>'))).toBe("https://example.com");
    expect(commentText("&#65;&#x42; &unknown;")).toBe("AB &unknown;");
    expect(commentText(undefined)).toBe("");
  });
});

describe("get_test_case_reviews for one case", () => {
  it("returns the latest review even when a rejected edit restored the earlier version, with history", async () => {
    const result = await call({ test_case_id: 1724, include_history: true });
    expect(result.isError).toBeUndefined();
    const { testCases, nextOffset } = unpack(result);
    expect(nextOffset).toBeNull();
    expect(testCases).toHaveLength(1);
    const [testCase] = testCases;
    expect(testCase).toMatchObject({
      id: 1724, displayNumber: 12, title: "Login", underReview: false, archived: false,
      url: "http://localhost:8080/project/8/manage/test_cases/1724",
    });
    expect(testCase.latestReview).toEqual({
      revision: 2, isCurrentRevision: false, status: "rejected",
      author: { id: 5014, name: "Susan Wilson", email: "author@example.com" },
      reviewer: { id: 5011, name: "David Hernandez", email: "reviewer@example.com" },
      reviewerGroup: null, createdAt: "2026-11-20T22:02:26.000Z",
      comments: [
        { author: { id: 5014, name: "Susan Wilson" }, text: "Renamed the case.", createdAt: "2026-11-20T22:02:25.000Z" },
        { author: { id: 5011, name: "David Hernandez" }, text: "Keep the old title, 50% of runs use it.", createdAt: "2026-11-20T22:02:26.000Z" },
      ],
    });
    expect(testCase.history.map((round: ApiRecord) => [round.revision, round.status])).toEqual([[1, "approved"]]);
    expect(testCase.history[0].comments.map((comment: ApiRecord) => [comment.author.name, comment.text])).toEqual([
      ["Susan Wilson", "Please review the login steps & data"],
      ["Linda Davis", "Reviewer changed to David Hernandez by Linda Davis"],
    ]);
    const [rounds] = requests("/testcaserevisions");
    expect(Object.fromEntries(rounds!.url.searchParams)).toMatchObject({ project: "8", review_status_gt: "0", filter: JSON.stringify({ testcase_in: [1724] }) });
    expect(requests("/projectusers")).toHaveLength(1);
    expect(calls.every(row => row.method === "GET")).toBe(true);
  });

  it("reads only the newest review round without history and needs no member list", async () => {
    const { testCases } = unpack(await call({ test_case_id: 1724 }));
    expect(testCases[0].latestReview.status).toBe("rejected");
    expect(testCases[0]).not.toHaveProperty("history");
    const [rounds] = requests("/testcaserevisions");
    expect(Object.fromEntries(rounds!.url.searchParams)).toMatchObject({ project: "8", testcase: "1724", review_status_gt: "0", _sort: "id:DESC", _limit: "1" });
    expect(requests("/projectusers")).toHaveLength(0);
  });

  it("returns a case without a review, and refuses a case from another project", async () => {
    const never = unpack(await call({ test_case_id: 1, include_history: true })).testCases[0];
    expect(never).toMatchObject({ id: 1, title: "Never reviewed", latestReview: null, history: [], url: "http://localhost:8080/project/8/manage/test_cases/1" });
    const other = await call({ test_case_id: 52 });
    expect(other.isError).toBe(true);
    expect(unpack(other).error.message).toBe("Test case was not found in the requested project");
  });

  it("leaves the link empty for an API host whose app host is unknown", async () => {
    const { testCases } = unpack(await call({ test_case_id: 1724 }, { ...context, apiUrl: "https://testcollab.example.com" }));
    expect(testCases[0].url).toBeNull();
  });
});

describe("get_test_case_reviews for a project", () => {
  it("lists cases whose current version has a review through the grid's Review Status filter", async () => {
    gridRows = [
      gridRow(1729, { review_comments: commented("Ready for review.") }),
      gridRow(1728, { reviewer: null, reviewer_group: 3, reviewer_group_name: "QA leads" }),
      gridRow(1727, { review_status: 2, under_review: 0 }),
    ];
    const result = unpack(await call({ limit: 2 }));
    const [grid] = requests("/testcases/aggrid");
    expect(grid!.body).toMatchObject({
      project: "8", startRow: 0, endRow: 2,
      filterModel: { review_status: { filterType: "number", type: "greaterThan", filter: 0 } },
      sortModel: [{ colId: "updated_at", sort: "desc" }, { colId: "id", sort: "desc" }],
    });
    expect(result.totalReviewedCases).toBe(3);
    expect(result.nextOffset).toBe(2);
    expect(result.testCases.map((row: ApiRecord) => [row.id, row.latestReview.status, row.latestReview.isCurrentRevision])).toEqual([[1729, "review_pending", true], [1728, "review_pending", true]]);
    expect(result.testCases[0].latestReview.comments).toEqual([{ author: { id: 5014, name: "Susan Wilson" }, text: "Ready for review.", createdAt: "2026-11-20T22:08:35.000Z" }]);
    expect(result.testCases[1].latestReview).toMatchObject({ reviewer: null, reviewerGroup: { id: 3, name: "QA leads" }, revision: 1, createdAt: "2026-11-20T22:08:35.000Z" });
    expect(result.testCases[1]).toMatchObject({ displayNumber: 28, title: "Case 1728", url: "http://localhost:8080/project/8/manage/test_cases/1728", underReview: true });
    const last = unpack(await call({ limit: 2, offset: 2 }));
    expect(last.testCases.map((row: ApiRecord) => row.id)).toEqual([1727]);
    expect(last.nextOffset).toBeNull();
    expect(requests("/testcaserevisions")).toHaveLength(0);
  });

  it("keeps cases whose latest review has comments and continues after the last case it checked", async () => {
    gridRows = [gridRow(1730), gridRow(1729, { review_comments: commented("First") }), gridRow(1728), gridRow(1727, { review_comments: commented("Second") }), gridRow(1726, { review_comments: commented("Third") })];
    const first = unpack(await call({ only_with_comments: true, limit: 2 }));
    expect(requests("/testcases/aggrid")[0]!.body).toMatchObject({ startRow: 0, endRow: 250 });
    expect(first.testCases.map((row: ApiRecord) => row.id)).toEqual([1729, 1727]);
    expect(first.nextOffset).toBe(4);
    const second = unpack(await call({ only_with_comments: true, limit: 2, offset: first.nextOffset }));
    expect(second.testCases.map((row: ApiRecord) => row.id)).toEqual([1726]);
    expect(second.nextOffset).toBeNull();
  });

  it("adds earlier review rounds of the listed cases, without the current one", async () => {
    gridRows = [gridRow(1724, { testcaserevisionid: 1349, revision: 3, review_status: 1 })];
    revisions = [approvedRound, rejectedEdit, { ...rejectedEdit, id: 1349, revision: 3, is_head: true, review_status: 1, review_comments: [] }];
    const { testCases } = unpack(await call({ include_history: true }));
    expect(testCases[0].latestReview).toMatchObject({ revision: 3, status: "review_pending", isCurrentRevision: true });
    expect(testCases[0].history.map((round: ApiRecord) => [round.revision, round.status, round.isCurrentRevision])).toEqual([[2, "rejected", false], [1, "approved", false]]);
    expect(JSON.parse(requests("/testcaserevisions")[0]!.url.searchParams.get("filter")!)).toEqual({ testcase_in: [1724] });
  });

  it("refuses invalid input before any request", async () => {
    for (const input of [{ limit: 51 }, { offset: -1 }, { test_case_id: 0 }, { unknown: true }]) {
      const result = await call(input);
      expect(result.isError).toBe(true);
      expect(unpack(result).error.code).toBe("VALIDATION_ERROR");
    }
    expect(calls).toHaveLength(0);
  });
});
