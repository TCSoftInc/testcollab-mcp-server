/**
 * Tool Registry
 *
 * Registers all MCP tools with the server using the MCP SDK's tool() method.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  handleListTestCases,
  handleCreateTestCase,
  handleUpdateTestCase,
  getTestCaseTool,
  getTestCaseSchema,
  handleGetTestCase,
} from "./test-cases/index.js";
import {
  createTestPlanTool,
  createTestPlanSchema,
  handleCreateTestPlan,
  listTestPlansTool,
  listTestPlansSchema,
  handleListTestPlans,
  updateTestPlanTool,
  updateTestPlanSchema,
  handleUpdateTestPlan,
  deleteTestPlanTool,
  deleteTestPlanSchema,
  handleDeleteTestPlan,
} from "./test-plans/index.js";
import {
  createSuiteTool,
  createSuiteSchema,
  handleCreateSuite,
  listSuitesTool,
  listSuitesSchema,
  handleListSuites,
  getSuiteTool,
  getSuiteSchema,
  handleGetSuite,
  updateSuiteTool,
  updateSuiteSchema,
  handleUpdateSuite,
  deleteSuiteTool,
  deleteSuiteSchema,
  handleDeleteSuite,
  moveSuiteTool,
  moveSuiteSchema,
  handleMoveSuite,
  reorderSuitesTool,
  reorderSuitesSchema,
  handleReorderSuites,
} from "./suites/index.js";
import { handleProjectContext, resolveProjectId } from "../resources/project-context.js";

// ============================================================================
// Zod Schemas for Tool Inputs
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
  .passthrough(); // Allow custom field keys like cf_123

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // get_project_context — should be called first in every conversation
  // -------------------------------------------------------------------------
  server.tool(
    "get_project_context",
    `Get project context including project name, description, application type, suite tree, tags, custom fields, requirements, test plan folders, and project users.
Returns the metadata needed to resolve human-readable names (e.g. suite titles, tag names, folder titles, user names) to numeric IDs used by other tools.
Also returns the project description and app_type (web_app, mobile_app, api, desktop_app, other) which should inform the style of test steps you generate.

IMPORTANT: Call this tool at the start of every conversation before using any other TestCollab tool.
This avoids errors from unresolved suite names, tag names, or custom field references.`,
    {
      project_id: z.number().optional().describe("Project ID (optional — uses default project if omitted)"),
    },
    async (args) => {
      const projectId = resolveProjectId(args.project_id);
      if (!projectId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "No project_id provided and no default project configured." }),
            },
          ],
        };
      }

      const result = await handleProjectContext(projectId);
      const text = result.contents[0]?.text ?? JSON.stringify({ error: "No context returned" });

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // list_test_cases
  // -------------------------------------------------------------------------
  server.tool(
    "list_test_cases",
    `List test cases from a TestCollab project with optional filtering, sorting, and pagination.
Tip: Call get_project_context first to resolve suite/tag/custom field names to IDs.
Note: list_test_cases may omit full step details; use get_test_case for a complete test case with steps.

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
- date: equals, notEqual, greaterThan, lessThan, inRange

Example filter:
{
  "priority": { "filterType": "number", "type": "greaterThanOrEqual", "filter": 1 },
  "title": { "filterType": "text", "type": "contains", "filter": "login" }
}`,
    {
      project_id: z.number().optional().describe("Project ID (optional if TC_DEFAULT_PROJECT env var is set)"),
      suite: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Filter by suite ID or title"),
      filter: testCaseFilterSchema
        .optional()
        .describe("Filter conditions object"),
      sort: z
        .array(sortModelSchema)
        .optional()
        .describe("Sort specification array, e.g. [{ colId: 'updated_at', sort: 'desc' }]"),
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
    },
    async (args) => {
      return handleListTestCases(args);
    }
  );

  // -------------------------------------------------------------------------
  // create_test_case
  // -------------------------------------------------------------------------
  server.tool(
    "create_test_case",
    `Create a new test case in TestCollab.
Tip: Call get_project_context first to resolve suite/tag/custom field names to IDs.

Required: title
Optional: project_id, suite (ID or title), description, priority (0=Low, 1=Normal, 2=High), steps, tags, requirements, custom_fields, attachments

Steps format: [{ "step": "action", "expected_result": "result" }]

Custom fields format: [{ "id": 5, "name": "field_name", "value": "value", "valueLabel": "display" }]

Example:
{
  "title": "Verify login",
  "priority": 2,
  "steps": [
    { "step": "Navigate to login", "expected_result": "Page loads" },
    { "step": "Enter credentials", "expected_result": "Login succeeds" }
  ]
}`,
    {
      project_id: z.number().optional().describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
      title: z.string().min(1).describe("Test case title (required)"),
      suite: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Suite ID or suite title"),
      description: z.string().optional().describe("Test case description (HTML supported)"),
      priority: z.number().min(0).max(2).optional().describe("Priority: 0=Low, 1=Normal, 2=High"),
      steps: z.array(z.object({
        step: z.string().describe("Step action"),
        expected_result: z.string().optional().describe("Expected result"),
      })).optional().describe("Array of test steps"),
      tags: z.array(z.union([z.number(), z.string()])).optional().describe("Array of tag IDs or names"),
      requirements: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe("Array of requirement IDs or names"),
      custom_fields: z.array(z.object({
        id: z.union([z.number(), z.string()]).optional().describe("Custom field ID or name"),
        name: z.string().describe("Custom field system name"),
        label: z.string().optional().describe("Custom field display label"),
        value: z.union([z.string(), z.number(), z.null()]).describe("Custom field value"),
        valueLabel: z.string().optional().describe("Display label for value"),
        color: z.string().optional().describe("Color for value label"),
      })).optional().describe("Array of custom field values (id optional if name provided)"),
      attachments: z.array(z.string()).optional().describe("Array of attachment file IDs"),
    },
    async (args) => {
      return handleCreateTestCase(args);
    }
  );

  // -------------------------------------------------------------------------
  // list_test_plans
  // -------------------------------------------------------------------------
  server.tool(
    listTestPlansTool.name,
    listTestPlansTool.description,
    listTestPlansSchema.shape,
    async (args) => {
      return handleListTestPlans(args);
    }
  );

  // -------------------------------------------------------------------------
  // create_test_plan
  // -------------------------------------------------------------------------
  server.tool(
    createTestPlanTool.name,
    createTestPlanTool.description,
    createTestPlanSchema.shape,
    async (args) => {
      return handleCreateTestPlan(args);
    }
  );

  // -------------------------------------------------------------------------
  // update_test_plan
  // -------------------------------------------------------------------------
  server.tool(
    updateTestPlanTool.name,
    updateTestPlanTool.description,
    updateTestPlanSchema.shape,
    async (args) => {
      return handleUpdateTestPlan(args);
    }
  );

  // -------------------------------------------------------------------------
  // delete_test_plan
  // -------------------------------------------------------------------------
  server.tool(
    deleteTestPlanTool.name,
    deleteTestPlanTool.description,
    deleteTestPlanSchema.shape,
    async (args) => {
      return handleDeleteTestPlan(args);
    }
  );

  // -------------------------------------------------------------------------
  // update_test_case
  // -------------------------------------------------------------------------
  server.tool(
    "update_test_case",
    `Update an existing test case in TestCollab. Only provided fields will be updated.
Tip: Call get_project_context first to resolve suite/tag/custom field names to IDs.
Tip: If you need existing steps (e.g., to fill missing expected results), call get_test_case first and then use steps_patch.

Required: id (test case ID)

Optional fields:
- title: New title
- suite: Move to different suite
- description: New description (HTML)
- priority: 0 (Low), 1 (Normal), 2 (High)
- steps: Replaces all existing steps
- steps_patch: Patch steps by step number (1-based) without replacing all steps
- tags: Replaces all existing tags
- requirements: Replaces all existing requirements
- custom_fields: Update specific custom fields

Example:
{
  "id": 1712,
  "title": "Updated login test",
  "priority": 2
}

Example - patch a single step:
{
  "id": 1714,
  "steps_patch": [
    { "step_number": 1, "expected_result": "Appropriate expected result" }
  ]
}`,
    {
      id: z.number().describe("Test case ID to update (required)"),
      project_id: z.number().optional().describe("Project ID (optional if default is set)"),
      title: z.string().min(1).optional().describe("New test case title"),
      suite: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .describe("Move to a different suite by ID or title (null to remove)"),
      description: z.string().optional().describe("New description (HTML supported)"),
      priority: z.number().min(0).max(2).optional().describe("New priority: 0=Low, 1=Normal, 2=High"),
      steps: z.array(z.object({
        step: z.string().describe("Step action"),
        expected_result: z.string().optional().describe("Expected result"),
      })).optional().describe("Replace all steps"),
      steps_patch: z.array(z.object({
        step_number: z.number().min(1).describe("1-based step number to update"),
        step: z.string().optional().describe("Updated step description"),
        expected_result: z.string().optional().describe("Updated expected result"),
      })).optional().describe("Patch steps by step number (1-based) without replacing all steps"),
      tags: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe("Replace tags with these IDs or names"),
      requirements: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe("Replace requirements with these IDs or names"),
      custom_fields: z.array(z.object({
        id: z.union([z.number(), z.string()]).optional().describe("Custom field ID or name"),
        name: z.string().describe("Custom field system name"),
        label: z.string().optional().describe("Custom field display label"),
        value: z.union([z.string(), z.number(), z.null()]).describe("Custom field value"),
        valueLabel: z.string().optional().describe("Display label for value"),
        color: z.string().optional().describe("Color for value label"),
      })).optional().describe("Update custom field values (id optional if name provided)"),
      attachments: z.array(z.string()).optional().describe("Replace attachments with these file IDs"),
    },
    async (args) => {
      return handleUpdateTestCase(args);
    }
  );

  // -------------------------------------------------------------------------
  // get_test_case
  // -------------------------------------------------------------------------
  server.tool(
    getTestCaseTool.name,
    getTestCaseTool.description,
    getTestCaseSchema.shape,
    async (args) => {
      return handleGetTestCase(args);
    }
  );

  // -------------------------------------------------------------------------
  // create_suite
  // -------------------------------------------------------------------------
  server.tool(
    createSuiteTool.name,
    createSuiteTool.description,
    createSuiteSchema.shape,
    async (args) => {
      return handleCreateSuite(args);
    }
  );

  // -------------------------------------------------------------------------
  // list_suites
  // -------------------------------------------------------------------------
  server.tool(
    listSuitesTool.name,
    listSuitesTool.description,
    listSuitesSchema.shape,
    async (args) => {
      return handleListSuites(args);
    }
  );

  // -------------------------------------------------------------------------
  // get_suite
  // -------------------------------------------------------------------------
  server.tool(
    getSuiteTool.name,
    getSuiteTool.description,
    getSuiteSchema.shape,
    async (args) => {
      return handleGetSuite(args);
    }
  );

  // -------------------------------------------------------------------------
  // update_suite
  // -------------------------------------------------------------------------
  server.tool(
    updateSuiteTool.name,
    updateSuiteTool.description,
    updateSuiteSchema.shape,
    async (args) => {
      return handleUpdateSuite(args);
    }
  );

  // -------------------------------------------------------------------------
  // delete_suite
  // -------------------------------------------------------------------------
  server.tool(
    deleteSuiteTool.name,
    deleteSuiteTool.description,
    deleteSuiteSchema.shape,
    async (args) => {
      return handleDeleteSuite(args);
    }
  );

  // -------------------------------------------------------------------------
  // move_suite
  // -------------------------------------------------------------------------
  server.tool(
    moveSuiteTool.name,
    moveSuiteTool.description,
    moveSuiteSchema.shape,
    async (args) => {
      return handleMoveSuite(args);
    }
  );

  // -------------------------------------------------------------------------
  // reorder_suites
  // -------------------------------------------------------------------------
  server.tool(
    reorderSuitesTool.name,
    reorderSuitesTool.description,
    reorderSuitesSchema.shape,
    async (args) => {
      return handleReorderSuites(args);
    }
  );
}
