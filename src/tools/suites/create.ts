/**
 * create_suite Tool
 *
 * Creates a new test suite in TestCollab with optional parent for hierarchy.
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

export const createSuiteSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  title: z.string().min(1).describe("Suite title (required)"),
  description: z
    .string()
    .optional()
    .describe("Suite description"),
  parent: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      "Parent suite ID or title. Omit for a root-level suite."
    ),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const createSuiteTool = {
  name: "create_suite",
  description: `Create a new test suite in TestCollab.
Tip: Call get_project_context first to see existing suites and resolve parent suite names to IDs.

Required: title
Optional: project_id, parent (suite ID or title), description

Examples:
  Root suite: { "title": "Authentication" }
  Child suite: { "title": "Login", "parent": "Authentication" }
  With description: { "title": "API Tests", "description": "Tests for REST API endpoints" }`,
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

export async function handleCreateSuite(args: {
  project_id?: number;
  title: string;
  description?: string;
  parent?: number | string;
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

    // Resolve parent suite
    let parentId: number | null = null;
    if (args.parent !== undefined) {
      if (typeof args.parent === "number") {
        parentId = args.parent;
      } else {
        // Try to resolve by title
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
    const result = await client.createSuite({
      projectId,
      title: args.title,
      description: args.description,
      parentId,
    });

    // Invalidate project context cache so suite tree is fresh
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
              code: "CREATE_SUITE_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
