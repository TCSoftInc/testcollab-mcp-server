/**
 * list_test_cases MCP Tool
 *
 * Lists test cases with optional filtering, sorting, and pagination.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";

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
  filter: z.union([z.number(), z.array(z.number())]),
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
    last_run_status: numberFilterSchema.optional(),
    run_count: numberFilterSchema.optional(),
    avg_execution_time: numberFilterSchema.optional(),
    failure_rate: numberFilterSchema.optional(),
  })
  .catchall(filterConditionSchema);

// Main input schema for the tool
export const listTestCasesSchema = z.object({
  project_id: z.number().describe("Project ID (required)"),
  suite_id: z.number().optional().describe("Filter by suite ID"),
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
});

export type ListTestCasesInput = z.infer<typeof listTestCasesSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const listTestCasesTool = {
  name: "list_test_cases",
  description: `List test cases from a TestCollab project with optional filtering, sorting, and pagination.

Filter fields include:
- id, title, description, steps, priority (0=Low, 1=Normal, 2=High)
- suite, created_by, reviewer, poster (user IDs)
- created_at, updated_at, last_run_on (dates)
- tags, requirements (arrays of IDs)
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
        description: "Project ID (required)",
      },
      suite_id: {
        type: "number",
        description: "Filter by suite ID",
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
    required: ["project_id"],
  },
};

// ============================================================================
// Tool Handler
// ============================================================================

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

  try {
    const client = getApiClient();

    const result = await client.listTestCases({
      projectId: project_id,
      suiteId: suite_id,
      filter: filter,
      sort: sort,
      limit: limit,
      offset: offset,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
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
