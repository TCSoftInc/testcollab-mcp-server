/**
 * list_test_cases MCP Tool
 *
 * Lists test cases with optional filtering, sorting, and pagination.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";
import type { TestCaseFilter } from "../../types/index.js";

// ============================================================================
// Schema Definitions
// ============================================================================

const textFilterSchema = z.object({
  filterType: z.literal("text"),
  type: z.enum([
    "equals",
    "notEqual",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
    "isBlank",
  ]),
  filter: z.string(),
});

const numberFilterSchema = z.object({
  filterType: z.literal("number"),
  type: z.enum([
    "equals",
    "notEqual",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "inRange",
  ]),
  filter: z.union([
    z.number(),
    z.string(),
    z.array(z.union([z.number(), z.string()])),
  ]),
  filterTo: z.number().optional(),
});

const dateFilterSchema = z.object({
  filterType: z.literal("date"),
  type: z.enum(["equals", "notEqual", "greaterThan", "lessThan", "inRange"]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const filterConditionSchema = z.union([
  textFilterSchema,
  numberFilterSchema,
  dateFilterSchema,
]);

const sortModelSchema = z.object({
  colId: z.string(),
  sort: z.enum(["asc", "desc"]),
});

const testCaseFilterSchema = z
  .object({
    id: numberFilterSchema.optional(),
    title: textFilterSchema.optional(),
    description: textFilterSchema.optional(),
    steps: textFilterSchema.optional(),
    priority: numberFilterSchema.optional(),
    suite: numberFilterSchema.optional(),
    created_by: numberFilterSchema.optional(),
    reviewer: numberFilterSchema.optional(),
    poster: numberFilterSchema.optional(),
    created_at: dateFilterSchema.optional(),
    updated_at: dateFilterSchema.optional(),
    last_run_on: dateFilterSchema.optional(),
    tags: numberFilterSchema.optional(),
    requirements: numberFilterSchema.optional(),
    issue_key: textFilterSchema.optional(),
    under_review: numberFilterSchema.optional(),
    is_automated: numberFilterSchema.optional(),
    automation_status: textFilterSchema.optional(),
    last_run_status: textFilterSchema.optional(),
    run_count: numberFilterSchema.optional(),
    avg_execution_time: numberFilterSchema.optional(),
    failure_rate: numberFilterSchema.optional(),
  })
  .catchall(filterConditionSchema);

const normalizeListTestCasesInput = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = { ...(value as Record<string, unknown>) };
  const filter = input.filter;
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    return input;
  }
  const normalizedFilter = { ...(filter as Record<string, unknown>) };

  const normalizeSuiteFilter = () => {
    const raw = normalizedFilter["suite"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return;
    }
    const rawFilter = { ...(raw as Record<string, unknown>) };
    if (rawFilter.filterType !== "text") {
      return;
    }
    const type = rawFilter.type;
    if (type === "equals" || type === "contains") {
      rawFilter.filterType = "number";
      rawFilter.type = "equals";
    } else if (type === "notEqual" || type === "notContains") {
      rawFilter.filterType = "number";
      rawFilter.type = "notEqual";
    } else {
      return;
    }
    normalizedFilter["suite"] = rawFilter;
  };

  const normalizeLookupFilter = (key: "tags" | "requirements") => {
    const raw = normalizedFilter[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return;
    }
    const rawFilter = { ...(raw as Record<string, unknown>) };
    if (rawFilter.filterType !== "text") {
      return;
    }
    const type = rawFilter.type;
    if (type === "equals" || type === "contains") {
      rawFilter.filterType = "number";
      rawFilter.type = "equals";
    } else if (type === "notEqual" || type === "notContains") {
      rawFilter.filterType = "number";
      rawFilter.type = "notEqual";
    } else {
      return;
    }
    if (rawFilter.filter !== undefined && !Array.isArray(rawFilter.filter)) {
      rawFilter.filter = [rawFilter.filter];
    }
    normalizedFilter[key] = rawFilter;
  };

  normalizeSuiteFilter();
  normalizeLookupFilter("tags");
  normalizeLookupFilter("requirements");

  input.filter = normalizedFilter;
  return input;
};

// Main input schema for the tool
export const listTestCasesSchema = z.preprocess(
  normalizeListTestCasesInput,
  z.object({
    project_id: z.number().optional().describe("Project ID (uses TC_DEFAULT_PROJECT env var if not specified)"),
    suite_id: z.union([z.number(), z.string()]).optional().describe("Filter by suite ID or title"),
    filter: testCaseFilterSchema.optional().describe("Filter conditions object"),
    sort: z
      .array(sortModelSchema)
      .optional()
      .describe("Sort specification array"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum results to return (1-100, default: 50)"),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of results to skip (default: 0)"),
  })
);

export type ListTestCasesInput = z.infer<typeof listTestCasesSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const listTestCasesTool = {
  name: "list_test_cases",
  description: `List test cases from a TestCollab project with optional filtering, sorting, and pagination.

Filter fields include:
- id, title, description, steps, priority (0=Low, 1=Normal, 2=High)
- suite (ID or title), created_by, reviewer, poster (user IDs)
- created_at, updated_at, last_run_on (dates)
- tags, requirements (arrays of IDs or names)
- under_review, is_automated (0 or 1)
- run_count, avg_execution_time, failure_rate

Filter types:
- text: equals, notEqual, contains, notContains, startsWith, endsWith, isBlank
- number: equals, notEqual, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, inRange
- date: equals, notEqual, greaterThan, lessThan, inRange`,

  inputSchema: {
    type: "object" as const,
    properties: {
      project_id: {
        type: "number",
        description: "Project ID (optional if TC_DEFAULT_PROJECT env var is set)",
      },
      suite_id: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Filter by suite ID or title",
      },
      filter: {
        type: "object",
        description:
          "Filter conditions. Each key is a field name with a filter object containing filterType, type, and filter value.",
        additionalProperties: true,
      },
      sort: {
        type: "array",
        description: "Sort specification",
        items: {
          type: "object",
          properties: {
            colId: { type: "string", description: "Field name to sort by" },
            sort: { type: "string", enum: ["asc", "desc"] },
          },
          required: ["colId", "sort"],
        },
      },
      limit: {
        type: "number",
        description: "Maximum results to return (1-100, default: 50)",
        default: 50,
        minimum: 1,
        maximum: 100,
      },
      offset: {
        type: "number",
        description: "Number of results to skip (default: 0)",
        default: 0,
        minimum: 0,
      },
    },
    required: [],
  },
};

// ============================================================================
// Tool Handler
// ============================================================================

const numericIdPattern = /^\d+$/;

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

const isNonNumericString = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !numericIdPattern.test(trimmed);
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
  return undefined;
};

const toArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined) {
    return [];
  }
  return [value];
};

const normalizeTagMatchType = (value: unknown): "contains" | "notContains" => {
  if (value === "notEqual" || value === "notEquals" || value === "notContains") {
    return "notContains";
  }
  return "contains";
};

const standardFilterKeys = new Set([
  "id",
  "title",
  "description",
  "steps",
  "priority",
  "suite",
  "created_by",
  "reviewer",
  "poster",
  "created_at",
  "updated_at",
  "last_run_on",
  "tags",
  "requirements",
  "issue_key",
  "under_review",
  "is_automated",
  "automation_status",
  "last_run_status",
  "run_count",
  "avg_execution_time",
  "failure_rate",
]);

export async function handleListTestCases(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Validate input
  const parsed = listTestCasesSchema.safeParse(args);
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

  const { project_id, suite_id, filter, sort, limit, offset } = parsed.data;

  // Resolve project ID: use provided value or fall back to default
  // Check request context first (HTTP transport), then env config (stdio transport)
  const requestContext = getRequestContext();
  const envConfig = requestContext ? null : getConfig();
  const resolvedProjectId = project_id ?? requestContext?.defaultProjectId ?? envConfig?.defaultProjectId;

  if (!resolvedProjectId) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "MISSING_PROJECT_ID",
              message: "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT environment variable.",
            },
          }),
        },
      ],
    };
  }

  try {
    const client = getApiClient();

    const suiteNeedsLookup =
      isNonNumericString(suite_id) ||
      (filter?.suite !== undefined &&
        (Array.isArray(filter.suite?.filter)
          ? filter.suite.filter.some(isNonNumericString)
          : isNonNumericString(filter.suite?.filter)));
    const tagsNeedLookup =
      filter?.tags !== undefined &&
      (Array.isArray(filter.tags.filter)
        ? filter.tags.filter.some(isNonNumericString)
        : isNonNumericString(filter.tags.filter));
    const requirementsNeedLookup =
      filter?.requirements !== undefined &&
      (Array.isArray(filter.requirements.filter)
        ? filter.requirements.filter.some(isNonNumericString)
        : isNonNumericString(filter.requirements.filter));

    const customFieldNameKeys =
      filter && typeof filter === "object"
        ? Object.keys(filter).filter(
            (key) => !standardFilterKeys.has(key) && !key.startsWith("cf_")
          )
        : [];
    const customFieldsNeedLookup = customFieldNameKeys.length > 0;

    const [suitesList, tagsList, requirementsList, customFieldsList] =
      await Promise.all([
        suiteNeedsLookup
          ? client.listSuites(resolvedProjectId)
          : Promise.resolve(null),
        tagsNeedLookup
          ? client.listTags(resolvedProjectId)
          : Promise.resolve(null),
        requirementsNeedLookup
          ? client.listRequirements(resolvedProjectId)
          : Promise.resolve(null),
        customFieldsNeedLookup
          ? client.listProjectCustomFields(resolvedProjectId)
          : Promise.resolve(null),
      ]);

    let resolvedSuiteId = toNumberId(suite_id);
    if (isNonNumericString(suite_id) && suitesList) {
      const match = suitesList.find(
        (suite) => getField<string>(suite, "title") === suite_id
      );
      resolvedSuiteId = toNumberId(match ? getField(match, "id") : undefined);
      if (resolvedSuiteId === undefined) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "SUITE_NOT_FOUND",
                  message: `Suite not found with title "${suite_id}" in that project`,
                },
              }),
            },
          ],
        };
      }
    }

    const resolvedFilter: Record<string, any> | undefined = filter
      ? { ...filter }
      : undefined;

    const suiteFilter = resolvedFilter?.suite as { filter?: unknown } | undefined;
    if (suiteFilter && suiteFilter.filter !== undefined) {
      const rawValues = toArray(suiteFilter.filter);
      const missingSuites: string[] = [];
      const resolvedIds = rawValues
        .map((value) => {
          const numericId = toNumberId(value);
          if (numericId !== undefined) {
            return numericId;
          }
          if (typeof value !== "string") {
            return undefined;
          }
          if (!suitesList) {
            missingSuites.push(value);
            return undefined;
          }
          const match = suitesList.find(
            (suite) => getField<string>(suite, "title") === value
          );
          const id = toNumberId(match ? getField(match, "id") : undefined);
          if (id === undefined) {
            missingSuites.push(value);
          }
          return id;
        })
        .filter((id): id is number => typeof id === "number");
      if (missingSuites.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "SUITE_NOT_FOUND",
                  message: `Suite not found with title "${missingSuites.join(", ")}" in that project`,
                },
              }),
            },
          ],
        };
      }
      if (resolvedIds.length > 0) {
        resolvedFilter.suite = {
          ...suiteFilter,
          filter: resolvedIds.length === 1 ? resolvedIds[0] : resolvedIds,
        };
      }
    }

    if (resolvedFilter?.tags && resolvedFilter.tags.filter !== undefined) {
      const rawFilter = resolvedFilter.tags.filter;
      const rawValues = toArray(rawFilter);
      const missingTags: string[] = [];
      const resolvedIds = rawValues
        .map((value) => {
          const numericId = toNumberId(value);
          if (numericId !== undefined) {
            return numericId;
          }
          if (typeof value !== "string") {
            return undefined;
          }
          if (!tagsList) {
            missingTags.push(value);
            return undefined;
          }
          const match = tagsList.find(
            (tag) => getField<string>(tag, "name") === value
          );
          const id = toNumberId(match ? getField(match, "id") : undefined);
          if (id === undefined) {
            missingTags.push(value);
          }
          return id;
        })
        .filter((id): id is number => typeof id === "number");
      if (missingTags.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "TAG_NOT_FOUND",
                  message: `Tag(s) not found: ${missingTags.join(", ")}`,
                },
              }),
            },
          ],
        };
      }
      resolvedFilter.tags = {
        ...resolvedFilter.tags,
        filterType: "number",
        type: normalizeTagMatchType(resolvedFilter.tags.type),
        filter: resolvedIds,
      };
    }

    if (resolvedFilter?.requirements && resolvedFilter.requirements.filter !== undefined) {
      const rawFilter = resolvedFilter.requirements.filter;
      const rawValues = toArray(rawFilter);
      const missingRequirements: string[] = [];
      const resolvedIds = rawValues
        .map((value) => {
          const numericId = toNumberId(value);
          if (numericId !== undefined) {
            return numericId;
          }
          if (typeof value !== "string") {
            return undefined;
          }
          if (!requirementsList) {
            missingRequirements.push(value);
            return undefined;
          }
          const match = requirementsList.find((req) => {
            const key = getField<string>(req, "requirement_key");
            const reqId = getField<string>(req, "requirement_id");
            const title = getField<string>(req, "title");
            return key === value || reqId === value || title === value;
          });
          const id = toNumberId(match ? getField(match, "id") : undefined);
          if (id === undefined) {
            missingRequirements.push(value);
          }
          return id;
        })
        .filter((id): id is number => typeof id === "number");
      if (missingRequirements.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "REQUIREMENT_NOT_FOUND",
                  message: `Requirement(s) not found: ${missingRequirements.join(", ")}`,
                },
              }),
            },
          ],
        };
      }
      resolvedFilter.requirements = {
        ...resolvedFilter.requirements,
        filterType: "number",
        type: normalizeTagMatchType(resolvedFilter.requirements.type),
        filter: resolvedIds,
      };
    }

    if (customFieldsNeedLookup && resolvedFilter && customFieldsList) {
      const resolvedFilterRecord = resolvedFilter as Record<string, unknown>;
      const customFieldNameMap = customFieldsList.reduce((map, cf) => {
        const name = getField<string>(cf, "name");
        const id = toNumberId(getField(cf, "id"));
        if (!name || id === undefined) {
          return map;
        }
        map.set(name, id);
        return map;
      }, new Map<string, number>());

      const missingCustomFields: string[] = [];
      customFieldNameKeys.forEach((key) => {
        const customFieldId = customFieldNameMap.get(key);
        if (customFieldId === undefined) {
          missingCustomFields.push(key);
          return;
        }
        const value = resolvedFilterRecord[key];
        delete resolvedFilterRecord[key];
        resolvedFilterRecord[`cf_${customFieldId}`] = value;
      });
      if (missingCustomFields.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "CUSTOM_FIELD_NOT_FOUND",
                  message: `Custom field(s) not found: ${missingCustomFields.join(", ")}`,
                },
              }),
            },
          ],
        };
      }
    }

    const result = await client.listTestCases({
      projectId: resolvedProjectId,
      suiteId: resolvedSuiteId,
      filter: resolvedFilter as TestCaseFilter | undefined,
      sort: sort,
      limit: limit,
      offset: offset,
    });

    // Priority labels
    const priorityLabels: Record<number, string> = {
      0: "Low",
      1: "Normal",
      2: "High",
    };

    // Transform rows to include human-readable labels
    const humanizedRows = result.rows.map((tc) => ({
      id: tc.id,
      title: tc.title,
      description: tc.description,
      priority: tc.priority,
      priorityLabel: priorityLabels[tc.priority] ?? "Unknown",
      suite: typeof tc.suite === "object" ? tc.suite?.id : tc.suite,
      suiteTitle: typeof tc.suite === "object" ? tc.suite?.title : tc.suite_title,
      project: typeof tc.project === "object" ? tc.project?.id : tc.project,
      projectTitle: typeof tc.project === "object" ? tc.project?.title : undefined,
      tags: tc.tags?.map((t) => ({ id: t.id, name: t.name })),
      createdBy: tc.created_by?.name,
      createdAt: tc.created_at,
      updatedAt: tc.updated_at,
      isAutomated: tc.is_automated === 1 || tc.is_automated === true,
      automationStatus: tc.automation_status,
      runCount: tc.run_count,
      lastRunOn: tc.last_run_on,
      steps: tc.steps ?? tc.stepsParsed,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            testCases: humanizedRows,
            totalCount: result.totalCount,
            filteredCount: result.filteredCount,
            returned: humanizedRows.length,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "API_ERROR",
              message: message,
            },
          }),
        },
      ],
    };
  }
}
