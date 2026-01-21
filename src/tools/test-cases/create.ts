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

export const createTestCaseSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses TC_DEFAULT_PROJECT env var if not specified)"),
  title: z.string().min(1).describe("Test case title (required)"),
  suite_id: z.number().optional().describe("Suite ID to place the test case in"),
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
    .array(z.number())
    .optional()
    .describe("Array of tag IDs to associate"),
  requirements: z
    .array(z.number())
    .optional()
    .describe("Array of requirement IDs to link"),
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
- suite_id: Suite to place the test case in
- description: HTML-formatted description
- priority: 0 (Low), 1 (Normal), 2 (High) - default is 1
- steps: Array of { step: "action", expected_result: "result" }
- tags: Array of tag IDs
- requirements: Array of requirement IDs
- custom_fields: Array of custom field objects
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
      suite_id: {
        type: "number",
        description: "Suite ID to place the test case in",
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
        description: "Array of tag IDs",
        items: { type: "number" },
      },
      requirements: {
        type: "array",
        description: "Array of requirement IDs",
        items: { type: "number" },
      },
      custom_fields: {
        type: "array",
        description: "Array of custom field values",
        items: {
          type: "object",
          properties: {
            id: { type: "number", description: "Custom field ID" },
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
          required: ["id", "name", "value"],
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

    const result = await client.createTestCase({
      projectId: resolvedProjectId,
      title,
      suiteId: suite_id,
      description,
      priority,
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
