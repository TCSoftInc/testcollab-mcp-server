/**
 * Resource Registry
 *
 * Registers all MCP resources with the server.
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleProjectContext, resolveProjectId } from "./project-context.js";

export function registerResources(server: McpServer): void {
  server.resource(
    "project_context",
    new ResourceTemplate("testcollab://project/{project_id}/context", {
      list: async () => {
        const defaultProjectId = resolveProjectId();
        if (!defaultProjectId) {
          return { resources: [] };
        }
        return {
          resources: [
            {
              uri: `testcollab://project/${defaultProjectId}/context`,
              name: `Project ${defaultProjectId} context`,
              mimeType: "application/json",
            },
          ],
        };
      },
    }),
    {
      description:
        "Project context with suite tree, tags, requirements, test_case_custom_fields, test_plan_custom_fields, test plan folders, and project users. Use this to resolve human-readable names (e.g. suite title, folder title, user name) to numeric IDs.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = variables.project_id;
      const projectId =
        typeof raw === "string" ? parseInt(raw, 10) : undefined;

      if (!projectId || isNaN(projectId)) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                error: "Invalid or missing project_id in URI",
              }),
            },
          ],
        };
      }

      return handleProjectContext(projectId);
    }
  );
}
