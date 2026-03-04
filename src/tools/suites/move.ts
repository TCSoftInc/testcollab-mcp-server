/**
 * move_suite Tool
 *
 * Moves a suite to a different parent (or to root level) in TestCollab.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import {
  resolveProjectId,
  getCachedProjectContext,
  clearProjectContextCache,
} from "../../resources/project-context.js";

// ============================================================================
// Schema
// ============================================================================

export const moveSuiteSchema = z.object({
  id: z.number().describe("Suite ID to move (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  parent: z
    .union([z.number(), z.string(), z.null()])
    .describe(
      "New parent suite ID, title, or null to move to root level (required)"
    ),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const moveSuiteTool = {
  name: "move_suite",
  description: `Move a test suite to a different parent suite, or to root level.
Tip: Call get_project_context first to see the current suite tree.

Required: id (suite ID), parent (new parent ID, title, or null for root)
Optional: project_id

Examples:
  Move under a parent: { "id": 10, "parent": "Authentication" }
  Move to root level: { "id": 10, "parent": null }`,
};

// ============================================================================
// Helpers
// ============================================================================

function resolveSuiteByTitle(
  title: string,
  projectId: number
): number | null {
  const context = getCachedProjectContext(projectId);
  if (!context) return null;

  const search = (
    nodes: Array<{ id: number; title: string; children: unknown[] }>
  ): number | null => {
    for (const node of nodes) {
      if (node.title.toLowerCase() === title.toLowerCase()) {
        return node.id;
      }
      const childResult = search(
        node.children as Array<{ id: number; title: string; children: unknown[] }>
      );
      if (childResult !== null) return childResult;
    }
    return null;
  };

  return search(context.suites as Array<{ id: number; title: string; children: unknown[] }>);
}

// ============================================================================
// Handler
// ============================================================================

export async function handleMoveSuite(args: {
  id: number;
  project_id?: number;
  parent: number | string | null;
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

    // Resolve parent
    let parentId: number | null = null;
    if (args.parent !== null) {
      if (typeof args.parent === "number") {
        parentId = args.parent;
      } else {
        const resolved = resolveSuiteByTitle(args.parent, projectId);
        if (resolved === null) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: {
                    code: "PARENT_SUITE_NOT_FOUND",
                    message: `Could not find parent suite with title "${args.parent}". Call get_project_context to see available suites.`,
                  },
                }),
              },
            ],
          };
        }
        parentId = resolved;
      }
    }

    // Prevent moving a suite under itself
    if (parentId === args.id) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "CIRCULAR_REFERENCE",
                message: "Cannot move a suite under itself.",
              },
            }),
          },
        ],
      };
    }

    const client = getApiClient();
    const result = await client.updateSuite(args.id, {
      projectId,
      parentId,
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
            moved_to_parent: parentId,
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
              code: "MOVE_SUITE_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
