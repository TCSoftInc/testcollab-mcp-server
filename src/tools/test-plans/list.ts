/**
 * list_test_plans MCP Tool
 *
 * Lists test plans with optional filtering, sorting, and pagination.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";
import { getCachedProjectContext } from "../../resources/project-context.js";

// ============================================================================
// Schema Definitions
// ============================================================================

const statusInputSchema = z.union([
  z.number().int().min(0).max(3),
  z.enum(["draft", "ready", "finished", "finished_with_failures"]),
]);

const priorityInputSchema = z.union([
  z.number().int().min(0).max(2),
  z.enum(["low", "normal", "high"]),
]);

const sortBySchema = z.enum([
  "updated_at",
  "created_at",
  "title",
  "priority",
  "status",
  "start_date",
  "end_date",
  "last_run",
]);

export const listTestPlansSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses TC_DEFAULT_PROJECT env var if not specified)"),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum results to return (1-100, default: 25)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of results to skip (default: 0)"),
  sort_by: sortBySchema
    .default("updated_at")
    .describe("Sort field (default: updated_at)"),
  sort_order: z
    .enum(["asc", "desc"])
    .default("desc")
    .describe("Sort order (default: desc)"),
  title_contains: z
    .string()
    .min(1)
    .optional()
    .describe("Filter plans whose title contains this string"),
  status: statusInputSchema
    .optional()
    .describe(
      'Filter by status: 0/"draft", 1/"ready", 2/"finished", 3/"finished_with_failures"'
    ),
  priority: priorityInputSchema
    .optional()
    .describe('Filter by priority: 0/"low", 1/"normal", 2/"high"'),
  archived: z
    .boolean()
    .optional()
    .describe("Filter by archived state"),
  created_by: z
    .number()
    .optional()
    .describe("Filter by creator user ID"),
  test_plan_folder: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Filter by test plan folder ID or folder title"),
  created_at_from: z
    .string()
    .optional()
    .describe("Filter by created_at >= this ISO date/time"),
  created_at_to: z
    .string()
    .optional()
    .describe("Filter by created_at <= this ISO date/time"),
  updated_at_from: z
    .string()
    .optional()
    .describe("Filter by updated_at >= this ISO date/time"),
  updated_at_to: z
    .string()
    .optional()
    .describe("Filter by updated_at <= this ISO date/time"),
  start_date_from: z
    .string()
    .optional()
    .describe("Filter by start_date >= this date (YYYY-MM-DD)"),
  start_date_to: z
    .string()
    .optional()
    .describe("Filter by start_date <= this date (YYYY-MM-DD)"),
  end_date_from: z
    .string()
    .optional()
    .describe("Filter by end_date >= this date (YYYY-MM-DD)"),
  end_date_to: z
    .string()
    .optional()
    .describe("Filter by end_date <= this date (YYYY-MM-DD)"),
  last_run_from: z
    .string()
    .optional()
    .describe("Filter by last_run >= this ISO date/time"),
  last_run_to: z
    .string()
    .optional()
    .describe("Filter by last_run <= this ISO date/time"),
  filter: z
    .record(z.unknown())
    .optional()
    .describe(
      "Advanced raw filter object (Strapi-style query keys, e.g. title_contains, created_at_gte, created_by, test_plan_folder)"
    ),
});

export type ListTestPlansInput = z.infer<typeof listTestPlansSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const listTestPlansTool = {
  name: "list_test_plans",
  description: `List test plans from a TestCollab project with optional filtering, sorting, and pagination.

Optional filters:
- title_contains
- status: 0/1/2/3 or draft/ready/finished/finished_with_failures
- priority: 0/1/2 or low/normal/high
- archived: true/false
- created_by: creator user ID
- test_plan_folder: folder ID or folder title
- created_at_from/to, updated_at_from/to, start_date_from/to, end_date_from/to, last_run_from/to
- filter: raw filter object for advanced keys (merged with explicit filters)

Example:
{
  "project_id": 16,
  "title_contains": "Release",
  "status": "ready",
  "priority": "high",
  "created_by": 27,
  "sort_by": "updated_at",
  "sort_order": "desc",
  "limit": 25,
  "offset": 0
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      project_id: {
        type: "number",
        description:
          "Project ID (optional if TC_DEFAULT_PROJECT env var is set)",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 25,
        description: "Maximum results to return (1-100, default: 25)",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Number of results to skip (default: 0)",
      },
      sort_by: {
        type: "string",
        enum: [
          "updated_at",
          "created_at",
          "title",
          "priority",
          "status",
          "start_date",
          "end_date",
          "last_run",
        ],
        default: "updated_at",
        description: "Sort field (default: updated_at)",
      },
      sort_order: {
        type: "string",
        enum: ["asc", "desc"],
        default: "desc",
        description: "Sort order (default: desc)",
      },
      title_contains: {
        type: "string",
        description: "Filter plans whose title contains this string",
      },
      status: {
        oneOf: [
          { type: "number", enum: [0, 1, 2, 3] },
          {
            type: "string",
            enum: ["draft", "ready", "finished", "finished_with_failures"],
          },
        ],
        description:
          'Filter by status: 0/"draft", 1/"ready", 2/"finished", 3/"finished_with_failures"',
      },
      priority: {
        oneOf: [
          { type: "number", enum: [0, 1, 2] },
          { type: "string", enum: ["low", "normal", "high"] },
        ],
        description: 'Filter by priority: 0/"low", 1/"normal", 2/"high"',
      },
      archived: {
        type: "boolean",
        description: "Filter by archived state",
      },
      created_by: {
        type: "number",
        description: "Filter by creator user ID",
      },
      test_plan_folder: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Filter by test plan folder ID or folder title",
      },
      created_at_from: {
        type: "string",
        description: "Filter by created_at >= this ISO date/time",
      },
      created_at_to: {
        type: "string",
        description: "Filter by created_at <= this ISO date/time",
      },
      updated_at_from: {
        type: "string",
        description: "Filter by updated_at >= this ISO date/time",
      },
      updated_at_to: {
        type: "string",
        description: "Filter by updated_at <= this ISO date/time",
      },
      start_date_from: {
        type: "string",
        description: "Filter by start_date >= this date (YYYY-MM-DD)",
      },
      start_date_to: {
        type: "string",
        description: "Filter by start_date <= this date (YYYY-MM-DD)",
      },
      end_date_from: {
        type: "string",
        description: "Filter by end_date >= this date (YYYY-MM-DD)",
      },
      end_date_to: {
        type: "string",
        description: "Filter by end_date <= this date (YYYY-MM-DD)",
      },
      last_run_from: {
        type: "string",
        description: "Filter by last_run >= this ISO date/time",
      },
      last_run_to: {
        type: "string",
        description: "Filter by last_run <= this ISO date/time",
      },
      filter: {
        type: "object",
        description:
          "Advanced raw filter object (Strapi-style query keys), merged with explicit filters",
        additionalProperties: true,
      },
    },
    required: [],
  },
};

// ============================================================================
// Helpers
// ============================================================================

const statusLabelToCode = {
  draft: 0,
  ready: 1,
  finished: 2,
  finished_with_failures: 3,
} as const;

const priorityLabelToCode = {
  low: 0,
  normal: 1,
  high: 2,
} as const;

const statusCodeToLabel: Record<number, string> = {
  0: "Draft",
  1: "Ready to Execute",
  2: "Finished",
  3: "Finished (with Failures)",
};

const priorityCodeToLabel: Record<number, string> = {
  0: "Low",
  1: "Normal",
  2: "High",
};

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

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionLabel = (value: string): string =>
  value.trim().toLowerCase();

type TestPlanFolderLookup = {
  id: number;
  title: string;
  normalizedTitle: string;
};

const mapTestPlanFoldersForLookup = (folders: unknown[]): TestPlanFolderLookup[] => {
  const deduped = new Map<number, TestPlanFolderLookup>();

  folders.forEach((folder) => {
    if (!folder || typeof folder !== "object") {
      return;
    }
    const record = folder as Record<string, unknown>;
    const id = toNumberId(record["id"]);
    const title = normalizeString(record["title"] ?? record["name"]);

    if (!id || !title) {
      return;
    }

    deduped.set(id, {
      id,
      title,
      normalizedTitle: normalizeOptionLabel(title),
    });
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle !== 0) {
      return byTitle;
    }
    return a.id - b.id;
  });
};

const findFoldersByTitle = (
  folders: TestPlanFolderLookup[],
  title: string
): TestPlanFolderLookup[] => {
  const normalized = normalizeOptionLabel(title);
  return folders.filter((folder) => folder.normalizedTitle === normalized);
};

const toStatusCode = (value: ListTestPlansInput["status"]): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return statusLabelToCode[value];
};

const toPriorityCode = (
  value: ListTestPlansInput["priority"]
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return priorityLabelToCode[value];
};

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleListTestPlans(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = listTestPlansSchema.safeParse(args);
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
    project_id,
    limit,
    offset,
    sort_by,
    sort_order,
    title_contains,
    status,
    priority,
    archived,
    created_by,
    test_plan_folder,
    created_at_from,
    created_at_to,
    updated_at_from,
    updated_at_to,
    start_date_from,
    start_date_to,
    end_date_from,
    end_date_to,
    last_run_from,
    last_run_to,
    filter,
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
    const mergedFilter: Record<string, unknown> = filter
      ? { ...filter }
      : {};

    if (test_plan_folder !== undefined) {
      const numericFolderId = toNumberId(test_plan_folder);
      if (numericFolderId !== undefined) {
        mergedFilter.test_plan_folder = numericFolderId;
      } else {
        const folderTitle = normalizeString(test_plan_folder);
        if (!folderTitle) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: "INVALID_TEST_PLAN_FOLDER",
                    message:
                      "test_plan_folder must be a numeric ID or non-empty folder title.",
                  },
                }),
              },
            ],
          };
        }

        const cachedContext = getCachedProjectContext(resolvedProjectId);
        const cachedFolders = mapTestPlanFoldersForLookup(
          Array.isArray(cachedContext?.test_plan_folders)
            ? cachedContext.test_plan_folders
            : []
        );

        let matchedFolders = findFoldersByTitle(cachedFolders, folderTitle);

        if (matchedFolders.length !== 1) {
          const folders = await client.listTestPlanFolders(resolvedProjectId);
          const liveFolders = mapTestPlanFoldersForLookup(
            Array.isArray(folders) ? folders : []
          );
          matchedFolders = findFoldersByTitle(liveFolders, folderTitle);
        }

        if (matchedFolders.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: "TEST_PLAN_FOLDER_NOT_FOUND",
                    message: `Test plan folder not found with title "${folderTitle}" in that project.`,
                  },
                }),
              },
            ],
          };
        }

        if (matchedFolders.length > 1) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: "AMBIGUOUS_TEST_PLAN_FOLDER",
                    message: `Multiple folders matched "${folderTitle}". Provide folder ID instead.`,
                    details: {
                      matching_ids: matchedFolders.map((folder) => folder.id),
                    },
                  },
                }),
              },
            ],
          };
        }

        mergedFilter.test_plan_folder = matchedFolders[0].id;
      }
    }

    if (title_contains !== undefined) {
      mergedFilter.title_contains = title_contains;
    }

    const statusCode = toStatusCode(status);
    if (statusCode !== undefined) {
      mergedFilter.status = statusCode;
    }

    const priorityCode = toPriorityCode(priority);
    if (priorityCode !== undefined) {
      mergedFilter.priority = priorityCode;
    }

    if (archived !== undefined) {
      mergedFilter.archived = archived;
    }

    if (created_by !== undefined) {
      mergedFilter.created_by = created_by;
    }

    if (created_at_from !== undefined) {
      mergedFilter.created_at_gte = created_at_from;
    }
    if (created_at_to !== undefined) {
      mergedFilter.created_at_lte = created_at_to;
    }
    if (updated_at_from !== undefined) {
      mergedFilter.updated_at_gte = updated_at_from;
    }
    if (updated_at_to !== undefined) {
      mergedFilter.updated_at_lte = updated_at_to;
    }
    if (start_date_from !== undefined) {
      mergedFilter.start_date_gte = start_date_from;
    }
    if (start_date_to !== undefined) {
      mergedFilter.start_date_lte = start_date_to;
    }
    if (end_date_from !== undefined) {
      mergedFilter.end_date_gte = end_date_from;
    }
    if (end_date_to !== undefined) {
      mergedFilter.end_date_lte = end_date_to;
    }
    if (last_run_from !== undefined) {
      mergedFilter.last_run_gte = last_run_from;
    }
    if (last_run_to !== undefined) {
      mergedFilter.last_run_lte = last_run_to;
    }

    const rows = await client.listTestPlans({
      projectId: resolvedProjectId,
      limit,
      offset,
      sort: `${sort_by}:${sort_order}`,
      ...(Object.keys(mergedFilter).length > 0 ? { filter: mergedFilter } : {}),
    });

    const testPlans = rows.map((plan) => {
      const planStatus =
        typeof plan.status === "number" ? statusCodeToLabel[plan.status] : undefined;
      const planPriority =
        typeof plan.priority === "number"
          ? priorityCodeToLabel[plan.priority]
          : undefined;

      return {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        status: plan.status,
        statusLabel: planStatus ?? "Unknown",
        priority: plan.priority,
        priorityLabel: planPriority ?? "Unknown",
        archived: plan.archived,
        testPlanFolder: plan.testPlanFolder
          ? {
              id: plan.testPlanFolder.id,
              title: plan.testPlanFolder.title,
            }
          : null,
        createdBy: plan.createdBy
          ? {
              id: plan.createdBy.id,
              name: plan.createdBy.name,
              ...(plan.createdBy.username
                ? { username: plan.createdBy.username }
                : {}),
            }
          : null,
        assignedTo: (plan.assignedTo ?? []).map((user) => ({
          id: user.id,
          name: user.name,
          ...(user.username ? { username: user.username } : {}),
        })),
        startDate: plan.startDate,
        endDate: plan.endDate,
        actualStartDate: plan.actualStartDate,
        lastRun: plan.lastRun,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              testPlans,
              returned: testPlans.length,
              limit,
              offset,
              hasMore: testPlans.length === limit,
            },
            null,
            2
          ),
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
              message,
            },
          }),
        },
      ],
    };
  }
}
