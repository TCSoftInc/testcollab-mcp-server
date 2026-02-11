/**
 * update_test_case MCP Tool
 *
 * Updates an existing test case in TestCollab with support for partial updates.
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

const stepPatchSchema = z.object({
  step_number: z
    .number()
    .int()
    .min(1)
    .describe("1-based step number to update"),
  step: z.string().optional().describe("Updated step description"),
  expected_result: z
    .string()
    .optional()
    .describe("Updated expected result for this step"),
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

export const updateTestCaseSchema = z.object({
  id: z.number().describe("Test case ID to update (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses default if not specified)"),
  title: z.string().min(1).optional().describe("New test case title"),
  suite: z
    .union([z.number(), z.string()])
    .nullable()
    .optional()
    .describe("Move to a different suite by ID or title (null to remove)"),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("New description (HTML supported, null to clear)"),
  priority: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("New priority: 0=Low, 1=Normal, 2=High"),
  steps: z
    .array(stepSchema)
    .nullable()
    .optional()
    .describe("Replace all steps with this array (null to clear)"),
  steps_patch: z
    .array(stepPatchSchema)
    .optional()
    .describe(
      "Patch existing steps by step number (1-based) without replacing the entire steps array"
    ),
  tags: z
    .array(z.union([z.number(), z.string()]))
    .nullable()
    .optional()
    .describe("Replace tags with these IDs or names (null to clear)"),
  requirements: z
    .array(z.union([z.number(), z.string()]))
    .nullable()
    .optional()
    .describe("Replace requirements with these IDs or names (null to clear)"),
  custom_fields: z
    .array(customFieldSchema)
    .nullable()
    .optional()
    .describe("Update custom field values (null to clear)"),
  attachments: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Replace attachments with these file IDs (null to clear)"),
});

export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const updateTestCaseTool = {
  name: "update_test_case",
  description: `Update an existing test case in TestCollab.

Required: id (test case ID)

All other fields are optional - only provided fields will be updated.

Tip: If you need to inspect existing steps (e.g., to fill missing expected results),
call get_test_case first and then use steps_patch.

Fields:
- title: New title
- suite: Move to different suite by ID or title (null to remove)
- description: New description (HTML, null to clear)
- priority: 0 (Low), 1 (Normal), 2 (High)
- steps: Array replaces all existing steps (null to clear)
- steps_patch: Patch steps by step number (1-based) without replacing all steps
- tags: Array replaces all existing tags (null to clear)
- requirements: Array replaces all existing requirements (null to clear)
- custom_fields: Update specific custom fields (null to clear)
- attachments: Replace attachments with these file IDs (null to clear)

Example - update title and priority:
{
  "id": 1712,
  "title": "Updated login test",
  "priority": 2
}

Example - update steps:
{
  "id": 1712,
  "steps": [
    { "step": "Go to login", "expected_result": "Page loads" },
    { "step": "Enter credentials", "expected_result": "Login succeeds" }
  ]
}

Example - patch a single step:
{
  "id": 1714,
  "steps_patch": [
    { "step_number": 1, "expected_result": "Appropriate expected result" }
  ]
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Test case ID to update (required)",
      },
      project_id: {
        type: "number",
        description: "Project ID (optional if default is set)",
      },
      title: {
        type: "string",
        description: "New test case title",
      },
      suite: {
        oneOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
        description: "Move to a different suite by ID or title (null to remove)",
      },
      description: {
        oneOf: [{ type: "string" }, { type: "null" }],
        description: "New description (HTML supported, null to clear)",
      },
      priority: {
        type: "number",
        description: "New priority: 0=Low, 1=Normal, 2=High",
        enum: [0, 1, 2],
      },
      steps: {
        oneOf: [
          {
            type: "array",
            description: "Replace all steps",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                expected_result: { type: "string" },
              },
              required: ["step"],
            },
          },
          { type: "null" },
        ],
      },
      steps_patch: {
        type: "array",
        description:
          "Patch existing steps by step number (1-based) without replacing all steps",
        items: {
          type: "object",
          properties: {
            step_number: { type: "number", minimum: 1 },
            step: { type: "string" },
            expected_result: { type: "string" },
          },
          required: ["step_number"],
        },
      },
      tags: {
        oneOf: [
          {
            type: "array",
            description: "Replace tags with these IDs or names",
            items: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
          { type: "null" },
        ],
      },
      requirements: {
        oneOf: [
          {
            type: "array",
            description: "Replace requirements with these IDs or names",
            items: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
          { type: "null" },
        ],
      },
      custom_fields: {
        oneOf: [
          {
            type: "array",
            description: "Update custom field values",
            items: {
              type: "object",
              properties: {
                id: { oneOf: [{ type: "number" }, { type: "string" }] },
                name: { type: "string" },
                label: { type: "string" },
                value: { oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
                valueLabel: { type: "string" },
                color: { type: "string" },
              },
              required: ["name", "value"],
            },
          },
          { type: "null" },
        ],
      },
      attachments: {
        oneOf: [
          {
            type: "array",
            description: "Replace attachments with these file IDs",
            items: { type: "string" },
          },
          { type: "null" },
        ],
      },
    },
    required: ["id"],
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

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  const relations = record["relations"];
  if (relations && typeof relations === "object") {
    return (relations as Record<string, unknown>)[key] as T | undefined;
  }
  return undefined;
};

const getStepText = (step: unknown): string | undefined => {
  if (typeof step === "string") {
    return normalizeString(step);
  }
  const raw =
    getField<string>(step, "step") ??
    getField<string>(step, "action") ??
    getField<string>(step, "description");
  return normalizeString(raw);
};

const getStepExpectedResult = (step: unknown): string | undefined => {
  const raw =
    getField<string>(step, "expectedResult") ??
    getField<string>(step, "expected_result") ??
    getField<string>(step, "expected");
  return normalizeString(raw);
};

const getStepReusableId = (step: unknown): number | null | undefined => {
  const raw =
    getField<unknown>(step, "reusableStepId") ??
    getField<unknown>(step, "reusable_step_id") ??
    getField<unknown>(step, "parsedReusableStepId") ??
    getField<unknown>(step, "parsed_reusable_step_id");
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  return toNumberId(raw) ?? null;
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
  return Array.isArray(data) ? data : undefined;
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

const getExistingStepsSource = (
  testCase: Record<string, unknown>
): unknown[] | undefined => {
  const direct = getArrayField(testCase, "steps");
  const parsed = getArrayField(testCase, "stepsParsed", ["steps_parsed"]);
  if (direct && direct.length > 0) {
    return direct;
  }
  if (parsed && parsed.length > 0) {
    return parsed;
  }
  return direct ?? parsed;
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

export async function handleUpdateTestCase(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Validate input
  const parsed = updateTestCaseSchema.safeParse(args);
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
    project_id,
    title,
    suite,
    description,
    priority,
    steps,
    steps_patch,
    tags,
    requirements,
    custom_fields,
    attachments,
  } = parsed.data;
  const rawArgs = (args && typeof args === "object") ? (args as Record<string, unknown>) : {};
  const hasField = (key: string) =>
    Object.prototype.hasOwnProperty.call(rawArgs, key);
  const hasSteps = hasField("steps");
  const hasStepsPatch = hasField("steps_patch");

  if (hasSteps && hasStepsPatch) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "INVALID_INPUT",
              message: "Provide either steps or steps_patch, not both.",
            },
          }),
        },
      ],
    };
  }

  // Resolve project ID
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
                "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT.",
            },
          }),
        },
      ],
    };
  }

  try {
    const client = getApiClient();

    const suiteInput = suite;
    const suiteNumericId = toNumberId(suiteInput);
    const suiteTitle = normalizeString(suiteInput);
    const suiteNeedsLookup =
      hasField("suite") &&
      suiteInput !== null &&
      suiteNumericId === undefined &&
      suiteTitle !== undefined;
    const tagsNeedLookup =
      hasField("tags") && Array.isArray(tags) && tags.some(isNonNumericString);
    const requirementsNeedLookup =
      hasField("requirements") &&
      Array.isArray(requirements) &&
      requirements.some(isNonNumericString);
    const customFieldsNeedLookup =
      hasField("custom_fields") &&
      custom_fields !== null &&
      custom_fields?.some((cf) => cf.id === undefined || isNonNumericString(cf.id));

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

    // The PUT /testcases/{id} endpoint expects a full TestCasePayload.
    // Fetch current test case and merge with incoming changes to avoid partial payload errors.
    const existingRaw = await client.getTestCaseRaw(id, resolvedProjectId, {
      parseRs: hasSteps || hasStepsPatch,
    });
    const existing = unwrapApiEntity(existingRaw);
    if (!existing) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "INVALID_TEST_CASE",
                message: `Unable to load test case ${id} for update.`,
              },
            }),
          },
        ],
      };
    }

    const existingSuiteValue = getField<unknown>(existing, "suite");
    const existingSuiteId =
      typeof existingSuiteValue === "number"
        ? existingSuiteValue
        : extractId(existingSuiteValue);

    type ExistingStep = {
      step: string;
      expectedResult?: string;
      reusableStepId?: number | null;
    };

    const stepsSource = getExistingStepsSource(existing);
    const existingSteps: ExistingStep[] | undefined = stepsSource?.map((s) => ({
      step: getStepText(s) ?? "",
      expectedResult: getStepExpectedResult(s),
      reusableStepId: getStepReusableId(s) ?? null,
    }));

    const existingTags = getArrayField(existing, "tags")
      ?.map((t) => extractId(t))
      .filter((id): id is number => typeof id === "number");
    const existingRequirements = getArrayField(existing, "requirements")
      ?.map((r) => extractId(r))
      .filter((id): id is number => typeof id === "number");
    const existingAttachments = getArrayField(existing, "attachments")
      ?.map((a) => {
        const attachmentId = extractId(a);
        return attachmentId !== undefined ? String(attachmentId) : undefined;
      })
      .filter((id): id is string => typeof id === "string");
    const existingCustomFields = getArrayField(existing, "customFields", [
      "custom_fields",
    ])
      ?.map((cf) => {
        const cfId = extractId(cf);
        const name = normalizeString(getField<string>(cf, "name")) ?? "";
        if (cfId === undefined || name.length === 0) {
          return undefined;
        }
        return {
          id: cfId,
          name,
          label: getField<string>(cf, "label"),
          value:
            (getField<string | number | null>(cf, "value") ?? null),
          valueLabel:
            getField<string>(cf, "valueLabel") ??
            getField<string>(cf, "value_label"),
          color: getField<string>(cf, "color"),
        };
      })
      .filter(
        (
          cf
        ): cf is {
          id: number;
          name: string;
          label: string | undefined;
          value: string | number | null;
          valueLabel: string | undefined;
          color: string | undefined;
        } => cf !== undefined
      );

    const existingTitle = getField<string>(existing, "title");
    const existingDescription = getField<string | null>(
      existing,
      "description"
    );
    const existingPriority = toNumberId(getField<unknown>(existing, "priority"));

    const resolvedTitle =
      hasField("title") && title !== undefined ? title : existingTitle;
    const resolvedDescription = hasField("description")
      ? description
      : existingDescription;
    const resolvedPriority =
      hasField("priority") && priority !== undefined
        ? priority
        : existingPriority;
    let resolvedSuiteId: number | null | undefined =
      hasField("suite")
        ? suiteInput === null
          ? null
          : suiteNumericId
        : existingSuiteId;
    if (suiteNeedsLookup && suitesList && suiteInput !== null) {
      const normalizedSuiteTitle = suiteTitle?.toLowerCase();
      const match = suitesList.find((suiteItem) => {
        const title = normalizeString(getField<string>(suiteItem, "title"));
        return (
          title !== undefined &&
          normalizedSuiteTitle !== undefined &&
          title.toLowerCase() === normalizedSuiteTitle
        );
      });
      resolvedSuiteId = toNumberId(match ? getField(match, "id") : undefined);
      if (resolvedSuiteId === undefined) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "SUITE_NOT_FOUND",
                  message: `Suite not found with title "${suiteTitle}" in that project`,
                },
              }),
            },
          ],
        };
      }
    }
    if (
      hasField("suite") &&
      suiteInput !== null &&
      resolvedSuiteId === undefined
    ) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
            error: {
              code: "INVALID_SUITE_ID",
              message: "suite must be a numeric ID or suite title",
            },
          }),
        },
      ],
    };
    }
    let patchedStepsResult:
      | Array<{
          step: string;
          expected_result?: string;
          reusable_step_id?: number | null;
        }>
      | null
      | undefined;
    if (hasStepsPatch) {
      if (!existingSteps || existingSteps.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "MISSING_STEPS",
                  message:
                    "Cannot patch steps because the test case has no steps.",
                },
              }),
            },
          ],
        };
      }

      const outOfRange = (steps_patch ?? []).find((patch) => {
        const index = patch.step_number - 1;
        return index < 0 || index >= existingSteps.length;
      });
      if (outOfRange) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "INVALID_STEP_NUMBER",
                  message: `Step number ${outOfRange.step_number} is out of range for test case ${id}.`,
                },
              }),
            },
          ],
        };
      }

      const patchedSteps = existingSteps.map((s) => ({
        step: s.step,
        expectedResult: s.expectedResult,
        reusableStepId: s.reusableStepId ?? null,
      }));

      (steps_patch ?? []).forEach((patch) => {
        const index = patch.step_number - 1;
        const target = patchedSteps[index];
        if (!target) {
          return;
        }
        if (patch.step !== undefined) {
          target.step = patch.step;
        }
        if (patch.expected_result !== undefined) {
          target.expectedResult = patch.expected_result;
        }
      });

      patchedStepsResult = patchedSteps.map((s) => ({
        step: s.step,
        expected_result: s.expectedResult,
        reusable_step_id: s.reusableStepId ?? null,
      }));
    }

    const resolvedSteps = hasSteps
      ? steps === null
        ? null
        : steps?.map((s) => ({
            step: s.step,
            expected_result: s.expected_result,
          }))
      : hasStepsPatch
        ? patchedStepsResult
        : existingSteps?.map((s) => ({
            step: s.step,
            expected_result: s.expectedResult,
            reusable_step_id: s.reusableStepId ?? null,
          }));
    const resolvedTags = hasField("tags")
      ? tags === null
        ? null
        : tags
            ?.map((tag) => {
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
      : existingTags;
    const resolvedRequirements = hasField("requirements")
      ? requirements === null
        ? null
        : requirements
            ?.map((req) => {
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
      : existingRequirements;

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

    const resolvedCustomFields = hasField("custom_fields")
      ? custom_fields === null
        ? null
        : custom_fields
            ?.map((cf) => {
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
      : existingCustomFields;
    const resolvedAttachments = hasField("attachments")
      ? attachments
      : existingAttachments;

    const payload = {
      title: resolvedTitle,
      description: resolvedDescription ?? null,
      priority: resolvedPriority,
      suiteId: resolvedSuiteId ?? null,
      steps: resolvedSteps === undefined ? [] : resolvedSteps,
      tags: resolvedTags === undefined ? [] : resolvedTags,
      requirements: resolvedRequirements === undefined ? [] : resolvedRequirements,
      customFields: resolvedCustomFields === undefined ? [] : resolvedCustomFields,
      attachments: resolvedAttachments === undefined ? [] : resolvedAttachments,
    };

    const result = await client.updateTestCase(id, resolvedProjectId, payload);

    // Priority labels
    const priorityLabels: Record<number, string> = {
      0: "Low",
      1: "Normal",
      2: "High",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: `Test case ${id} updated successfully`,
              testCase: {
                id: result.id,
                title: result.title,
                project: result.project,
                suite: result.suite,
                priority: result.priority,
                priorityLabel: priorityLabels[result.priority] ?? "Unknown",
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
