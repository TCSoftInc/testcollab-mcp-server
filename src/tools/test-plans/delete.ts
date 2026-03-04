/**
 * delete_test_plan MCP Tool
 *
 * Deletes an existing test plan in TestCollab.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { resolveProjectId } from "../../resources/project-context.js";

// ============================================================================
// Schema
// ============================================================================

export const deleteTestPlanSchema = z.object({
  id: z.number().describe("Test plan ID to delete (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const deleteTestPlanTool = {
  name: "delete_test_plan",
  description: `Delete a test plan from TestCollab.

WARNING: This permanently deletes the test plan and related execution data.

Required: id (test plan ID)
Optional: project_id`,
};

// ============================================================================
// Handler
// ============================================================================

export async function handleDeleteTestPlan(args: {
  id: number;
  project_id?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const projectId = resolveProjectId(args.project_id);
    if (!projectId) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "MISSING_PROJECT_ID",
                message:
                  "No project_id provided and no default project configured. Set TC_DEFAULT_PROJECT or pass project_id.",
              },
            }),
          },
        ],
      };
    }

    const client = getApiClient();
    const result = await client.deleteTestPlan(args.id, projectId);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            deleted_test_plan_id: args.id,
            result,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "DELETE_TEST_PLAN_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
