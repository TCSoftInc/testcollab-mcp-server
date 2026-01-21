/**
 * Tool Registry
 *
 * Registers all MCP tools with the server using the MCP SDK's tool() method.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleListTestCases, handleCreateTestCase, handleUpdateTestCase } from "./test-cases/index.js";

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
  filter: z.union([z.number(), z.array(z.number())]),
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
    last_run_status: numberFilterSchema.optional(),
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
  // Register list_test_cases tool
  server.tool(
    "list_test_cases",
    `List test cases from a TestCollab project with optional filtering, sorting, and pagination.

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
- date: equals, notEqual, greaterThan, lessThan, inRange

Example filter:
{
  "priority": { "filterType": "number", "type": "greaterThanOrEqual", "filter": 1 },
  "title": { "filterType": "text", "type": "contains", "filter": "login" }
}`,
    {
      project_id: z.number().optional().describe("Project ID (optional if TC_DEFAULT_PROJECT env var is set)"),
      suite_id: z.number().optional().describe("Filter by suite ID"),
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

Required: title
Optional: project_id, suite_id, description, priority (0=Low, 1=Normal, 2=High), steps, tags, requirements, custom_fields, attachments

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
      suite_id: z.number().optional().describe("Suite ID to place the test case in"),
      description: z.string().optional().describe("Test case description (HTML supported)"),
      priority: z.number().min(0).max(2).optional().describe("Priority: 0=Low, 1=Normal, 2=High"),
      steps: z.array(z.object({
        step: z.string().describe("Step action"),
        expected_result: z.string().optional().describe("Expected result"),
      })).optional().describe("Array of test steps"),
      tags: z.array(z.number()).optional().describe("Array of tag IDs"),
      requirements: z.array(z.number()).optional().describe("Array of requirement IDs"),
      custom_fields: z.array(z.object({
        id: z.number().describe("Custom field ID"),
        name: z.string().describe("Custom field system name"),
        label: z.string().optional().describe("Custom field display label"),
        value: z.union([z.string(), z.number(), z.null()]).describe("Custom field value"),
        valueLabel: z.string().optional().describe("Display label for value"),
        color: z.string().optional().describe("Color for value label"),
      })).optional().describe("Array of custom field values"),
      attachments: z.array(z.string()).optional().describe("Array of attachment file IDs"),
    },
    async (args) => {
      return handleCreateTestCase(args);
    }
  );

  // -------------------------------------------------------------------------
  // update_test_case
  // -------------------------------------------------------------------------
  server.tool(
    "update_test_case",
    `Update an existing test case in TestCollab. Only provided fields will be updated.

Required: id (test case ID)

Optional fields:
- title: New title
- suite_id: Move to different suite
- description: New description (HTML)
- priority: 0 (Low), 1 (Normal), 2 (High)
- steps: Replaces all existing steps
- tags: Replaces all existing tags
- requirements: Replaces all existing requirements
- custom_fields: Update specific custom fields

Example:
{
  "id": 1712,
  "title": "Updated login test",
  "priority": 2
}`,
    {
      id: z.number().describe("Test case ID to update (required)"),
      project_id: z.number().optional().describe("Project ID (optional if default is set)"),
      title: z.string().min(1).optional().describe("New test case title"),
      suite_id: z.number().optional().describe("Move to a different suite"),
      description: z.string().optional().describe("New description (HTML supported)"),
      priority: z.number().min(0).max(2).optional().describe("New priority: 0=Low, 1=Normal, 2=High"),
      steps: z.array(z.object({
        step: z.string().describe("Step action"),
        expected_result: z.string().optional().describe("Expected result"),
      })).optional().describe("Replace all steps"),
      tags: z.array(z.number()).optional().describe("Replace tags with these IDs"),
      requirements: z.array(z.number()).optional().describe("Replace requirements with these IDs"),
      custom_fields: z.array(z.object({
        id: z.number().describe("Custom field ID"),
        name: z.string().describe("Custom field system name"),
        label: z.string().optional().describe("Custom field display label"),
        value: z.union([z.string(), z.number(), z.null()]).describe("Custom field value"),
        valueLabel: z.string().optional().describe("Display label for value"),
        color: z.string().optional().describe("Color for value label"),
      })).optional().describe("Update custom field values"),
      attachments: z.array(z.string()).optional().describe("Replace attachments with these file IDs"),
    },
    async (args) => {
      return handleUpdateTestCase(args);
    }
  );

  // Future tools will be registered here:
  // server.tool("get_test_case", ...);
  // server.tool("delete_test_case", ...);
  // server.tool("list_suites", ...);
}
