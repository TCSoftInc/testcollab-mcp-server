/**
 * delete_suite Tool
 *
 * Deletes a suite from TestCollab.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import {
  resolveProjectId,
  clearProjectContextCache,
} from "../../resources/project-context.js";

// ============================================================================
// Schema
// ============================================================================

export const deleteSuiteSchema = z.object({
  id: z.number().describe("Suite ID to delete (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const deleteSuiteTool = {
  name: "delete_suite",
  description: `Delete a test suite from TestCollab.

WARNING: This will delete the suite and may affect child suites and test cases. Use with caution.

Required: id (suite ID)
Optional: project_id`,
};

// ============================================================================
// Handler
// ============================================================================

export async function handleDeleteSuite(args: {
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
    const result = await client.deleteSuite(args.id, projectId);

    // Invalidate project context cache
    clearProjectContextCache();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            deleted_suite_id: args.id,
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
              code: "DELETE_SUITE_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
