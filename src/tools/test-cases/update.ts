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
  id: z.number().describe("Custom field ID"),
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
  suite_id: z.number().optional().describe("Move to a different suite"),
  description: z.string().optional().describe("New description (HTML supported)"),
  priority: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("New priority: 0=Low, 1=Normal, 2=High"),
  steps: z
    .array(stepSchema)
    .optional()
    .describe("Replace all steps with this array"),
  tags: z
    .array(z.number())
    .optional()
    .describe("Replace tags with these tag IDs"),
  requirements: z
    .array(z.number())
    .optional()
    .describe("Replace requirements with these IDs"),
  custom_fields: z
    .array(customFieldSchema)
    .optional()
    .describe("Update custom field values"),
  attachments: z
    .array(z.string())
    .optional()
    .describe("Replace attachments with these file IDs"),
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
- suite_id: Move to different suite
- description: New description (HTML)
- priority: 0 (Low), 1 (Normal), 2 (High)
- steps: Array replaces all existing steps
- tags: Array replaces all existing tags
- requirements: Array replaces all existing requirements
- custom_fields: Update specific custom fields

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
        type: "number",
        description: "Move to a different suite",
      },
      description: {
        type: "string",
        description: "New description (HTML supported)",
      },
      priority: {
        type: "number",
        description: "New priority: 0=Low, 1=Normal, 2=High",
        enum: [0, 1, 2],
      },
      steps: {
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
      tags: {
        type: "array",
        description: "Replace tags with these IDs",
        items: { type: "number" },
      },
      requirements: {
        type: "array",
        description: "Replace requirements with these IDs",
        items: { type: "number" },
      },
      custom_fields: {
        type: "array",
        description: "Update custom field values",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            label: { type: "string" },
            value: { oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
            valueLabel: { type: "string" },
            color: { type: "string" },
          },
          required: ["id", "name", "value"],
        },
      },
      attachments: {
        type: "array",
        description: "Replace attachments with these file IDs",
        items: { type: "string" },
      },
    },
    required: ["id"],
  },
};

// ============================================================================
// Tool Handler
// ============================================================================

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

    const result = await client.updateTestCase(id, resolvedProjectId, {
      title,
      description,
      priority,
      suiteId: suite_id,
      steps: steps?.map((s) => ({
        step: s.step,
        expectedResult: s.expected_result,
      })),
      tags,
      requirements,
      customFields: custom_fields?.map((cf) => ({
        id: cf.id,
        name: cf.name,
        label: cf.label,
        value: cf.value,
        valueLabel: cf.valueLabel,
        color: cf.color,
      })),
      attachments,
    });

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
