/**
 * get_suite Tool
 *
 * Gets a single suite by ID from TestCollab.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { resolveProjectId } from "../../resources/project-context.js";

// ============================================================================
// Schema
// ============================================================================

export const getSuiteSchema = z.object({
  id: z.number().describe("Suite ID to retrieve (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const getSuiteTool = {
  name: "get_suite",
  description: `Get details of a specific test suite by ID.
Returns the suite's title, description, parent_id, and other metadata.

Required: id (suite ID)
Optional: project_id`,
};

// ============================================================================
// Handler
// ============================================================================

export async function handleGetSuite(args: {
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
    const result = await client.getSuite(args.id, projectId);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            suite: result,
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
              code: "GET_SUITE_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
