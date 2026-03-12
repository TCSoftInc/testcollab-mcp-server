/**
 * create_test_plan MCP Tool
 *
 * Creates a test plan and optionally adds test cases, configurations, and assignment
 * using a single MCP tool call.
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

const filterQuerySchema = z.object({
  field: z.string().min(1).describe("Filter field name"),
  operator: z.string().min(1).describe("Filter operator"),
  value: z.string().describe("Filter value"),
});

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

const testCasesSchema = z.object({
  test_case_ids: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Test case IDs to add to this test plan"),
  selector: z
    .array(filterQuerySchema)
    .optional()
    .describe("Filter query selector to fetch test cases dynamically"),
  assignee: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      'Assignee for newly added test cases (user ID, "me", name, username, or email). If assignment is omitted, this also triggers test-case assignment.'
    ),
});

const configurationPairSchema = z.object({
  id: z.string().optional().describe("Optional configuration field ID"),
  field: z.string().min(1).describe("Configuration field name"),
  value: z.string().describe("Configuration value"),
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

export const createTestPlanSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  title: z
    .string()
    .optional()
    .describe(
      'Test plan title (optional; defaults to "Test Plan DD Month YYYY HH:mm:ss")'
    ),
  description: z.string().optional().describe("Test plan description (HTML supported)"),
  priority: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("Priority: 0=Low, 1=Normal, 2=High"),
  test_plan_folder: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe("Test plan folder ID or title (null to place at root)"),
  release: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Release ID or title"),
  start_date: z
    .string()
    .optional()
    .describe("Planned start date (YYYY-MM-DD)"),
  end_date: z
    .string()
    .optional()
    .describe("Planned end date (YYYY-MM-DD)"),
  custom_fields: z
    .array(customFieldSchema)
    .optional()
    .describe("Array of test plan custom field values"),
  test_cases: testCasesSchema
    .optional()
    .describe("Test cases to bulk-add immediately after plan creation"),
  configurations: z
    .array(z.array(configurationPairSchema))
    .optional()
    .describe("Configuration matrix to attach to the test plan"),
  assignment: assignmentSchema
    .optional()
    .describe("Assignment payload to execute after creation"),
});

export type CreateTestPlanInput = z.infer<typeof createTestPlanSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const createTestPlanTool = {
  name: "create_test_plan",
  description: `Create a test plan in TestCollab using a single MCP tool call.

Before calling this tool:
- Ask follow-up questions for missing required information.
- Do not infer or auto-generate required values like project_id.
- Assignee information is required. Provide either test_cases.assignee or assignment.user_ids (or assignment.user_ids: ["me"]). If neither is provided, the tool returns MISSING_ASSIGNEE_INFO.

Execution flow:
1) POST /testplans
2) POST /testplantestcases/bulkAdd (optional)
3) POST /testplanconfigurations (optional)
4) POST /testplans/assign (optional)

Optional:
- project_id
- title (defaults to "Test Plan DD Month YYYY HH:mm:ss" if omitted)
- description
- priority (0=Low, 1=Normal, 2=High)
- test_plan_folder (ID or title)
- release (ID or title)
- start_date, end_date
- custom_fields
- test_cases (test_case_ids/selector/assignee; assignee supports user ID/"me"/name)
- configurations
- assignment (supports user IDs/"me"/names; if user says "assign to me", use "me")

Example:
{
  "project_id": 16,
  "title": "Release 2.9 Regression",
  "priority": 1,
  "test_cases": {
    "test_case_ids": [101, 102, 103]
  },
  "configurations": [
    [{ "field": "Browser", "value": "Chrome" }, { "field": "OS", "value": "Windows" }]
  ],
  "assignment": {
    "executor": "team",
    "assignment_criteria": "testCase",
    "assignment_method": "automatic",
    "user_ids": [27, 31]
  }
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      project_id: {
        type: "number",
        description:
          "Project ID (optional if TC_DEFAULT_PROJECT env var is set)",
      },
      title: {
        type: "string",
        description:
          'Test plan title (optional; defaults to "Test Plan DD Month YYYY HH:mm:ss")',
      },
      description: {
        type: "string",
        description: "Test plan description (HTML supported)",
      },
      priority: {
        type: "number",
        enum: [0, 1, 2],
        description: "Priority: 0=Low, 1=Normal, 2=High",
      },
      test_plan_folder: {
        oneOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
        description: "Test plan folder ID or title (null for root)",
      },
      release: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Release ID or title",
      },
      start_date: {
        type: "string",
        description: "Planned start date (YYYY-MM-DD)",
      },
      end_date: {
        type: "string",
        description: "Planned end date (YYYY-MM-DD)",
      },
      custom_fields: {
        type: "array",
        description: "Array of custom field values",
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
              oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
            },
            color: { type: "string" },
          },
          required: ["name", "value"],
        },
      },
      test_cases: {
        type: "object",
        description:
          "Bulk add test cases to the newly created test plan. Provide assignee info either here (test_cases.assignee) or via assignment.user_ids.",
        properties: {
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
          assignee: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description:
              'Assignee for newly added cases (user ID, "me", name, username, or email). Required when assignment.user_ids is not provided.',
          },
        },
      },
      configurations: {
        type: "array",
        description: "Configuration matrix (array of configuration rows)",
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              field: { type: "string" },
              value: { type: "string" },
            },
            required: ["field", "value"],
          },
        },
      },
      assignment: {
        type: "object",
        description:
          "Assignment payload to run after plan creation. Required when test_cases.assignee is not provided.",
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
            description:
              'Target users for assignment (user ID, "me", name, username, or email)',
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
    required: [],
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

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");

const buildDefaultTestPlanTitle = (date = new Date()): string => {
  const day = pad2(date.getDate());
  const month = monthNames[date.getMonth()] ?? "January";
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `Test Plan ${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
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

const extractIds = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => extractId(entry))
          .filter((id): id is number => id !== undefined)
      )
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directId = extractId(record);
  if (directId !== undefined) {
    return [directId];
  }

  const models = record["models"];
  if (Array.isArray(models)) {
    return extractIds(models);
  }

  const data = record["data"];
  if (Array.isArray(data) || (data && typeof data === "object")) {
    return extractIds(data);
  }

  return [];
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

const toToolResponse = (payload: unknown, pretty = false): ToolResponse => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(payload, null, pretty ? 2 : undefined),
    },
  ],
});

const toError = (
  code: string,
  message: string,
  details?: unknown
): ToolResponse =>
  toToolResponse({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });

const fieldPathFromIssue = (path: Array<string | number>): string | undefined => {
  if (path.length === 0) {
    return undefined;
  }
  const normalized = path
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .join(".");
  return normalized.length > 0 ? normalized : undefined;
};

const extractMissingRequiredFields = (issues: z.ZodIssue[]): string[] =>
  Array.from(
    new Set(
      issues.flatMap((issue) => {
        if (issue.code !== "invalid_type") {
          return [];
        }
        const received = String((issue as { received?: unknown }).received);
        if (received !== "undefined") {
          return [];
        }
        const path = fieldPathFromIssue(issue.path);
        return path ? [path] : [];
      })
    )
  );

const missingInfoQuestionByField: Record<string, string> = {
  title: "What should the test plan title be?",
  project_id: "Which project_id should I use?",
  "test_cases.assignee":
    'Who should be assigned as test_cases.assignee? (user ID, "me", name, username, or email)',
  "assignment.user_ids": "Which user_ids should receive the manual assignment?",
  "assignment.test_case_ids":
    "Which test_case_ids should be included for manual test case assignment?",
  "assignment.selector":
    "Which selector should be used for manual test case assignment?",
  "assignment.configuration_ids":
    "Which configuration_ids should be used for manual configuration assignment?",
  configurations:
    "What configurations should be created for configuration-based assignment?",
};

const toMissingInfoError = (
  code: string,
  message: string,
  missingFields: string[]
): ToolResponse => {
  const uniqueMissingFields = Array.from(
    new Set(
      missingFields
        .map((field) => field.trim())
        .filter((field) => field.length > 0)
    )
  );
  const followUpQuestions = uniqueMissingFields.map(
    (field) => missingInfoQuestionByField[field] ?? `Please provide ${field}.`
  );

  return toError(code, message, {
    missing_fields: uniqueMissingFields,
    follow_up_questions: followUpQuestions,
  });
};

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleCreateTestPlan(args: unknown): Promise<ToolResponse> {
  const parsed = createTestPlanSchema.safeParse(args);
  if (!parsed.success) {
    const missingFields = extractMissingRequiredFields(parsed.error.errors);
    if (missingFields.length > 0) {
      return toMissingInfoError(
        "MISSING_REQUIRED_INFO",
        "Missing required information to create a test plan.",
        missingFields
      );
    }
    return toError("VALIDATION_ERROR", "Invalid input parameters", parsed.error.errors);
  }

  const {
    project_id,
    title,
    description,
    priority,
    test_plan_folder,
    release,
    start_date,
    end_date,
    custom_fields,
    test_cases,
    configurations,
    assignment,
  } = parsed.data;

  const normalizedTitle = normalizeString(title) ?? buildDefaultTestPlanTitle();

  const requestContext = getRequestContext();
  const envConfig = requestContext ? null : getConfig();
  const resolvedProjectId =
    project_id ?? requestContext?.defaultProjectId ?? envConfig?.defaultProjectId;

  if (!resolvedProjectId) {
    return toMissingInfoError(
      "MISSING_PROJECT_ID",
      "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT.",
      ["project_id"]
    );
  }

  const assignmentUsers = normalizeAssignmentUsers(assignment?.user_ids);
  if (assignmentUsers.invalidValues.length > 0) {
    return toError(
      "INVALID_ASSIGNMENT_USERS",
      "assignment.user_ids contains invalid values.",
      {
        invalid_values: assignmentUsers.invalidValues,
      }
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

  const assignmentUserIds = assignmentUsers.userIds;
  const assignmentUserLookups = assignmentUsers.userLookups;
  const assignmentTargetsMe = assignmentUsers.hasMe || assignment?.executor === "me";
  const resolvedAssignmentExecutor: "me" | "team" = assignmentTargetsMe
    ? "me"
    : (assignment?.executor ?? "team");
  const assignmentTestCaseIds = normalizeNumberIds(assignment?.test_case_ids);
  const assignmentConfigurationIds = normalizeNumberIds(
    assignment?.configuration_ids
  );
  const assignmentSelector = assignment?.selector ?? [];

  if (
    assignment?.assignment_method === "manual" &&
    !assignmentTargetsMe &&
    assignmentUserIds.length === 0 &&
    assignmentUserLookups.length === 0
  ) {
    return toMissingInfoError(
      "MISSING_ASSIGNMENT_USERS",
      "Manual assignment requires at least one user_id in assignment.user_ids.",
      ["assignment.user_ids"]
    );
  }

  if (
    assignment?.assignment_method === "manual" &&
    assignment.assignment_criteria === "testCase" &&
    assignmentTestCaseIds.length === 0 &&
    assignmentSelector.length === 0
  ) {
    return toMissingInfoError(
      "MISSING_ASSIGNMENT_TEST_CASES",
      "Manual testCase assignment requires assignment.test_case_ids or assignment.selector.",
      ["assignment.test_case_ids", "assignment.selector"]
    );
  }

  if (
    assignment?.assignment_method === "manual" &&
    assignment.assignment_criteria === "configuration" &&
    assignmentConfigurationIds.length === 0 &&
    (!configurations || configurations.length === 0)
  ) {
    return toMissingInfoError(
      "MISSING_ASSIGNMENT_CONFIGURATIONS",
      "Manual configuration assignment requires assignment.configuration_ids or configurations.",
      ["assignment.configuration_ids", "configurations"]
    );
  }

  const testCaseIds = normalizeNumberIds(test_cases?.test_case_ids);
  const testCaseSelector = test_cases?.selector;
  const hasTestCaseAssignee = test_cases?.assignee !== undefined;
  const testCaseAssigneeValue = normalizeAssignee(test_cases?.assignee);

  if (hasTestCaseAssignee && testCaseAssigneeValue === undefined) {
    return toError(
      "INVALID_TEST_CASE_ASSIGNEE",
      'test_cases.assignee must be a user ID, "me", name, username, or email.'
    );
  }

  const shouldAddTestCases =
    test_cases !== undefined &&
    (testCaseIds.length > 0 || (testCaseSelector?.length ?? 0) > 0);
  const hasAnyAssigneeInfo =
    hasTestCaseAssignee ||
    assignmentTargetsMe ||
    assignmentUserIds.length > 0 ||
    assignmentUserLookups.length > 0;
  if (!hasAnyAssigneeInfo) {
    return toMissingInfoError(
      "MISSING_ASSIGNEE_INFO",
      "Assignee information is required when creating a test plan. Provide test_cases.assignee or assignment.user_ids.",
      ["test_cases.assignee", "assignment.user_ids"]
    );
  }
  const shouldCreateConfigurations =
    configurations !== undefined && configurations.length > 0;
  const shouldAssignFromTestCaseAssignee =
    assignment === undefined &&
    hasTestCaseAssignee &&
    shouldAddTestCases;
  const shouldAssign = assignment !== undefined || shouldAssignFromTestCaseAssignee;

  const steps: Record<string, { endpoint: string; status: string; detail?: string }> = {
    create_test_plan: { endpoint: "/testplans", status: "pending" },
    add_test_cases: {
      endpoint: "/testplantestcases/bulkAdd",
      status: shouldAddTestCases ? "pending" : "skipped",
    },
    add_configurations: {
      endpoint: "/testplanconfigurations",
      status: shouldCreateConfigurations ? "pending" : "skipped",
    },
    assign_test_plan: {
      endpoint: "/testplans/assign",
      status: shouldAssign ? "pending" : "skipped",
    },
  };

  let createdPlanId: number | undefined;
  let createdPlanTitle: string | undefined;

  try {
    const client = getApiClient();

    // Resolve folder (supports ID or title)
    let resolvedFolderId: number | null | undefined;
    if (test_plan_folder !== undefined) {
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

    // Resolve release (supports ID or title)
    let resolvedReleaseId: number | undefined;
    if (release !== undefined) {
      const numericReleaseId = toNumberId(release);
      if (numericReleaseId !== undefined) {
        resolvedReleaseId = numericReleaseId;
      } else {
        const releaseTitle = normalizeString(release);
        if (!releaseTitle) {
          return toError(
            "INVALID_RELEASE",
            "release must be a numeric ID or non-empty title."
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

    let resolvedAssignmentUserIds = assignmentUserIds;
    let resolvedTestCaseAssignee: ResolvedAssigneeValue | undefined =
      typeof testCaseAssigneeValue === "number" || testCaseAssigneeValue === "me"
        ? testCaseAssigneeValue
        : undefined;
    const testCaseAssigneeLookup =
      typeof testCaseAssigneeValue === "string" && testCaseAssigneeValue !== "me"
        ? testCaseAssigneeValue
        : undefined;

    if (assignmentUserLookups.length > 0 || testCaseAssigneeLookup !== undefined) {
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

      if (assignmentUserLookups.length > 0) {
        const resolvedLookupIds: number[] = [];

        for (const lookup of assignmentUserLookups) {
          const matches = findProjectUserMatches(projectUsers, lookup);
          if (matches.length === 0) {
            return toError(
              "ASSIGNEE_NOT_FOUND",
              `No project user matched "${lookup}" for assignment.user_ids.`,
              {
                field: "assignment.user_ids",
                lookup,
              }
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
          ...assignmentUserIds,
          ...resolvedLookupIds,
        ]);
      }

      if (testCaseAssigneeLookup) {
        const matches = findProjectUserMatches(projectUsers, testCaseAssigneeLookup);
        if (matches.length === 0) {
          return toError(
            "ASSIGNEE_NOT_FOUND",
            `No project user matched "${testCaseAssigneeLookup}" for test_cases.assignee.`,
            {
              field: "test_cases.assignee",
              lookup: testCaseAssigneeLookup,
            }
          );
        }
        if (matches.length > 1) {
          return toError(
            "AMBIGUOUS_ASSIGNEE",
            `Multiple project users matched "${testCaseAssigneeLookup}" for test_cases.assignee. Use a numeric user ID.`,
            {
              field: "test_cases.assignee",
              lookup: testCaseAssigneeLookup,
              matches: matches.map(toUserMatchPayload),
            }
          );
        }
        resolvedTestCaseAssignee = matches[0].id;
      }
    }

    // Resolve custom fields for TestPlan entity
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

    if (custom_fields && custom_fields.length > 0) {
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
        const id = toNumberId(getField(field, "id"));
        const name = normalizeString(getField<string>(field, "name"));
        if (id === undefined || !name) {
          return;
        }

        const fieldType =
          getField<string>(field, "field_type") ?? getField<string>(field, "type");
        const directOptions = getField<unknown[]>(field, "options");
        const extra = getField<Record<string, unknown>>(field, "extra");
        const extraOptions = extra ? getField<unknown[]>(extra, "options") : undefined;
        const options = buildOptionLookup(directOptions ?? extraOptions ?? []);

        const definition: CustomFieldDefinition = {
          id,
          name,
          label: normalizeString(getField<string>(field, "label")),
          fieldType: normalizeString(fieldType),
          options,
        };
        definitionsByName.set(name, definition);
        definitionsById.set(id, definition);
      });

      const missingFields: string[] = [];
      resolvedCustomFields = custom_fields
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

    // Step 1: Create test plan
    steps.create_test_plan.status = "in_progress";
    const createResult = await client.createTestPlan({
      projectId: resolvedProjectId,
      title: normalizedTitle,
      description,
      priority,
      testPlanFolderId: resolvedFolderId,
      release: resolvedReleaseId,
      startDate: start_date,
      endDate: end_date,
      customFields: resolvedCustomFields,
    });

    const createFailure = apiFailureMessage(createResult);
    if (createFailure) {
      steps.create_test_plan.status = "failed";
      steps.create_test_plan.detail = createFailure;
      return toToolResponse(
        {
          error: {
            code: "CREATE_TEST_PLAN_FAILED",
            message: createFailure,
            step: "create_test_plan",
          },
          steps,
        },
        true
      );
    }

    createdPlanId = extractId(createResult);
    createdPlanTitle =
      normalizeString(getField<string>(createResult, "title")) ?? normalizedTitle;

    if (createdPlanId === undefined) {
      steps.create_test_plan.status = "failed";
      steps.create_test_plan.detail = "Create response did not include test plan ID.";
      return toToolResponse(
        {
          error: {
            code: "INVALID_CREATE_TEST_PLAN_RESPONSE",
            message: "Create response did not include test plan ID.",
            step: "create_test_plan",
          },
          steps,
        },
        true
      );
    }

    steps.create_test_plan.status = "completed";

    // Step 2: Bulk add test cases
    let bulkAddResult: Record<string, unknown> | undefined;
    if (shouldAddTestCases) {
      steps.add_test_cases.status = "in_progress";

      bulkAddResult = await client.bulkAddTestPlanTestCases({
        testplan: createdPlanId,
        testCaseCollection: toSelectorCollection(testCaseIds, testCaseSelector),
        ...(resolvedTestCaseAssignee !== undefined
          ? { assignee: resolvedTestCaseAssignee }
          : {}),
      });

      const bulkAddFailure = apiFailureMessage(bulkAddResult);
      if (bulkAddFailure) {
        steps.add_test_cases.status = "failed";
        steps.add_test_cases.detail = bulkAddFailure;
        return toToolResponse(
          {
            error: {
              code: "ADD_TEST_CASES_FAILED",
              message: bulkAddFailure,
              step: "add_test_cases",
            },
            testPlan: {
              id: createdPlanId,
              title: createdPlanTitle,
              project_id: resolvedProjectId,
            },
            steps,
          },
          true
        );
      }

      steps.add_test_cases.status = "completed";
    }

    // Step 3: Create configurations
    let createConfigurationsResult:
      | Array<Record<string, unknown>>
      | Record<string, unknown>
      | undefined;
    let createdConfigurationIds: number[] = [];

    if (shouldCreateConfigurations) {
      steps.add_configurations.status = "in_progress";

      createConfigurationsResult = await client.createTestPlanConfigurations({
        projectId: resolvedProjectId,
        testplan: createdPlanId,
        parameters: (configurations ?? []).map((row) =>
          row.map((entry) => ({
            ...(entry.id !== undefined ? { id: entry.id } : {}),
            field: entry.field,
            value: entry.value,
          }))
        ),
      });

      const createConfigurationsFailure = apiFailureMessage(createConfigurationsResult);
      if (createConfigurationsFailure) {
        steps.add_configurations.status = "failed";
        steps.add_configurations.detail = createConfigurationsFailure;
        return toToolResponse(
          {
            error: {
              code: "ADD_CONFIGURATIONS_FAILED",
              message: createConfigurationsFailure,
              step: "add_configurations",
            },
            testPlan: {
              id: createdPlanId,
              title: createdPlanTitle,
              project_id: resolvedProjectId,
            },
            steps,
          },
          true
        );
      }

      createdConfigurationIds = extractIds(createConfigurationsResult);
      steps.add_configurations.status = "completed";
    }

    // Step 4: Assignment
    let assignResult: Record<string, unknown> | undefined;
    if (shouldAssign) {
      steps.assign_test_plan.status = "in_progress";

      const assignFromTestCaseAssignee =
        assignment === undefined &&
        resolvedTestCaseAssignee !== undefined &&
        shouldAddTestCases;
      const assignmentExecutorForPayload: "me" | "team" = assignFromTestCaseAssignee
        ? resolvedTestCaseAssignee === "me"
          ? "me"
          : "team"
        : resolvedAssignmentExecutor;
      const assignmentCriteriaForPayload: "testCase" | "configuration" =
        assignment?.assignment_criteria ?? "testCase";
      const assignmentMethodForPayload: "automatic" | "manual" =
        assignment?.assignment_method ?? "automatic";

      const resolvedAssignmentConfigIds =
        assignmentCriteriaForPayload === "configuration"
          ? assignmentConfigurationIds.length > 0
            ? assignmentConfigurationIds
            : createdConfigurationIds
          : [];

      if (
        assignmentMethodForPayload === "manual" &&
        assignmentCriteriaForPayload === "configuration" &&
        resolvedAssignmentConfigIds.length === 0
      ) {
        steps.assign_test_plan.status = "failed";
        steps.assign_test_plan.detail =
          "No configuration IDs available for manual configuration assignment.";
        return toToolResponse(
          {
            error: {
              code: "MISSING_ASSIGNMENT_CONFIGURATIONS",
              message:
                "No configuration IDs available for manual configuration assignment.",
              step: "assign_test_plan",
              details: {
                missing_fields: ["assignment.configuration_ids", "configurations"],
                follow_up_questions: [
                  missingInfoQuestionByField["assignment.configuration_ids"],
                  missingInfoQuestionByField["configurations"],
                ],
              },
            },
            testPlan: {
              id: createdPlanId,
              title: createdPlanTitle,
              project_id: resolvedProjectId,
            },
            steps,
          },
          true
        );
      }

      const assignmentUsersForPayload: Array<number | "me"> =
        assignFromTestCaseAssignee && resolvedTestCaseAssignee !== undefined
          ? [resolvedTestCaseAssignee]
          : assignmentExecutorForPayload === "me"
            ? ["me"]
            : resolvedAssignmentUserIds;

      assignResult = await client.assignTestPlan({
        projectId: resolvedProjectId,
        testplan: createdPlanId,
        executor: assignmentExecutorForPayload,
        assignmentCriteria: assignmentCriteriaForPayload,
        assignmentMethod: assignmentMethodForPayload,
        assignment: {
          user: assignmentUsersForPayload,
          testCases: assignFromTestCaseAssignee
            ? toSelectorCollection(testCaseIds, testCaseSelector)
            : toSelectorCollection(assignmentTestCaseIds, assignmentSelector),
          configuration:
            assignmentCriteriaForPayload === "configuration"
              ? resolvedAssignmentConfigIds
              : null,
        },
      });

      const assignFailure = apiFailureMessage(assignResult);
      if (assignFailure) {
        steps.assign_test_plan.status = "failed";
        steps.assign_test_plan.detail = assignFailure;
        return toToolResponse(
          {
            error: {
              code: "ASSIGN_TEST_PLAN_FAILED",
              message: assignFailure,
              step: "assign_test_plan",
            },
            testPlan: {
              id: createdPlanId,
              title: createdPlanTitle,
              project_id: resolvedProjectId,
            },
            steps,
          },
          true
        );
      }

      steps.assign_test_plan.status = "completed";
    }

    return toToolResponse(
      {
        success: true,
        message: "Test plan created successfully",
        testPlan: {
          id: createdPlanId,
          title: createdPlanTitle,
          project_id: resolvedProjectId,
        },
        steps,
        results: {
          ...(bulkAddResult !== undefined ? { add_test_cases: bulkAddResult } : {}),
          ...(createConfigurationsResult !== undefined
            ? { add_configurations: createConfigurationsResult }
            : {}),
          ...(assignResult !== undefined ? { assign_test_plan: assignResult } : {}),
        },
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
        ...(createdPlanId !== undefined
          ? {
              testPlan: {
                id: createdPlanId,
                title: createdPlanTitle ?? normalizedTitle,
                project_id: resolvedProjectId,
              },
            }
          : {}),
        steps,
      },
      true
    );
  }
}
