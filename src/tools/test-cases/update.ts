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
  suite_id: z
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

Fields:
- title: New title
- suite_id: Move to different suite (null to remove)
- description: New description (HTML, null to clear)
- priority: 0 (Low), 1 (Normal), 2 (High)
- steps: Array replaces all existing steps (null to clear)
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
      suite_id: {
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
    suite_id,
    description,
    priority,
    steps,
    tags,
    requirements,
    custom_fields,
    attachments,
  } = parsed.data;
  const rawArgs = (args && typeof args === "object") ? (args as Record<string, unknown>) : {};
  const hasField = (key: string) =>
    Object.prototype.hasOwnProperty.call(rawArgs, key);

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

    const suiteNeedsLookup =
      hasField("suite_id") && suite_id !== null && isNonNumericString(suite_id);
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

    // The PUT /testcases/{id} endpoint expects a full TestCasePayload.
    // Fetch current test case and merge with incoming changes to avoid partial payload errors.
    const existing = await client.getTestCase(id, resolvedProjectId);

    const existingSuiteId =
      typeof existing.suite === "number" ? existing.suite : existing.suite?.id;

    const existingSteps = existing.steps?.map((s) => {
      const expectedResult =
        "expectedResult" in s
          ? s.expectedResult
          : (s as { expected_result?: string }).expected_result;
      const reusableStepId =
        "reusableStepId" in s
          ? s.reusableStepId ?? null
          : (s as { reusable_step_id?: number | null }).reusable_step_id ?? null;

      return {
        step: s.step,
        expectedResult,
        reusableStepId,
      };
    });

    const existingTags = existing.tags
      ?.map((t) => t.id)
      .filter((id): id is number => typeof id === "number");
    const existingRequirements = existing.requirements
      ?.map((r) => r.id)
      .filter((id): id is number => typeof id === "number");
    const existingAttachments = existing.attachments?.map((a) => String(a.id));
    const existingCustomFields = existing.customFields?.map((cf) => ({
      id: cf.id,
      name: cf.name,
      label: cf.label,
      value: cf.value,
      valueLabel: cf.valueLabel,
      color: cf.color,
    }));

    const resolvedTitle =
      hasField("title") && title !== undefined ? title : existing.title;
    const resolvedDescription = hasField("description")
      ? description
      : existing.description;
    const resolvedPriority =
      hasField("priority") && priority !== undefined
        ? priority
        : existing.priority;
    let resolvedSuiteId: number | null | undefined = hasField("suite_id")
      ? suite_id === null
        ? null
        : toNumberId(suite_id)
      : existingSuiteId;
    if (suiteNeedsLookup && suitesList && suite_id !== null) {
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
    if (hasField("suite_id") && suite_id !== null && resolvedSuiteId === undefined) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "INVALID_SUITE_ID",
                message: "suite_id must be a numeric ID or suite title",
              },
            }),
          },
        ],
      };
    }
    const resolvedSteps = hasField("steps")
      ? steps === null
        ? null
        : steps?.map((s) => ({
            step: s.step,
            expected_result: s.expected_result,
          }))
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
          map.set(name, {
            id,
            name,
            label: getField<string>(cf, "label"),
          });
          return map;
        }, new Map<string, { id: number; name: string; label?: string }>())
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
              return {
                id: match.id,
                name: match.name,
                value: cf.value,
                ...(cf.label !== undefined ? { label: cf.label } : {}),
                ...(cf.valueLabel !== undefined ? { valueLabel: cf.valueLabel } : {}),
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
      priority: resolvedPriority ?? null,
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
