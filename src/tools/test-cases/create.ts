/**
 * create_test_case MCP Tool
 *
 * Creates a new test case in TestCollab with support for custom fields.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";

// ============================================================================
// Schema Definitions
// ============================================================================

const stepSchema = z.object({
  step: z.string().describe("The action/step description"),
  expected_result: z
    .string()
    .optional()
    .describe("Expected result for this step"),
});

const customFieldSchema = z.object({
  id: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Custom field ID (number or name string)"),
  name: z.string().describe("Custom field system name"),
  label: z.string().optional().describe("Custom field display label"),
  value: z
    .union([z.string(), z.number(), z.null()])
    .describe("Custom field value"),
  valueLabel: z
    .string()
    .optional()
    .describe("Display label for the value (for dropdowns)"),
  color: z.string().optional().describe("Color for the value label"),
});

export const createTestCaseSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses TC_DEFAULT_PROJECT env var if not specified)"),
  title: z.string().min(1).describe("Test case title (required)"),
  suite: z.string().optional().describe("Suite title (alias for suite_id)"),
  suite_id: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Suite ID or suite title"),
  description: z.string().optional().describe("Test case description (HTML supported)"),
  priority: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("Priority: 0=Low, 1=Normal, 2=High (default: 1)"),
  steps: z
    .array(stepSchema)
    .optional()
    .describe("Array of test steps with actions and expected results"),
  tags: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Array of tag IDs or names to associate"),
  requirements: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .describe("Array of requirement IDs or names to link"),
  custom_fields: z
    .array(customFieldSchema)
    .optional()
    .describe("Array of custom field values"),
  attachments: z
    .array(z.string())
    .optional()
    .describe("Array of attachment file IDs"),
});

export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const createTestCaseTool = {
  name: "create_test_case",
  description: `Create a new test case in TestCollab.

Required fields:
- title: Test case title

Optional fields:
- project_id: Project ID (uses TC_DEFAULT_PROJECT if not specified)
- suite_id: Suite ID or suite title
- suite: Suite title (alias for suite_id)
- description: HTML-formatted description
- priority: 0 (Low), 1 (Normal), 2 (High) - default is 1
- steps: Array of { step: "action", expected_result: "result" }
- tags: Array of tag IDs or names
- requirements: Array of requirement IDs or names
- custom_fields: Array of custom field objects (id optional if name provided)
- attachments: Array of file IDs

Custom field format:
{
  "id": 5,
  "name": "env_dropdown",
  "label": "Environment",
  "value": 1,
  "valueLabel": "staging"
}

Example:
{
  "title": "Verify login with valid credentials",
  "suite_id": 123,
  "priority": 2,
  "description": "<p>Test user login functionality</p>",
  "steps": [
    { "step": "Navigate to login page", "expected_result": "Login page loads" },
    { "step": "Enter valid credentials", "expected_result": "Fields accept input" },
    { "step": "Click Login button", "expected_result": "User is logged in" }
  ],
  "custom_fields": [
    { "id": 5, "name": "env", "value": 1, "valueLabel": "staging" }
  ]
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
        description: "Test case title (required)",
      },
      suite: {
        type: "string",
        description: "Suite title (alias for suite_id)",
      },
      suite_id: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Suite ID or suite title",
      },
      description: {
        type: "string",
        description: "Test case description (HTML supported)",
      },
      priority: {
        type: "number",
        description: "Priority: 0=Low, 1=Normal, 2=High (default: 1)",
        enum: [0, 1, 2],
      },
      steps: {
        type: "array",
        description: "Array of test steps",
        items: {
          type: "object",
          properties: {
            step: {
              type: "string",
              description: "Step action/description",
            },
            expected_result: {
              type: "string",
              description: "Expected result for this step",
            },
          },
          required: ["step"],
        },
      },
      tags: {
        type: "array",
        description: "Array of tag IDs or names",
        items: { oneOf: [{ type: "number" }, { type: "string" }] },
      },
      requirements: {
        type: "array",
        description: "Array of requirement IDs or names",
        items: { oneOf: [{ type: "number" }, { type: "string" }] },
      },
      custom_fields: {
        type: "array",
        description: "Array of custom field values",
        items: {
          type: "object",
          properties: {
            id: {
              oneOf: [{ type: "number" }, { type: "string" }],
              description: "Custom field ID or name",
            },
            name: { type: "string", description: "Custom field system name" },
            label: { type: "string", description: "Custom field display label" },
            value: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "null" },
              ],
              description: "Custom field value",
            },
            valueLabel: {
              type: "string",
              description: "Display label for the value",
            },
            color: { type: "string", description: "Color for the value label" },
          },
          required: ["name", "value"],
        },
      },
      attachments: {
        type: "array",
        description: "Array of attachment file IDs",
        items: { type: "string" },
      },
    },
    required: ["title"],
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

const isDropdownFieldType = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "dropdown" || normalized === "multipleselect";
};

const getCustomFieldOptions = (field: unknown): unknown[] | null => {
  const direct = getField<unknown[]>(field, "options");
  if (Array.isArray(direct)) {
    return direct;
  }
  const extra = getField<Record<string, unknown>>(field, "extra");
  const extraOptions = getField<unknown[]>(extra, "options");
  if (Array.isArray(extraOptions)) {
    return extraOptions;
  }
  return null;
};

type OptionLookup = {
  id: string;
  label: string;
};

const buildOptionLookup = (options: unknown[]): OptionLookup[] => {
  const lookups: OptionLookup[] = [];
  options.forEach((option, index) => {
    if (typeof option === "string") {
      const label = option.trim();
      if (!label) {
        return;
      }
      lookups.push({ label, id: String(index + 1) });
      return;
    }
    if (typeof option === "number") {
      const value = String(option);
      lookups.push({ label: value, id: value });
      return;
    }
    if (!option || typeof option !== "object") {
      return;
    }
    const labelRaw =
      getField<string>(option, "label") ?? getField<string>(option, "name");
    const label = typeof labelRaw === "string" ? labelRaw.trim() : undefined;
    const idRaw =
      getField<string | number>(option, "id") ??
      getField<string | number>(option, "value") ??
      getField<string | number>(option, "systemValue");
    const id =
      idRaw !== undefined && idRaw !== null ? String(idRaw) : undefined;

    if (label && id) {
      lookups.push({ label, id });
      return;
    }
    if (label && !id) {
      lookups.push({ label, id: String(index + 1) });
      return;
    }
    if (!label && id) {
      lookups.push({ label: id, id });
    }
  });
  return lookups;
};

const resolveDropdownValue = (
  fieldType: unknown,
  options: unknown[] | null | undefined,
  value: string | number | null,
  valueLabel?: string
): { value: string | number | null; valueLabel?: string } => {
  if (!isDropdownFieldType(fieldType) || !options || options.length === 0) {
    return { value, valueLabel };
  }
  const labelCandidate =
    typeof valueLabel === "string" && valueLabel.trim().length > 0
      ? valueLabel.trim()
      : typeof value === "string" && isNonNumericString(value)
        ? value.trim()
        : undefined;
  if (!labelCandidate) {
    return { value, valueLabel };
  }
  const lookups = buildOptionLookup(options);
  const match = lookups.find((lookup) => lookup.label === labelCandidate);
  if (!match) {
    return { value, valueLabel };
  }
  return {
    value: match.id,
    valueLabel: valueLabel ?? match.label,
  };
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
  const data = record["data"];
  if (data && typeof data === "object") {
    return toNumberId((data as Record<string, unknown>)["id"]);
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

export async function handleCreateTestCase(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Validate input
  const parsed = createTestCaseSchema.safeParse(args);
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
    title,
    suite,
    suite_id,
    description,
    priority,
    steps,
    tags,
    requirements,
    custom_fields,
    attachments,
  } = parsed.data;

  // Resolve project ID: check request context first (HTTP), then env config (stdio)
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

    const suiteInput = suite_id ?? suite;
    const suiteNeedsLookup = isNonNumericString(suiteInput);
    const tagsNeedLookup = tags?.some(isNonNumericString) ?? false;
    const requirementsNeedLookup =
      requirements?.some(isNonNumericString) ?? false;
    const customFieldsNeedLookup =
      custom_fields?.some((cf) => cf.id === undefined || isNonNumericString(cf.id)) ??
      false;

    const needsCompanyId =
      tagsNeedLookup || requirementsNeedLookup || customFieldsNeedLookup;

    const [suitesList, projectForCompany] = await Promise.all([
      suiteNeedsLookup
        ? client.listSuites(resolvedProjectId)
        : Promise.resolve(null),
      needsCompanyId
        ? client.getProject(resolvedProjectId)
        : Promise.resolve(null),
    ]);

    const companyId = projectForCompany
      ? getCompanyIdFromProject(projectForCompany)
      : undefined;

    const [tagsList, requirementsList, customFieldsList] = await Promise.all([
      tagsNeedLookup
        ? client.listTags(resolvedProjectId)
        : Promise.resolve(null),
      requirementsNeedLookup
        ? client.listRequirements(resolvedProjectId)
        : Promise.resolve(null),
      customFieldsNeedLookup
        ? client.listProjectCustomFields(resolvedProjectId, companyId)
        : Promise.resolve(null),
    ]);

    let resolvedSuiteId = toNumberId(suiteInput);
    if (suiteNeedsLookup && suitesList) {
      const match = suitesList.find(
        (suite) => getField<string>(suite, "title") === suiteInput
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
                  message: `Suite not found with title "${suiteInput}" in that project`,
                },
              }),
            },
          ],
        };
      }
    }

    const resolvedTags = tags
      ? tags
          .map((tag) => {
            const numericId = toNumberId(tag);
            if (numericId !== undefined) {
              return numericId;
            }
            if (!tagsList || typeof tag !== "string") {
              return undefined;
            }
            const match = tagsList.find(
              (t) => getField<string>(t, "name") === tag
            );
            return toNumberId(match ? getField(match, "id") : undefined);
          })
          .filter((id): id is number => typeof id === "number")
      : undefined;

    const resolvedRequirements = requirements
      ? requirements
          .map((req) => {
            const numericId = toNumberId(req);
            if (numericId !== undefined) {
              return numericId;
            }
            if (!requirementsList || typeof req !== "string") {
              return undefined;
            }
            const match = requirementsList.find((r) => {
              const key = getField<string>(r, "requirement_key");
              const reqId = getField<string>(r, "requirement_id");
              const title = getField<string>(r, "title");
              return key === req || reqId === req || title === req;
            });
            return toNumberId(match ? getField(match, "id") : undefined);
          })
          .filter((id): id is number => typeof id === "number")
      : undefined;

    const customFieldMap = customFieldsList
      ? customFieldsList.reduce((map, cf) => {
          const name = getField<string>(cf, "name");
          const id = toNumberId(getField(cf, "id"));
          if (!name || id === undefined) {
            return map;
          }
          const fieldType =
            getField<string>(cf, "field_type") ?? getField<string>(cf, "type");
          const options = getCustomFieldOptions(cf);
          map.set(name, {
            id,
            name,
            label: getField<string>(cf, "label"),
            fieldType,
            options,
          });
          return map;
        }, new Map<string, { id: number; name: string; label?: string; fieldType?: string; options?: unknown[] | null }>())
      : null;

    const resolvedCustomFields = custom_fields
      ? custom_fields
          .map((cf) => {
            const numericId = toNumberId(cf.id);
            if (numericId !== undefined) {
              return {
                id: numericId,
                name: cf.name,
                value: cf.value,
                ...(cf.label !== undefined ? { label: cf.label } : {}),
                ...(cf.valueLabel !== undefined ? { valueLabel: cf.valueLabel } : {}),
                ...(cf.color !== undefined ? { color: cf.color } : {}),
              };
            }
            if (!customFieldMap) {
              return undefined;
            }
            const match = customFieldMap.get(cf.name);
            if (!match) {
              return undefined;
            }
            const { value: resolvedValue, valueLabel: resolvedValueLabel } =
              resolveDropdownValue(
                match.fieldType,
                match.options,
                cf.value,
                cf.valueLabel
              );
            return {
              id: match.id,
              name: match.name,
              value: resolvedValue,
              ...(cf.label !== undefined ? { label: cf.label } : {}),
              ...(resolvedValueLabel !== undefined
                ? { valueLabel: resolvedValueLabel }
                : {}),
              ...(cf.color !== undefined ? { color: cf.color } : {}),
              ...(cf.label === undefined && match.label !== undefined
                ? { label: match.label }
                : {}),
            };
          })
          .filter(
            (
              cf
            ): cf is {
              id: number;
              name: string;
              label?: string;
              value: string | number | null;
              valueLabel?: string;
              color?: string;
            } => cf !== undefined
          )
      : undefined;

    const result = await client.createTestCase({
      projectId: resolvedProjectId,
      title,
      suiteId: resolvedSuiteId,
      description,
      priority,
      steps: steps?.map((s) => ({
        step: s.step,
        expected_result: s.expected_result,
      })),
      tags: resolvedTags,
      requirements: resolvedRequirements,
      customFields: resolvedCustomFields,
      attachments,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: `Test case created successfully`,
              testCase: {
                id: result.id,
                title: result.title,
                project: result.project,
                suite: result.suite,
                priority: result.priority,
              },
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
              message: message,
            },
          }),
        },
      ],
    };
  }
}
