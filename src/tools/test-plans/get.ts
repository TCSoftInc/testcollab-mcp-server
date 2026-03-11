/**
 * get_test_plan MCP Tool
 *
 * Retrieves a single test plan with included test case count, configurations, and runs.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";

// ============================================================================
// Schema Definitions
// ============================================================================

export const getTestPlanRegistrationSchema = z.object({
  id: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      "Test plan ID to retrieve. Accepts numeric ID or title string."
    ),
  title: z
    .string()
    .min(1)
    .optional()
    .describe("Test plan title to retrieve (alternative to id)."),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses default if not specified)"),
  include_configurations: z
    .boolean()
    .default(true)
    .describe("Include test plan configurations in the response (default: true)"),
  include_runs: z
    .boolean()
    .default(true)
    .describe("Include test plan runs in the response (default: true)"),
  runs_limit: z
    .number()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of runs to return (1-100, default: 20)"),
  runs_offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of runs to skip (default: 0)"),
  runs_sort: z
    .string()
    .min(1)
    .default("id:desc")
    .describe('Run sort expression (default: "id:desc")'),
});

export const getTestPlanSchema = getTestPlanRegistrationSchema.refine(
  (value) => value.id !== undefined || value.title !== undefined,
  {
    message: "Either id or title is required.",
    path: ["id"],
  }
);

export type GetTestPlanInput = z.infer<typeof getTestPlanSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const getTestPlanTool = {
  name: "get_test_plan",
  description: `Fetch a single test plan with summary details:
- Included test cases count
- Test plan configurations
- Test plan runs
- Current execution progress status

Required: id or title
Optional: project_id, include_configurations, include_runs, runs_limit, runs_offset, runs_sort

Example:
{
  "id": 812,
  "project_id": 16
}

or

{
  "title": "Release 3.0 Regression",
  "project_id": 16
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Test plan ID to retrieve (numeric ID or title string)",
      },
      title: {
        type: "string",
        description: "Test plan title to retrieve (alternative to id)",
      },
      project_id: {
        type: "number",
        description: "Project ID (optional if default is set)",
      },
      include_configurations: {
        type: "boolean",
        default: true,
        description: "Include test plan configurations in the response",
      },
      include_runs: {
        type: "boolean",
        default: true,
        description: "Include test plan runs in the response",
      },
      runs_limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 20,
        description: "Maximum number of runs to return (1-100, default: 20)",
      },
      runs_offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Number of runs to skip (default: 0)",
      },
      runs_sort: {
        type: "string",
        default: "id:desc",
        description: 'Run sort expression (default: "id:desc")',
      },
    },
    required: [],
  },
};

// ============================================================================
// Helpers
// ============================================================================

const numericIdPattern = /^\d+$/;

const testPlanStatusCodeToLabel: Record<number, string> = {
  0: "Draft",
  1: "Ready to Execute",
  2: "Finished",
  3: "Finished with Failures",
};

const testPlanPriorityCodeToLabel: Record<number, string> = {
  0: "Low",
  1: "Normal",
  2: "High",
};

const runStatusCodeToLabel: Record<number, string> = {
  0: "Draft",
  1: "In Progress",
  2: "Finished",
  3: "Finished with Failures",
  4: "Archived",
};

const toNumberId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && numericIdPattern.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getField = <T>(item: unknown, key: string): T | undefined => {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  if (record[key] !== undefined) {
    return record[key] as T;
  }
  const attributes = record["attributes"];
  if (attributes && typeof attributes === "object") {
    return (attributes as Record<string, unknown>)[key] as T | undefined;
  }
  const relations = record["relations"];
  if (relations && typeof relations === "object") {
    return (relations as Record<string, unknown>)[key] as T | undefined;
  }
  return undefined;
};

const unwrapApiData = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const data = record["data"];
  return data && typeof data === "object" ? data : value;
};

const unwrapApiEntity = (value: unknown): Record<string, unknown> | null => {
  const unwrapped = unwrapApiData(value);
  if (!unwrapped || typeof unwrapped !== "object") {
    return null;
  }
  const record = unwrapped as Record<string, unknown>;
  const attributes = record["attributes"];
  if (attributes && typeof attributes === "object") {
    return { ...(attributes as Record<string, unknown>), ...record };
  }
  return record;
};

const unwrapCollection = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const data = record["data"];
  if (Array.isArray(data)) {
    return data;
  }
  const models = record["models"];
  if (Array.isArray(models)) {
    return models;
  }
  return undefined;
};

const getArrayField = (
  container: Record<string, unknown>,
  key: string,
  altKeys?: string[]
): unknown[] | undefined => {
  const direct = unwrapCollection(getField<unknown>(container, key));
  if (direct) {
    return direct;
  }
  if (altKeys) {
    for (const altKey of altKeys) {
      const altValue = unwrapCollection(getField<unknown>(container, altKey));
      if (altValue) {
        return altValue;
      }
    }
  }
  return undefined;
};

const extractId = (value: unknown): number | undefined => {
  const direct = toNumberId(value);
  if (direct !== undefined) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const recordId = toNumberId(record["id"]);
  if (recordId !== undefined) {
    return recordId;
  }
  const attributes = record["attributes"];
  if (attributes && typeof attributes === "object") {
    const attrId = toNumberId((attributes as Record<string, unknown>)["id"]);
    if (attrId !== undefined) {
      return attrId;
    }
  }
  const data = record["data"];
  if (data && typeof data === "object") {
    return extractId(data);
  }
  return undefined;
};

const extractCount = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const countValue = getField<unknown>(value, "count");
  const parsedCount = toNumberId(countValue);
  return parsedCount ?? null;
};

const mapUser = (value: unknown): Record<string, unknown> | null => {
  const id = extractId(value);
  if (!id) {
    return null;
  }
  const name = normalizeString(getField<string>(value, "name"));
  const username = normalizeString(getField<string>(value, "username"));
  const email = normalizeString(getField<string>(value, "email"));
  const avatar =
    normalizeString(getField<string>(value, "avatar")) ??
    normalizeString(getField<string>(value, "avatar_url"));

  return {
    id,
    ...(name ? { name } : {}),
    ...(username ? { username } : {}),
    ...(email ? { email } : {}),
    ...(avatar ? { avatar } : {}),
  };
};

const mapConfiguration = (value: unknown): Record<string, unknown> | null => {
  const config = unwrapApiEntity(value);
  if (!config) {
    return null;
  }
  const id = extractId(config);
  if (!id) {
    return null;
  }

  const parametersRaw = getArrayField(config, "parameters");
  const parameters = (parametersRaw ?? [])
    .map((parameter) => {
      const field = normalizeString(getField<string>(parameter, "field"));
      const configValue = normalizeString(getField<string>(parameter, "value"));
      if (!field || configValue === undefined) {
        return null;
      }
      const parameterId = normalizeString(
        getField<string>(parameter, "id") ??
          getField<string>(parameter, "systemValue")
      );
      return {
        ...(parameterId ? { id: parameterId } : {}),
        field,
        value: configValue,
      };
    })
    .filter((parameter): parameter is { id?: string; field: string; value: string } => Boolean(parameter));

  const assignedTo = mapUser(
    getField(config, "assigned_to") ?? getField(config, "assignedTo")
  );

  return {
    id,
    parameters,
    assignedTo,
  };
};

const mapRun = (value: unknown): Record<string, unknown> | null => {
  const run = unwrapApiEntity(value);
  if (!run) {
    return null;
  }
  const id = extractId(run);
  if (!id) {
    return null;
  }

  const status = toNumberId(getField(run, "status"));
  const iteration = toNumberId(getField(run, "iteration"));
  const timeSpent = toNumberId(
    getField(run, "time_spent") ?? getField(run, "timeSpent")
  );
  const pendingQueueId = toNumberId(
    getField(run, "pending_queue_id") ?? getField(run, "pendingQueueId")
  );
  const createdBy = mapUser(
    getField(run, "created_by") ?? getField(run, "createdBy")
  );

  const assignedToRaw = getArrayField(run, "assigned_to", ["assignedTo"]);
  const assignedTo = (assignedToRaw ?? [])
    .map((user) => mapUser(user))
    .filter((user): user is Record<string, unknown> => Boolean(user));

  const configurationsRaw = getArrayField(run, "configurations");
  const configurationIds = (configurationsRaw ?? [])
    .map((config) => extractId(config))
    .filter((configId): configId is number => configId !== undefined);

  return {
    id,
    ...(normalizeString(getField<string>(run, "title"))
      ? { title: normalizeString(getField<string>(run, "title")) }
      : {}),
    ...(iteration !== undefined ? { iteration } : {}),
    ...(status !== undefined
      ? { status, statusLabel: runStatusCodeToLabel[status] ?? "Unknown" }
      : {}),
    ...(Array.isArray(getField(run, "test_case_selection"))
      ? { testCaseSelection: getField(run, "test_case_selection") }
      : {}),
    ...(timeSpent !== undefined ? { timeSpent } : {}),
    ...(normalizeString(getField<string>(run, "last_activity"))
      ? { lastActivity: normalizeString(getField<string>(run, "last_activity")) }
      : {}),
    ...(pendingQueueId !== undefined ? { pendingQueueId } : {}),
    ...(normalizeString(getField<string>(run, "created_at"))
      ? { createdAt: normalizeString(getField<string>(run, "created_at")) }
      : {}),
    ...(normalizeString(getField<string>(run, "updated_at"))
      ? { updatedAt: normalizeString(getField<string>(run, "updated_at")) }
      : {}),
    ...(createdBy ? { createdBy } : {}),
    assignedTo,
    configurationIds,
    ...(getField(run, "result") &&
    typeof getField(run, "result") === "object" &&
    !Array.isArray(getField(run, "result"))
      ? { result: getField(run, "result") }
      : {}),
  };
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeResultSummary = (
  value: unknown
): Record<string, number> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    const numeric = toFiniteNumber(rawValue);
    if (numeric !== null && numeric >= 0) {
      result[key] = numeric;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
};

const toPercent = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
};

const deriveProgressStatus = (progress: {
  total: number;
  executed: number;
  failed: number;
  blocked: number;
}): string => {
  if (progress.total <= 0) {
    return "No Cases";
  }
  if (progress.executed <= 0) {
    return "Not Started";
  }
  if (progress.executed < progress.total) {
    return "In Progress";
  }
  if (progress.failed > 0 || progress.blocked > 0) {
    return "Completed with Failures";
  }
  return "Completed";
};

const getStatusCount = (
  summary: Record<string, number>,
  status: string
): number => {
  const target = status.toLowerCase();
  let count = 0;
  for (const [key, value] of Object.entries(summary)) {
    if (key.toLowerCase() === target) {
      count += value;
    }
  }
  return count;
};

type ProgressPayload = {
  source: "test_plan_results" | "latest_run_result";
  status: string;
  total: number;
  executed: number;
  unexecuted: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  executionProgressPercent: number | null;
  passRatePercent: number | null;
  summary: Record<string, number>;
};

type PlanLookupCandidate = {
  id: number;
  title?: string;
};

const mapPlanLookupCandidates = (plans: unknown[]): PlanLookupCandidate[] =>
  plans
    .map((plan) => {
      const id = extractId(plan);
      if (!id) {
        return null;
      }
      const title = normalizeString(getField<string>(plan, "title"));
      return {
        id,
        ...(title ? { title } : {}),
      };
    })
    .filter((plan): plan is PlanLookupCandidate => Boolean(plan));

const findMatchingPlansByTitle = (
  plans: PlanLookupCandidate[],
  title: string
): PlanLookupCandidate[] => {
  const normalizedTitle = title.trim().toLowerCase();
  return plans.filter(
    (plan) => plan.title && plan.title.trim().toLowerCase() === normalizedTitle
  );
};

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleGetTestPlan(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = getTestPlanSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid input parameters",
              details: parsed.error.errors,
            },
          }),
        },
      ],
    };
  }

  const {
    id,
    title,
    project_id,
    include_configurations,
    include_runs,
    runs_limit,
    runs_offset,
    runs_sort,
  } = parsed.data;

  const requestContext = getRequestContext();
  const envConfig = requestContext ? null : getConfig();
  const resolvedProjectId =
    project_id ?? requestContext?.defaultProjectId ?? envConfig?.defaultProjectId;

  if (!resolvedProjectId) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "MISSING_PROJECT_ID",
              message:
                "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT environment variable.",
            },
          }),
        },
      ],
    };
  }

  try {
    const client = getApiClient();

    const resolvedTitleInput = normalizeString(title);
    const idAsNumber = toNumberId(id);
    const idAsTitle =
      typeof id === "string" && toNumberId(id) === undefined
        ? normalizeString(id)
        : undefined;
    const lookupTitle = resolvedTitleInput ?? idAsTitle;
    let resolvedTestPlanId = idAsNumber;

    if (resolvedTestPlanId === undefined && lookupTitle) {
      const exactMatchesRaw = await client.listTestPlans({
        projectId: resolvedProjectId,
        limit: 100,
        offset: 0,
        sort: "updated_at:desc",
        filter: { title: lookupTitle },
      });
      let matches = findMatchingPlansByTitle(
        mapPlanLookupCandidates(exactMatchesRaw),
        lookupTitle
      );

      if (matches.length === 0) {
        const fallbackMatchesRaw = await client.listTestPlans({
          projectId: resolvedProjectId,
          limit: 100,
          offset: 0,
          sort: "updated_at:desc",
          filter: { title_contains: lookupTitle },
        });
        matches = findMatchingPlansByTitle(
          mapPlanLookupCandidates(fallbackMatchesRaw),
          lookupTitle
        );
      }

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "TEST_PLAN_NOT_FOUND",
                  message: `Test plan not found with title "${lookupTitle}" in that project.`,
                },
              }),
            },
          ],
        };
      }

      if (matches.length > 1) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "AMBIGUOUS_TEST_PLAN_TITLE",
                  message: `Multiple test plans matched title "${lookupTitle}". Provide ID instead.`,
                  details: {
                    matching_ids: matches.map((plan) => plan.id),
                  },
                },
              }),
            },
          ],
        };
      }

      resolvedTestPlanId = matches[0].id;
    }

    if (resolvedTestPlanId === undefined) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "Provide a numeric id or a non-empty title.",
              },
            }),
          },
        ],
      };
    }

    const rawPlan = await client.getTestPlanRaw(resolvedTestPlanId);
    const plan = unwrapApiEntity(rawPlan);
    if (!plan) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "INVALID_TEST_PLAN",
                message: `Unable to parse test plan ${resolvedTestPlanId}.`,
              },
            }),
          },
        ],
      };
    }

    const includedTestCasesCountResponse = await client.getTestPlanTestCaseCount(
      resolvedProjectId,
      resolvedTestPlanId
    );
    const includedTestCasesCount = extractCount(includedTestCasesCountResponse);

    let configurations: Array<Record<string, unknown>> = [];
    if (include_configurations) {
      const rawConfigurations = await client.listTestPlanConfigurations({
        projectId: resolvedProjectId,
        testplan: resolvedTestPlanId,
        limit: -1,
      });

      configurations = rawConfigurations
        .map((configuration) => mapConfiguration(configuration))
        .filter(
          (configuration): configuration is Record<string, unknown> =>
            Boolean(configuration)
        );
    }

    let runs: Array<Record<string, unknown>> = [];
    if (include_runs) {
      const rawRuns = await client.listTestPlanRegressions({
        projectId: resolvedProjectId,
        testplan: resolvedTestPlanId,
        limit: runs_limit,
        start: runs_offset,
        sort: runs_sort,
      });

      runs = rawRuns
        .map((run) => mapRun(run))
        .filter((run): run is Record<string, unknown> => Boolean(run));
    }

    let runCount: number | null = null;
    try {
      const runCountResponse = await client.getTestPlanRegressionCount(
        resolvedProjectId,
        { testplan: resolvedTestPlanId }
      );
      runCount = extractCount(runCountResponse);
    } catch {
      runCount = null;
    }

    const planResults = getField<unknown>(plan, "results");
    const planOverallSummary = normalizeResultSummary(
      planResults && typeof planResults === "object" && !Array.isArray(planResults)
        ? getField(planResults, "overall") ?? planResults
        : undefined
    );
    const latestRunSummary =
      runs.length > 0
        ? normalizeResultSummary(getField(runs[0], "result"))
        : null;

    let progress: ProgressPayload | null = null;
    if (planOverallSummary || latestRunSummary) {
      const summary = planOverallSummary ?? latestRunSummary!;
      const source: ProgressPayload["source"] = planOverallSummary
        ? "test_plan_results"
        : "latest_run_result";
      const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
      const unexecuted = getStatusCount(summary, "unexecuted");
      const passed = getStatusCount(summary, "passed");
      const failed = getStatusCount(summary, "failed");
      const skipped = getStatusCount(summary, "skipped");
      const blocked = getStatusCount(summary, "blocked");
      const executed = Math.max(total - unexecuted, 0);
      progress = {
        source,
        status: deriveProgressStatus({
          total,
          executed,
          failed,
          blocked,
        }),
        total,
        executed,
        unexecuted,
        passed,
        failed,
        skipped,
        blocked,
        executionProgressPercent: toPercent(executed, total),
        passRatePercent: toPercent(passed, executed),
        summary,
      };
    }

    const status = toNumberId(getField(plan, "status"));
    const priority = toNumberId(getField(plan, "priority"));
    const testPlanFolderRaw =
      getField(plan, "test_plan_folder") ?? getField(plan, "testPlanFolder");
    const testPlanFolderId = extractId(testPlanFolderRaw);
    const testPlanFolderTitle =
      normalizeString(getField<string>(testPlanFolderRaw, "title")) ??
      normalizeString(getField<string>(testPlanFolderRaw, "name"));
    const releaseRaw = getField(plan, "release");
    const releaseId = extractId(releaseRaw);
    const releaseTitle =
      normalizeString(getField<string>(releaseRaw, "title")) ??
      normalizeString(getField<string>(releaseRaw, "name"));

    const createdBy = mapUser(
      getField(plan, "created_by") ?? getField(plan, "createdBy")
    );
    const assignedToRaw = getArrayField(plan, "assigned_to", ["assignedTo"]);
    const assignedTo = (assignedToRaw ?? [])
      .map((user) => mapUser(user))
      .filter((user): user is Record<string, unknown> => Boolean(user));

    const planConfigurationCountFromPlan = getArrayField(
      plan,
      "configurations"
    )?.length;
    const configurationCount = include_configurations
      ? configurations.length
      : planConfigurationCountFromPlan ?? null;

    const hasMoreRuns =
      include_runs &&
      (runCount !== null
        ? runs_offset + runs.length < runCount
        : runs.length === runs_limit);

    const normalizedPlan = {
      id: extractId(plan) ?? resolvedTestPlanId,
      ...(normalizeString(getField<string>(plan, "title"))
        ? { title: normalizeString(getField<string>(plan, "title")) }
        : {}),
      ...(normalizeString(getField<string>(plan, "description"))
        ? { description: normalizeString(getField<string>(plan, "description")) }
        : {}),
      ...(status !== undefined
        ? { status, statusLabel: testPlanStatusCodeToLabel[status] ?? "Unknown" }
        : {}),
      ...(priority !== undefined
        ? {
            priority,
            priorityLabel: testPlanPriorityCodeToLabel[priority] ?? "Unknown",
          }
        : {}),
      ...(typeof getField(plan, "archived") === "boolean"
        ? { archived: getField(plan, "archived") }
        : {}),
      ...(testPlanFolderId !== undefined
        ? {
            testPlanFolder: {
              id: testPlanFolderId,
              ...(testPlanFolderTitle ? { title: testPlanFolderTitle } : {}),
            },
          }
        : {}),
      ...(releaseId !== undefined
        ? {
            release: {
              id: releaseId,
              ...(releaseTitle ? { title: releaseTitle } : {}),
            },
          }
        : {}),
      ...(createdBy ? { createdBy } : {}),
      assignedTo,
      ...(normalizeString(getField<string>(plan, "start_date"))
        ? { startDate: normalizeString(getField<string>(plan, "start_date")) }
        : {}),
      ...(normalizeString(getField<string>(plan, "end_date"))
        ? { endDate: normalizeString(getField<string>(plan, "end_date")) }
        : {}),
      ...(normalizeString(getField<string>(plan, "actual_start_date"))
        ? {
            actualStartDate: normalizeString(
              getField<string>(plan, "actual_start_date")
            ),
          }
        : {}),
      ...(normalizeString(getField<string>(plan, "created_at"))
        ? { createdAt: normalizeString(getField<string>(plan, "created_at")) }
        : {}),
      ...(normalizeString(getField<string>(plan, "updated_at"))
        ? { updatedAt: normalizeString(getField<string>(plan, "updated_at")) }
        : {}),
      ...(normalizeString(getField<string>(plan, "last_run"))
        ? { lastRun: normalizeString(getField<string>(plan, "last_run")) }
        : {}),
      ...(getField(plan, "results") &&
      typeof getField(plan, "results") === "object" &&
      !Array.isArray(getField(plan, "results"))
        ? { results: getField(plan, "results") }
        : {}),
      ...(typeof getField(plan, "time_spent") === "number"
        ? { timeSpent: getField(plan, "time_spent") }
        : {}),
      ...(typeof getField(plan, "estimate") === "number"
        ? { estimate: getField(plan, "estimate") }
        : {}),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              testPlan: normalizedPlan,
              summary: {
                included_test_cases_count: includedTestCasesCount,
                configuration_count: configurationCount,
                run_count: runCount,
                current_progress_status: progress?.status ?? null,
                execution_progress_percent:
                  progress?.executionProgressPercent ?? null,
                pass_rate_percent: progress?.passRatePercent ?? null,
              },
              progress,
              configurations,
              runs,
              runsPagination: include_runs
                ? {
                    returned: runs.length,
                    limit: runs_limit,
                    offset: runs_offset,
                    hasMore: hasMoreRuns,
                  }
                : null,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "API_ERROR",
              message: getErrorMessage(error),
            },
          }),
        },
      ],
    };
  }
}
