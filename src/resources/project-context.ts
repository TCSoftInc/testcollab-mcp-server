/**
 * project_context MCP Resource
 *
 * Provides project metadata (suite tree, custom fields, tags, etc.)
 * so the AI can resolve human-readable names to numeric IDs.
 */

import { getConfig } from "../config.js";
import { getRequestContext } from "../context.js";

// ============================================================================
// Handler
// ============================================================================

export async function handleProjectContext(
  projectId: number
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // TODO: Replace with real API calls
  const context = {
    project_id: projectId,
    suites: [
      { id: 1, title: "Login", parent_id: null, children: [
        { id: 2, title: "OAuth", parent_id: 1, children: [] },
        { id: 3, title: "SSO", parent_id: 1, children: [] },
      ]},
      { id: 4, title: "Checkout", parent_id: null, children: [] },
    ],
    tags: [
      { id: 10, name: "smoke" },
      { id: 11, name: "regression" },
    ],
    custom_fields: [
      { id: 100, name: "browser", label: "Browser", field_type: "dropdown", options: ["Chrome", "Firefox", "Safari"] },
    ],
  };

  return {
    contents: [
      {
        uri: `testcollab://project/${projectId}/context`,
        mimeType: "application/json",
        text: JSON.stringify(context, null, 2),
      },
    ],
  };
}

// ============================================================================
// Resolve project ID (same logic as tools)
// ============================================================================

export function resolveProjectId(providedId?: number): number | undefined {
  if (providedId) return providedId;
  const requestContext = getRequestContext();
  if (requestContext?.defaultProjectId) return requestContext.defaultProjectId;
  try {
    const envConfig = getConfig();
    return envConfig.defaultProjectId;
  } catch {
    return undefined;
  }
}
