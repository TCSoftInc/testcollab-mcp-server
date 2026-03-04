/**
 * reorder_suites Tool
 *
 * Sets the sort order of suites under a given parent in TestCollab.
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

export const reorderSuitesSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  parent: z
    .union([z.number(), z.string(), z.null()])
    .describe(
      "Parent suite ID, title, or null for root-level suites (required)"
    ),
  suite_ids: z
    .array(z.number())
    .min(1)
    .describe(
      "Ordered array of suite IDs representing the desired sort order (required)"
    ),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const reorderSuitesTool = {
  name: "reorder_suites",
  description: `Set the sort order of sibling suites under a given parent.
Tip: Call get_project_context or list_suites first to see current suite IDs and order.

Required: parent (parent suite ID, title, or null for root), suite_ids (ordered array of suite IDs)
Optional: project_id

Example - reorder root-level suites:
{ "parent": null, "suite_ids": [5, 3, 8, 1] }

Example - reorder children of "Authentication":
{ "parent": "Authentication", "suite_ids": [12, 10, 15] }`,
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

export async function handleReorderSuites(args: {
  project_id?: number;
  parent: number | string | null;
  suite_ids: number[];
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

    const client = getApiClient();
    const result = await client.setSuiteOrder({
      projectId,
      parentId,
      suiteIds: args.suite_ids,
    });

    // Invalidate project context cache
    clearProjectContextCache();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            parent_id: parentId,
            order: args.suite_ids,
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
              code: "REORDER_SUITES_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
