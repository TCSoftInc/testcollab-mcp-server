/**
 * update_test_plan MCP Tool
 *
 * Updates an existing test plan in TestCollab with support for partial updates.
 */

import { z } from "zod";
import {
  getApiClient,
  type TestCaseSelectorCollection,
  type TestCaseSelectorQuery,
} from "../../client/api-client.js";
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

const customFieldSchema = z.object({
  id: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Custom field ID (number) or field name"),
  name: z.string().min(1).describe("Custom field system name"),
  label: z.string().optional().describe("Custom field display label"),
  value: z
    .union([
      z.string(),
      z.number(),
      z.null(),
      z.array(z.union([z.string(), z.number()])),
    ])
    .describe(
      "Custom field value (string/number/null, or array for multi-select)"
    ),
  valueLabel: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Display label for selected option(s)"),
  color: z.string().optional().describe("Color metadata for the value label"),
});

const filterQuerySchema = z.object({
  field: z.string().min(1).describe("Filter field name"),
  operator: z.string().min(1).describe("Filter operator"),
  value: z.string().describe("Filter value"),
});

const assignmentSchema = z.object({
  executor: z
    .enum(["me", "team"])
    .default("team")
    .describe("Assignment executor mode"),
  assignment_criteria: z
    .enum(["testCase", "configuration"])
    .default("testCase")
    .describe("Assignment criteria"),
  assignment_method: z
    .enum(["automatic", "manual"])
    .default("automatic")
    .describe("Assignment method"),
  user_ids: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe(
      'Users to receive assignment (user ID, "me", name, username, or email)'
    ),
  test_case_ids: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Test case IDs for test-case level assignment"),
  selector: z
    .array(filterQuerySchema)
    .optional()
    .describe("Selector for assignment target test cases"),
  configuration_ids: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Configuration IDs for configuration-level assignment"),
});

export const updateTestPlanSchema = z.object({
  id: z.number().describe("Test plan ID to update (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  title: z.string().min(1).optional().describe("New test plan title"),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("New test plan description (HTML supported, null to clear)"),
  priority: priorityInputSchema
    .optional()
    .describe('Priority: 0/1/2 or "low"/"normal"/"high"'),
  status: statusInputSchema
    .optional()
    .describe(
      'Status: 0/1/2/3 or "draft"/"ready"/"finished"/"finished_with_failures"'
    ),
  test_plan_folder: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe("Test plan folder ID or title (null to place at root)"),
  release: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe("Release ID or title (null to clear)"),
  start_date: z
    .string()
    .nullable()
    .optional()
    .describe("Planned start date (YYYY-MM-DD, null to clear)"),
  end_date: z
    .string()
    .nullable()
    .optional()
    .describe("Planned end date (YYYY-MM-DD, null to clear)"),
  archived: z.boolean().optional().describe("Archive/unarchive this test plan"),
  custom_fields: z
    .array(customFieldSchema)
    .nullable()
    .optional()
    .describe("Array of test plan custom field values (null/[] to clear)"),
  assignee: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      'Convenience field to assign plan to one user (user ID, "me", name, username, or email)'
    ),
  assignment: assignmentSchema
    .optional()
    .describe("Assignment payload to execute after update"),
});

export type UpdateTestPlanInput = z.infer<typeof updateTestPlanSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const updateTestPlanTool = {
  name: "update_test_plan",
  description: `Update an existing test plan in TestCollab.

Required:
- id (test plan ID)

All other fields are optional and only provided fields are updated.

Fields:
- title
- description (null to clear)
- priority: 0/1/2 or low/normal/high
- status: 0/1/2/3 or draft/ready/finished/finished_with_failures
- test_plan_folder: ID/title/null
- release: ID/title/null
- start_date, end_date (null to clear)
- archived
- custom_fields (null/[] to clear)
- assignee (single-user convenience)
- assignment (advanced assignment payload)

Example:
{
  "id": 812,
  "title": "Release 3.0 Regression",
  "status": "ready",
  "test_plan_folder": "Mobile",
  "assignee": "me"
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Test plan ID to update (required)",
      },
      project_id: {
        type: "number",
        description:
          "Project ID (optional if TC_DEFAULT_PROJECT env var is set)",
      },
      title: {
        type: "string",
        description: "New test plan title",
      },
      description: {
        oneOf: [{ type: "string" }, { type: "null" }],
        description: "New test plan description (HTML supported, null to clear)",
      },
      priority: {
        oneOf: [
          { type: "number", enum: [0, 1, 2] },
          { type: "string", enum: ["low", "normal", "high"] },
        ],
        description: 'Priority: 0/1/2 or "low"/"normal"/"high"',
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
          'Status: 0/1/2/3 or "draft"/"ready"/"finished"/"finished_with_failures"',
      },
      test_plan_folder: {
        oneOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
        description: "Test plan folder ID or title (null to place at root)",
      },
      release: {
        oneOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
        description: "Release ID or title (null to clear)",
      },
      start_date: {
        oneOf: [{ type: "string" }, { type: "null" }],
        description: "Planned start date (YYYY-MM-DD, null to clear)",
      },
      end_date: {
        oneOf: [{ type: "string" }, { type: "null" }],
        description: "Planned end date (YYYY-MM-DD, null to clear)",
      },
      archived: {
        type: "boolean",
        description: "Archive/unarchive this test plan",
      },
      custom_fields: {
        oneOf: [
          {
            type: "array",
            description: "Array of test plan custom field values",
            items: {
              type: "object",
              properties: {
                id: { oneOf: [{ type: "number" }, { type: "string" }] },
                name: { type: "string" },
                label: { type: "string" },
                value: {
                  oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "null" },
                    {
                      type: "array",
                      items: { oneOf: [{ type: "string" }, { type: "number" }] },
                    },
                  ],
                },
                valueLabel: {
                  oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                color: { type: "string" },
              },
              required: ["name", "value"],
            },
          },
          { type: "null" },
        ],
      },
      assignee: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description:
          'Convenience field to assign plan to one user (user ID, "me", name, username, or email)',
      },
      assignment: {
        type: "object",
        description: "Assignment payload to execute after update",
        properties: {
          executor: { type: "string", enum: ["me", "team"] },
          assignment_criteria: {
            type: "string",
            enum: ["testCase", "configuration"],
          },
          assignment_method: {
            type: "string",
            enum: ["automatic", "manual"],
          },
          user_ids: {
            type: "array",
            items: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
          test_case_ids: {
            type: "array",
            items: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
          selector: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                operator: { type: "string" },
                value: { type: "string" },
              },
              required: ["field", "operator", "value"],
            },
          },
          configuration_ids: {
            type: "array",
            items: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
        },
      },
    },
    required: ["id"],
  },
};

// ============================================================================
// Helpers
// ============================================================================

type ToolResponse = { content: Array<{ type: "text"; text: string }> };

type CustomFieldResolvedValue = string | number | Array<string | number> | null;

type OptionLookup = {
  id: string;
  label: string;
  normalizedLabel: string;
};

type CustomFieldDefinition = {
  id: number;
  name: string;
  label?: string;
  fieldType?: string;
  options: OptionLookup[];
};

type ProjectUserLookup = {
  id: number;
  name: string;
  username?: string;
  email?: string;
  normalizedName: string;
  normalizedUsername?: string;
  normalizedEmail?: string;
};

type TestPlanFolderLookup = {
  id: number;
  title: string;
  normalizedTitle: string;
};

type ReleaseLookup = {
  id: number;
  title: string;
  normalizedTitle: string;
};

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

const isNonNumericString = (value: unknown): value is string => {
  const normalized = normalizeString(value);
  return typeof normalized === "string" && !numericIdPattern.test(normalized);
};

const normalizeOptionLabel = (value: string): string =>
  value.trim().toLowerCase();

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

const getCompanyIdFromProject = (project: unknown): number | undefined => {
  const normalized = unwrapApiData(project);
  const rawCompany =
    getField(normalized, "company") ??
    getField(normalized, "company_id") ??
    getField(normalized, "companyId");
  return extractId(rawCompany);
};

const buildOptionLookup = (optionsRaw: unknown): OptionLookup[] => {
  if (!Array.isArray(optionsRaw)) {
    return [];
  }

  const lookups: OptionLookup[] = [];

  optionsRaw.forEach((option, index) => {
    if (typeof option === "string") {
      const label = option.trim();
      if (!label) {
        return;
      }
      lookups.push({
        id: String(index + 1),
        label,
        normalizedLabel: normalizeOptionLabel(label),
      });
      return;
    }

    if (typeof option === "number") {
      const value = String(option);
      lookups.push({
        id: value,
        label: value,
        normalizedLabel: normalizeOptionLabel(value),
      });
      return;
    }

    if (!option || typeof option !== "object") {
      return;
    }

    const labelRaw =
      getField<string>(option, "label") ?? getField<string>(option, "name");
    const label = normalizeString(labelRaw);
    const idRaw =
      getField<string | number>(option, "id") ??
      getField<string | number>(option, "value") ??
      getField<string | number>(option, "systemValue");
    const id =
      idRaw !== undefined && idRaw !== null ? String(idRaw).trim() : undefined;

    if (label && id) {
      lookups.push({
        id,
        label,
        normalizedLabel: normalizeOptionLabel(label),
      });
      return;
    }

    if (label && !id) {
      lookups.push({
        id: String(index + 1),
        label,
        normalizedLabel: normalizeOptionLabel(label),
      });
      return;
    }

    if (!label && id) {
      lookups.push({
        id,
        label: id,
        normalizedLabel: normalizeOptionLabel(id),
      });
    }
  });

  return lookups;
};

const findOptionByLabel = (
  options: OptionLookup[],
  label: string
): OptionLookup | undefined => {
  const normalized = normalizeOptionLabel(label);
  return options.find((option) => option.normalizedLabel === normalized);
};

const isDropdownFieldType = (value: unknown): boolean =>
  normalizeString(value)?.toLowerCase() === "dropdown";

const isMultiSelectFieldType = (value: unknown): boolean =>
  normalizeString(value)?.toLowerCase() === "multipleselect";

const dedupeNumbers = (values: number[]): number[] => Array.from(new Set(values));

const normalizeNumberIds = (values: Array<number | string> | undefined): number[] =>
  dedupeNumbers(
    (values ?? [])
      .map((value) => toNumberId(value))
      .filter((value): value is number => value !== undefined)
  );

type ResolvedAssigneeValue = number | "me";

const normalizeAssignee = (
  value: unknown
): ResolvedAssigneeValue | string | undefined => {
  const numeric = toNumberId(value);
  if (numeric !== undefined) {
    return numeric;
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase() === "me") {
    return "me";
  }
  return normalized;
};

const normalizeAssignmentUsers = (
  values: Array<number | string> | undefined
): {
  userIds: number[];
  userLookups: string[];
  hasMe: boolean;
  invalidValues: string[];
} => {
  const userIds: number[] = [];
  const userLookups: string[] = [];
  const invalidValues: string[] = [];
  let hasMe = false;

  (values ?? []).forEach((value) => {
    const numeric = toNumberId(value);
    if (numeric !== undefined) {
      userIds.push(numeric);
      return;
    }

    const normalized = normalizeString(value);
    if (!normalized) {
      invalidValues.push(String(value));
      return;
    }

    if (normalized.toLowerCase() === "me") {
      hasMe = true;
      return;
    }

    userLookups.push(normalized);
  });

  return {
    userIds: dedupeNumbers(userIds),
    userLookups: Array.from(new Set(userLookups)),
    hasMe,
    invalidValues: Array.from(new Set(invalidValues)),
  };
};

const mapProjectUsersForLookup = (projectUsers: unknown[]): ProjectUserLookup[] => {
  const deduped = new Map<number, ProjectUserLookup>();

  projectUsers.forEach((projectUser) => {
    const rawUser = getField<unknown>(projectUser, "user");
    const userObject =
      rawUser && typeof rawUser === "object"
        ? (rawUser as Record<string, unknown>)
        : undefined;

    const id =
      (userObject ? toNumberId(getField(userObject, "id")) : undefined) ??
      toNumberId(rawUser) ??
      toNumberId(getField(projectUser, "user_id")) ??
      toNumberId(getField(projectUser, "userId"));

    if (!id) {
      return;
    }

    const name =
      (userObject ? normalizeString(getField<string>(userObject, "name")) : undefined) ??
      normalizeString(getField<string>(projectUser, "name")) ??
      `User ${id}`;
    const username =
      (userObject
        ? normalizeString(getField<string>(userObject, "username"))
        : undefined) ?? normalizeString(getField<string>(projectUser, "username"));
    const email =
      (userObject ? normalizeString(getField<string>(userObject, "email")) : undefined) ??
      normalizeString(getField<string>(projectUser, "email"));

    deduped.set(id, {
      id,
      name,
      ...(username ? { username } : {}),
      ...(email ? { email } : {}),
      normalizedName: normalizeOptionLabel(name),
      ...(username ? { normalizedUsername: normalizeOptionLabel(username) } : {}),
      ...(email ? { normalizedEmail: normalizeOptionLabel(email) } : {}),
    });
  });

  return Array.from(deduped.values()).sort((a, b) => a.id - b.id);
};

const findProjectUserMatches = (
  users: ProjectUserLookup[],
  query: string
): ProjectUserLookup[] => {
  const normalizedQuery = normalizeOptionLabel(query);
  return users.filter(
    (user) =>
      user.normalizedName === normalizedQuery ||
      user.normalizedUsername === normalizedQuery ||
      user.normalizedEmail === normalizedQuery
  );
};

const mapTestPlanFoldersForLookup = (folders: unknown[]): TestPlanFolderLookup[] => {
  const deduped = new Map<number, TestPlanFolderLookup>();

  folders.forEach((folder) => {
    const id = toNumberId(getField(folder, "id"));
    const title =
      normalizeString(getField<string>(folder, "title")) ??
      normalizeString(getField<string>(folder, "name"));

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

const mapReleasesForLookup = (releases: unknown[]): ReleaseLookup[] => {
  const deduped = new Map<number, ReleaseLookup>();

  releases.forEach((release) => {
    const id = toNumberId(getField(release, "id"));
    const title =
      normalizeString(getField<string>(release, "title")) ??
      normalizeString(getField<string>(release, "name"));

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

const findReleasesByTitle = (
  releases: ReleaseLookup[],
  title: string
): ReleaseLookup[] => {
  const normalized = normalizeOptionLabel(title);
  return releases.filter((release) => release.normalizedTitle === normalized);
};

const toSelectorCollection = (
  testCaseIds: number[],
  selector: TestCaseSelectorQuery[] | undefined
): TestCaseSelectorCollection => ({
  testCases: testCaseIds,
  selector: selector ?? [],
});

const toStatusCode = (value: UpdateTestPlanInput["status"]): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return statusLabelToCode[value];
};

const toPriorityCode = (
  value: UpdateTestPlanInput["priority"]
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return priorityLabelToCode[value];
};

const apiFailureMessage = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const status = record["status"];
  const response = record["response"];
  const responseRecord =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : undefined;

  const toMessage = (container: Record<string, unknown>): string | undefined => {
    const message = normalizeString(container["message"]);
    if (message) {
      return message;
    }
    const title = normalizeString(container["title"]);
    if (title) {
      return title;
    }
    const errorText = normalizeString(container["error"]);
    if (errorText) {
      return errorText;
    }
    return undefined;
  };

  if (status === false) {
    return toMessage(record) ?? "API operation failed";
  }
  if (typeof status === "number" && status >= 400) {
    return toMessage(record) ?? `API operation failed with status ${status}`;
  }
  if (
    responseRecord &&
    typeof responseRecord["status"] === "number" &&
    (responseRecord["status"] as number) >= 400
  ) {
    return toMessage(responseRecord) ?? "API operation failed";
  }

  return undefined;
};

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return "Unknown error";
};

const isNoAssignableItemsError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("no testcases found") ||
    normalized.includes("no configurations found")
  );
};

const toToolResponse = (payload: unknown, pretty = false): ToolResponse => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(payload, null, pretty ? 2 : undefined),
    },
  ],
});

const toError = (code: string, message: string, details?: unknown): ToolResponse =>
  toToolResponse({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleUpdateTestPlan(args: unknown): Promise<ToolResponse> {
  const parsed = updateTestPlanSchema.safeParse(args);
  if (!parsed.success) {
    return toError("VALIDATION_ERROR", "Invalid input parameters", parsed.error.errors);
  }

  const {
    id,
    project_id,
    title,
    description,
    priority,
    status,
    test_plan_folder,
    release,
    start_date,
    end_date,
    archived,
    custom_fields,
    assignee,
    assignment,
  } = parsed.data;

  const rawArgs = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const hasField = (key: string) => Object.prototype.hasOwnProperty.call(rawArgs, key);

  const metadataFieldNames = [
    "title",
    "description",
    "priority",
    "status",
    "test_plan_folder",
    "release",
    "start_date",
    "end_date",
    "archived",
    "custom_fields",
  ] as const;
  const assignmentFieldNames = ["assignee", "assignment"] as const;
  const hasMetadataUpdate = metadataFieldNames.some((field) => hasField(field));
  const hasAssignmentUpdate = assignmentFieldNames.some((field) => hasField(field));
  const userSuppliedUpdatableFields = [
    ...metadataFieldNames,
    ...assignmentFieldNames,
  ].filter((field) => hasField(field));

  if (hasField("assignee") && hasField("assignment")) {
    return toError(
      "INVALID_INPUT",
      "Provide either assignee or assignment, not both."
    );
  }

  if (!hasMetadataUpdate && !hasAssignmentUpdate) {
    return toError(
      "INVALID_INPUT",
      "No updatable fields provided. Supply at least one metadata or assignment field to update."
    );
  }

  const requestContext = getRequestContext();
  const envConfig = requestContext ? null : getConfig();
  const resolvedProjectId =
    project_id ?? requestContext?.defaultProjectId ?? envConfig?.defaultProjectId;

  if (!resolvedProjectId) {
    return toError(
      "MISSING_PROJECT_ID",
      "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT."
    );
  }

  try {
    const client = getApiClient();

    let updatedId = id;
    let updatedTitle: string | undefined;

    if (hasMetadataUpdate) {
      const existingRaw = await client.getTestPlanRaw(id);
      const existing = unwrapApiEntity(existingRaw);

      if (!existing) {
        return toError(
          "INVALID_TEST_PLAN",
          `Unable to load test plan ${id} for update.`
        );
      }

      const existingTitle = normalizeString(getField<string>(existing, "title"));
      const existingPriority = toNumberId(getField(existing, "priority"));
      const existingStatus = toNumberId(getField(existing, "status"));
      const existingFolderRaw =
        getField(existing, "test_plan_folder") ?? getField(existing, "testPlanFolder");
      const existingFolderId =
        existingFolderRaw === null
          ? null
          : extractId(existingFolderRaw) ?? toNumberId(existingFolderRaw);
      const existingReleaseRaw = getField(existing, "release");
      const existingReleaseId =
        existingReleaseRaw === null
          ? null
          : extractId(existingReleaseRaw) ?? toNumberId(existingReleaseRaw);

      const resolvedTitle = title ?? existingTitle;
      const resolvedPriority = toPriorityCode(priority) ?? existingPriority;
      const resolvedStatus = toStatusCode(status) ?? existingStatus;

      if (!resolvedTitle || resolvedPriority === undefined || resolvedStatus === undefined) {
        return toError(
          "INVALID_EXISTING_TEST_PLAN",
          "Unable to resolve required test plan fields (title, priority, status) for update.",
          {
            missing: [
              ...(!resolvedTitle ? ["title"] : []),
              ...(resolvedPriority === undefined ? ["priority"] : []),
              ...(resolvedStatus === undefined ? ["status"] : []),
            ],
          }
        );
      }

      let resolvedFolderId: number | null = existingFolderId ?? null;
      if (hasField("test_plan_folder")) {
        if (test_plan_folder === null) {
          resolvedFolderId = null;
        } else {
          const numericFolderId = toNumberId(test_plan_folder);
          if (numericFolderId !== undefined) {
            resolvedFolderId = numericFolderId;
          } else {
            const folderTitle = normalizeString(test_plan_folder);
            if (!folderTitle) {
              return toError(
                "INVALID_TEST_PLAN_FOLDER",
                "test_plan_folder must be a numeric ID, non-empty title, or null."
              );
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
              return toError(
                "TEST_PLAN_FOLDER_NOT_FOUND",
                `Test plan folder not found with title "${folderTitle}" in that project.`
              );
            }

            if (matchedFolders.length > 1) {
              const matchingIds = matchedFolders.map((folder) => folder.id);
              return toError(
                "AMBIGUOUS_TEST_PLAN_FOLDER",
                `Multiple folders matched "${folderTitle}". Provide folder ID instead.`,
                { matching_ids: matchingIds }
              );
            }

            resolvedFolderId = matchedFolders[0].id;
          }
        }
      }

      let resolvedReleaseId: number | null = existingReleaseId ?? null;
      if (hasField("release")) {
        if (release === null) {
          resolvedReleaseId = null;
        } else {
          const numericReleaseId = toNumberId(release);
          if (numericReleaseId !== undefined) {
            resolvedReleaseId = numericReleaseId;
          } else {
            const releaseTitle = normalizeString(release);
            if (!releaseTitle) {
              return toError(
                "INVALID_RELEASE",
                "release must be a numeric ID, non-empty title, or null."
              );
            }

            const cachedContext = getCachedProjectContext(resolvedProjectId);
            const cachedReleases = mapReleasesForLookup(
              Array.isArray(cachedContext?.releases) ? cachedContext.releases : []
            );

            let matchedReleases = findReleasesByTitle(cachedReleases, releaseTitle);

            if (matchedReleases.length !== 1) {
              const releases = await client.listReleases(resolvedProjectId);
              const liveReleases = mapReleasesForLookup(
                Array.isArray(releases) ? releases : []
              );
              matchedReleases = findReleasesByTitle(liveReleases, releaseTitle);
            }

            if (matchedReleases.length === 0) {
              return toError(
                "RELEASE_NOT_FOUND",
                `Release not found with title "${releaseTitle}" in that project.`
              );
            }

            if (matchedReleases.length > 1) {
              const matchingIds = matchedReleases.map((item) => item.id);
              return toError(
                "AMBIGUOUS_RELEASE",
                `Multiple releases matched "${releaseTitle}". Provide release ID instead.`,
                { matching_ids: matchingIds }
              );
            }

            resolvedReleaseId = matchedReleases[0].id;
          }
        }
      }

      let resolvedCustomFields:
        | Array<{
            id: number;
            name: string;
            label?: string;
            value: CustomFieldResolvedValue;
            valueLabel?: string | string[];
            color?: string;
          }>
        | undefined;

      if (hasField("custom_fields")) {
        const customFieldsInput = custom_fields;
        if (!customFieldsInput || customFieldsInput.length === 0) {
          resolvedCustomFields = [];
        } else {
          const project = await client.getProject(resolvedProjectId);
          const companyId = getCompanyIdFromProject(project);
          const customFieldList = await client.listProjectCustomFields(
            resolvedProjectId,
            companyId,
            "TestPlan"
          );

          const definitionsByName = new Map<string, CustomFieldDefinition>();
          const definitionsById = new Map<number, CustomFieldDefinition>();

          customFieldList.forEach((field) => {
            const fieldId = toNumberId(getField(field, "id"));
            const name = normalizeString(getField<string>(field, "name"));
            if (fieldId === undefined || !name) {
              return;
            }

            const fieldType =
              getField<string>(field, "field_type") ?? getField<string>(field, "type");
            const directOptions = getField<unknown[]>(field, "options");
            const extra = getField<Record<string, unknown>>(field, "extra");
            const extraOptions = extra ? getField<unknown[]>(extra, "options") : undefined;
            const options = buildOptionLookup(directOptions ?? extraOptions ?? []);

            const definition: CustomFieldDefinition = {
              id: fieldId,
              name,
              label: normalizeString(getField<string>(field, "label")),
              fieldType: normalizeString(fieldType),
              options,
            };
            definitionsByName.set(name, definition);
            definitionsById.set(fieldId, definition);
          });

          const missingFields: string[] = [];
          resolvedCustomFields = customFieldsInput
            .map((field) => {
              const fieldId = toNumberId(field.id);
              const byId = fieldId !== undefined ? definitionsById.get(fieldId) : undefined;
              const byName = definitionsByName.get(field.name);
              const definition = byId ?? byName;

              if (!definition && fieldId === undefined) {
                missingFields.push(field.name);
                return undefined;
              }

              const resolvedId = definition?.id ?? fieldId;
              if (resolvedId === undefined) {
                missingFields.push(field.name);
                return undefined;
              }

              let resolvedValue: CustomFieldResolvedValue = field.value;
              let resolvedValueLabel: string | string[] | undefined = field.valueLabel;

              if (definition && isDropdownFieldType(definition.fieldType)) {
                if (Array.isArray(field.value)) {
                  throw new Error(
                    `Custom field "${definition.name}" expects a single value, not an array.`
                  );
                }

                if (isNonNumericString(field.value)) {
                  const matchedOption = findOptionByLabel(definition.options, field.value);
                  if (!matchedOption) {
                    throw new Error(
                      `Custom field option "${field.value}" not found for "${definition.name}".`
                    );
                  }
                  resolvedValue = matchedOption.id;
                  resolvedValueLabel =
                    typeof field.valueLabel === "string" && field.valueLabel.trim().length > 0
                      ? field.valueLabel
                      : matchedOption.label;
                }
              }

              if (definition && isMultiSelectFieldType(definition.fieldType)) {
                const inputValues = Array.isArray(field.value) ? field.value : [field.value];
                const outputValues: Array<string | number> = [];
                const outputLabels: string[] = [];

                inputValues.forEach((inputValue) => {
                  const numeric = toNumberId(inputValue);
                  if (numeric !== undefined) {
                    outputValues.push(numeric);
                    return;
                  }
                  if (isNonNumericString(inputValue)) {
                    const matchedOption = findOptionByLabel(
                      definition.options,
                      inputValue
                    );
                    if (!matchedOption) {
                      throw new Error(
                        `Custom field option "${inputValue}" not found for "${definition.name}".`
                      );
                    }
                    outputValues.push(matchedOption.id);
                    outputLabels.push(matchedOption.label);
                  }
                });

                resolvedValue = outputValues;
                if (Array.isArray(field.valueLabel)) {
                  resolvedValueLabel = field.valueLabel;
                } else if (outputLabels.length > 0) {
                  resolvedValueLabel = outputLabels;
                }
              }

              return {
                id: resolvedId,
                name: definition?.name ?? field.name,
                ...(field.label !== undefined
                  ? { label: field.label }
                  : definition?.label
                    ? { label: definition.label }
                    : {}),
                value: resolvedValue,
                ...(resolvedValueLabel !== undefined
                  ? { valueLabel: resolvedValueLabel }
                  : {}),
                ...(field.color !== undefined ? { color: field.color } : {}),
              };
            })
            .filter(
              (
                field
              ): field is {
                id: number;
                name: string;
                label?: string;
                value: CustomFieldResolvedValue;
                valueLabel?: string | string[];
                color?: string;
              } => field !== undefined
            );

          if (missingFields.length > 0) {
            return toError(
              "CUSTOM_FIELD_NOT_FOUND",
              `Custom field(s) not found: ${Array.from(new Set(missingFields)).join(", ")}`
            );
          }
        }
      }

      const updateResult = await client.updateTestPlan(id, {
        projectId: resolvedProjectId,
        title: resolvedTitle,
        priority: resolvedPriority,
        status: resolvedStatus,
        testPlanFolderId: resolvedFolderId,
        release: resolvedReleaseId,
        ...(hasField("description") ? { description: description ?? null } : {}),
        ...(hasField("start_date") ? { startDate: start_date ?? null } : {}),
        ...(hasField("end_date") ? { endDate: end_date ?? null } : {}),
        ...(hasField("archived") ? { archived } : {}),
        ...(hasField("custom_fields")
          ? { customFields: resolvedCustomFields ?? [] }
          : {}),
      });

      const updateFailure = apiFailureMessage(updateResult);
      if (updateFailure) {
        return toToolResponse(
          {
            error: {
              code: "UPDATE_TEST_PLAN_FAILED",
              message: updateFailure,
            },
          },
          true
        );
      }

      updatedId = extractId(updateResult) ?? id;
      updatedTitle =
        normalizeString(getField<string>(updateResult, "title")) ?? resolvedTitle;
    }

    let assignResult: Record<string, unknown> | undefined;
    if (hasAssignmentUpdate) {
      const assigneeInputProvided = hasField("assignee");
      const assignmentInputProvided = hasField("assignment");

      if (assignmentInputProvided && !assignment) {
        return toError(
          "INVALID_INPUT",
          "assignment must be an object when provided."
        );
      }

      const normalizedAssignee = assigneeInputProvided
        ? normalizeAssignee(assignee)
        : undefined;

      if (assigneeInputProvided && normalizedAssignee === undefined) {
        return toError(
          "INVALID_ASSIGNEE",
          'assignee must be a user ID, "me", name, username, or email.'
        );
      }

      const assignmentInput = assignmentInputProvided
        ? assignment
        : {
            executor:
              normalizedAssignee === "me" ? ("me" as const) : ("team" as const),
            assignment_criteria: "testCase" as const,
            assignment_method: "automatic" as const,
            user_ids:
              normalizedAssignee !== undefined
                ? [normalizedAssignee]
                : undefined,
            test_case_ids: [] as Array<number | string>,
            selector: [] as TestCaseSelectorQuery[],
            configuration_ids: [] as Array<number | string>,
          };

      const assignmentUsers = normalizeAssignmentUsers(assignmentInput?.user_ids);
      if (assignmentUsers.invalidValues.length > 0) {
        return toError(
          "INVALID_ASSIGNMENT_USERS",
          "assignment.user_ids contains invalid values.",
          { invalid_values: assignmentUsers.invalidValues }
        );
      }
      if (
        assignmentUsers.hasMe &&
        (assignmentUsers.userIds.length > 0 || assignmentUsers.userLookups.length > 0)
      ) {
        return toError(
          "INVALID_ASSIGNMENT_USERS",
          'assignment.user_ids cannot mix "me" with user IDs or user names.'
        );
      }

      const assignmentTargetsMe =
        assignmentUsers.hasMe || assignmentInput?.executor === "me";
      const resolvedAssignmentExecutor: "me" | "team" = assignmentTargetsMe
        ? "me"
        : (assignmentInput?.executor ?? "team");
      const assignmentCriteria: "testCase" | "configuration" =
        assignmentInput?.assignment_criteria ?? "testCase";
      const assignmentMethod: "automatic" | "manual" =
        assignmentInput?.assignment_method ?? "automatic";
      const assignmentTestCaseIds = normalizeNumberIds(
        assignmentInput?.test_case_ids
      );
      const assignmentConfigurationIds = normalizeNumberIds(
        assignmentInput?.configuration_ids
      );
      const assignmentSelector = assignmentInput?.selector ?? [];

      if (
        assignmentMethod === "manual" &&
        !assignmentTargetsMe &&
        assignmentUsers.userIds.length === 0 &&
        assignmentUsers.userLookups.length === 0
      ) {
        return toError(
          "MISSING_ASSIGNMENT_USERS",
          "Manual assignment requires at least one user_id in assignment.user_ids."
        );
      }

      if (
        assignmentMethod === "manual" &&
        assignmentCriteria === "testCase" &&
        assignmentTestCaseIds.length === 0 &&
        assignmentSelector.length === 0
      ) {
        return toError(
          "MISSING_ASSIGNMENT_TEST_CASES",
          "Manual testCase assignment requires assignment.test_case_ids or assignment.selector."
        );
      }

      if (
        assignmentMethod === "manual" &&
        assignmentCriteria === "configuration" &&
        assignmentConfigurationIds.length === 0
      ) {
        return toError(
          "MISSING_ASSIGNMENT_CONFIGURATIONS",
          "Manual configuration assignment requires assignment.configuration_ids."
        );
      }

      let resolvedAssignmentUserIds = assignmentUsers.userIds;
      if (assignmentUsers.userLookups.length > 0) {
        const projectUsersRaw = await client.listProjectUsers(resolvedProjectId);
        const projectUsers = mapProjectUsersForLookup(
          Array.isArray(projectUsersRaw) ? projectUsersRaw : []
        );

        const toUserMatchPayload = (user: ProjectUserLookup) => ({
          id: user.id,
          name: user.name,
          ...(user.username ? { username: user.username } : {}),
          ...(user.email ? { email: user.email } : {}),
        });

        const resolvedLookupIds: number[] = [];
        for (const lookup of assignmentUsers.userLookups) {
          const matches = findProjectUserMatches(projectUsers, lookup);
          if (matches.length === 0) {
            return toError(
              "ASSIGNEE_NOT_FOUND",
              `No project user matched "${lookup}" for assignment.user_ids.`,
              { field: "assignment.user_ids", lookup }
            );
          }
          if (matches.length > 1) {
            return toError(
              "AMBIGUOUS_ASSIGNEE",
              `Multiple project users matched "${lookup}" for assignment.user_ids. Use a numeric user ID.`,
              {
                field: "assignment.user_ids",
                lookup,
                matches: matches.map(toUserMatchPayload),
              }
            );
          }
          resolvedLookupIds.push(matches[0].id);
        }

        resolvedAssignmentUserIds = dedupeNumbers([
          ...resolvedAssignmentUserIds,
          ...resolvedLookupIds,
        ]);
      }

      const assignmentUsersForPayload: Array<number | "me"> =
        resolvedAssignmentExecutor === "me"
          ? ["me"]
          : resolvedAssignmentUserIds;
      const assignmentTestCasesForPayload =
        assignmentCriteria === "configuration"
          ? null
          : toSelectorCollection(assignmentTestCaseIds, assignmentSelector);

      let assignUsedFallback = false;
      try {
        assignResult = await client.assignTestPlan({
          projectId: resolvedProjectId,
          testplan: updatedId,
          executor: resolvedAssignmentExecutor,
          assignmentCriteria,
          assignmentMethod,
          assignment: {
            user: assignmentUsersForPayload,
            testCases: assignmentTestCasesForPayload,
            configuration:
              assignmentCriteria === "configuration"
                ? assignmentConfigurationIds
                : null,
          },
        });
      } catch (assignError) {
        const assignErrorMessage = toErrorMessage(assignError);
        const shouldFallbackToPlanAssignees =
          assignmentMethod === "automatic" &&
          resolvedAssignmentExecutor === "team" &&
          isNoAssignableItemsError(assignErrorMessage);

        if (!shouldFallbackToPlanAssignees) {
          throw assignError;
        }

        let fallbackAssigneeIds = assignmentUsersForPayload.filter(
          (user): user is number => typeof user === "number"
        );

        if (fallbackAssigneeIds.length === 0) {
          const fallbackUsersRaw = await client.listProjectUsers(resolvedProjectId);
          const fallbackUsers = mapProjectUsersForLookup(
            Array.isArray(fallbackUsersRaw) ? fallbackUsersRaw : []
          );
          fallbackAssigneeIds = fallbackUsers.map((user) => user.id);
        }

        fallbackAssigneeIds = dedupeNumbers(fallbackAssigneeIds);

        if (fallbackAssigneeIds.length === 0) {
          return toToolResponse(
            {
              error: {
                code: "ASSIGN_TEST_PLAN_FAILED",
                message: assignErrorMessage,
              },
              ...(hasMetadataUpdate
                ? {
                    testPlan: {
                      id: updatedId,
                      ...(updatedTitle ? { title: updatedTitle } : {}),
                      project_id: resolvedProjectId,
                    },
                  }
                : {}),
            },
            true
          );
        }

        const fallbackExistingRaw = await client.getTestPlanRaw(updatedId);
        const fallbackExisting = unwrapApiEntity(fallbackExistingRaw);

        if (!fallbackExisting) {
          return toError(
            "INVALID_TEST_PLAN",
            `Unable to load test plan ${updatedId} for fallback assignment update.`
          );
        }

        const fallbackTitle = normalizeString(getField<string>(fallbackExisting, "title"));
        const fallbackPriority = toNumberId(getField(fallbackExisting, "priority"));
        const fallbackStatus = toNumberId(getField(fallbackExisting, "status"));
        const fallbackFolderRaw =
          getField(fallbackExisting, "test_plan_folder") ??
          getField(fallbackExisting, "testPlanFolder");
        const fallbackFolderId =
          fallbackFolderRaw === null
            ? null
            : extractId(fallbackFolderRaw) ?? toNumberId(fallbackFolderRaw);
        const fallbackReleaseRaw = getField(fallbackExisting, "release");
        const fallbackReleaseId =
          fallbackReleaseRaw === null
            ? null
            : extractId(fallbackReleaseRaw) ?? toNumberId(fallbackReleaseRaw);

        if (!fallbackTitle || fallbackPriority === undefined || fallbackStatus === undefined) {
          return toError(
            "INVALID_EXISTING_TEST_PLAN",
            "Unable to resolve required test plan fields (title, priority, status) for fallback assignment update.",
            {
              missing: [
                ...(!fallbackTitle ? ["title"] : []),
                ...(fallbackPriority === undefined ? ["priority"] : []),
                ...(fallbackStatus === undefined ? ["status"] : []),
              ],
            }
          );
        }

        const fallbackUpdateResult = await client.updateTestPlan(updatedId, {
          projectId: resolvedProjectId,
          title: fallbackTitle,
          priority: fallbackPriority,
          status: fallbackStatus,
          testPlanFolderId: fallbackFolderId ?? null,
          ...(fallbackReleaseId !== undefined ? { release: fallbackReleaseId } : {}),
          assignmentMethod,
          assignmentCriteria,
          assignedTo: fallbackAssigneeIds,
        });

        const fallbackUpdateFailure = apiFailureMessage(fallbackUpdateResult);
        if (fallbackUpdateFailure) {
          return toToolResponse(
            {
              error: {
                code: "ASSIGN_TEST_PLAN_FAILED",
                message: fallbackUpdateFailure,
              },
              ...(hasMetadataUpdate
                ? {
                    testPlan: {
                      id: updatedId,
                      ...(updatedTitle ? { title: updatedTitle } : {}),
                      project_id: resolvedProjectId,
                    },
                  }
                : {}),
            },
            true
          );
        }

        assignUsedFallback = true;
        assignResult = {
          status: true,
          fallback_assignment: true,
          assign_error: assignErrorMessage,
          assigned_to: fallbackAssigneeIds,
        };
      }

      if (!assignUsedFallback) {
        const assignFailure = apiFailureMessage(assignResult);
        if (assignFailure) {
          return toToolResponse(
            {
              error: {
                code: "ASSIGN_TEST_PLAN_FAILED",
                message: assignFailure,
              },
              ...(hasMetadataUpdate
                ? {
                    testPlan: {
                      id: updatedId,
                      ...(updatedTitle ? { title: updatedTitle } : {}),
                      project_id: resolvedProjectId,
                    },
                  }
                : {}),
            },
            true
          );
        }
      }
    }

    const message = hasMetadataUpdate
      ? hasAssignmentUpdate
        ? "Test plan updated successfully and assignment applied."
        : "Test plan updated successfully"
      : "Test plan assignment updated successfully";

    return toToolResponse(
      {
        success: true,
        message,
        testPlan: {
          id: updatedId,
          ...(updatedTitle ? { title: updatedTitle } : {}),
          project_id: resolvedProjectId,
        },
        updatedFields: userSuppliedUpdatableFields,
        ...(assignResult !== undefined
          ? { results: { assign_test_plan: assignResult } }
          : {}),
      },
      true
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return toToolResponse(
      {
        error: {
          code: "API_ERROR",
          message,
        },
      },
      true
    );
  }
}
