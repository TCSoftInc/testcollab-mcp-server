/**
 * list_suites Tool
 *
 * Lists all suites in a TestCollab project as a hierarchical tree.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import {
  resolveProjectId,
  buildSuiteTree,
} from "../../resources/project-context.js";

// ============================================================================
// Schema
// ============================================================================

export const listSuitesSchema = z.object({
  project_id: z
    .number()
    .optional()
    .describe("Project ID (optional if TC_DEFAULT_PROJECT is set)"),
  title: z
    .string()
    .optional()
    .describe("Filter suites whose title contains this string"),
  title_contains: z
    .string()
    .optional()
    .describe("Alias of title (contains match)"),
  parent: z
    .number()
    .optional()
    .describe("Filter suites by parent suite ID"),
  description: z
    .string()
    .optional()
    .describe("Filter suites whose description contains this string"),
  description_contains: z
    .string()
    .optional()
    .describe("Alias of description (contains match)"),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const listSuitesTool = {
  name: "list_suites",
  description: `List all test suites in a TestCollab project as a hierarchical tree.
Returns the complete suite tree with parent-child relationships.

Each suite node includes: id, title, parent_id, children (nested suites).

Optional filter:
- title: Filter suites by title substring.
- title_contains: Filter suites by title substring (applied at API level).
- parent: Filter suites by parent suite ID.
- description: Filter suites by description substring.`,
};

// ============================================================================
// Handler
// ============================================================================

export async function handleListSuites(args: {
  project_id?: number;
  title?: string;
  title_contains?: string;
  parent?: number;
  description?: string;
  description_contains?: string;
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
    const title = args.title?.trim() || args.title_contains?.trim();
    const description =
      args.description?.trim() || args.description_contains?.trim();
    const filter: Record<string, number | string> = {};
    if (title) {
      filter.title = title;
    }
    if (description) {
      filter.description = description;
    }
    if (args.parent !== undefined) {
      filter.parent = args.parent;
    }
    const suitesList = await client.listSuites(
      projectId,
      Object.keys(filter).length
        ? {
            filter,
          }
        : undefined
    );
    const tree = buildSuiteTree(Array.isArray(suitesList) ? suitesList : []);

    // Count total suites
    const countSuites = (
      nodes: Array<{ children: unknown[] }>
    ): number => {
      let count = nodes.length;
      for (const node of nodes) {
        count += countSuites(
          node.children as Array<{ children: unknown[] }>
        );
      }
      return count;
    };

    const totalCount = countSuites(tree);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            project_id: projectId,
            total_count: totalCount,
            suites: tree,
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
              code: "LIST_SUITES_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
          }),
        },
      ],
    };
  }
}
