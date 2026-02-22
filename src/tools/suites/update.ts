/**
 * update_suite Tool
 *
 * Updates an existing suite in TestCollab.
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

export const updateSuiteSchema = z.object({
  id: z.number().describe("Suite ID to update (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  title: z.string().min(1).optional().describe("New suite title"),
  description: z
    .union([z.string(), z.null()])
    .optional()
    .describe("New suite description (null to clear)"),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const updateSuiteTool = {
  name: "update_suite",
  description: `Update an existing test suite in TestCollab. Only provided fields will be updated.

Required: id (suite ID)
Optional: project_id, title, description

Note: To move a suite to a different parent, use the move_suite tool instead.

Example: { "id": 42, "title": "Renamed Suite", "description": "Updated description" }`,
};

// ============================================================================
// Handler
// ============================================================================

export async function handleUpdateSuite(args: {
  id: number;
  project_id?: number;
  title?: string;
  description?: string | null;
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

    // Check that at least one field is being updated
    if (args.title === undefined && args.description === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "NO_FIELDS_TO_UPDATE",
                message:
                  "No fields provided to update. Specify at least one of: title, description.",
              },
            }),
          },
        ],
      };
    }

    const client = getApiClient();
    const result = await client.updateSuite(args.id, {
      projectId,
      title: args.title,
      description: args.description,
    });

    // Invalidate project context cache
    clearProjectContextCache();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
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
              code: "UPDATE_SUITE_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
