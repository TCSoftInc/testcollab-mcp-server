# Project Context Resource

## Problem

When users say things like "list test cases in suite Login" to the MCP server, the AI has no way to resolve the suite name "Login" to its numeric ID. The `list_test_cases` tool accepts `suite_id: number`, so the AI either fails or has to ask the user for the ID - defeating the purpose of natural language interaction.

The same problem applies to tags, custom fields, and any other entity referenced by name but stored by numeric ID.

## Solution

Added a `project_context` MCP resource that exposes project metadata as structured JSON. The AI client loads this resource into its context and can resolve human-readable names to IDs without extra tool calls.

**URI pattern:** `testcollab://project/{project_id}/context`

**Returns:**
```json
{
  "project_id": 42,
  "suites": [
    { "id": 1, "title": "Login", "parent_id": null, "children": [
      { "id": 2, "title": "OAuth", "parent_id": 1, "children": [] }
    ]}
  ],
  "tags": [
    { "id": 10, "name": "smoke" }
  ],
  "custom_fields": [
    { "id": 100, "name": "browser", "label": "Browser", "field_type": "dropdown", "options": ["Chrome", "Firefox"] }
  ]
}
```

## Why a resource instead of a tool?

- **Resources** are loaded into the AI context at conversation start - no extra round trip needed.
- A `list_suites` tool would work but requires the AI to "remember" to call it first. There is no way to enforce tool call ordering in MCP.
- The `suite_name` parameter approach (resolving inside the tool handler) also works and is already implemented in `list_test_cases`. The resource is complementary - it gives the AI upfront context for all entities, not just suites.

## Files

| File | Description |
|------|-------------|
| `src/resources/project-context.ts` | Resource handler, accepts project ID, returns context JSON |
| `src/resources/index.ts` | Registers the resource with the MCP server |
| `src/server.ts` | Updated to call `registerResources()` (stdio transport) |
| `src/http-server.ts` | Updated to call `registerResources()` (HTTP transport) |

## TODO

- Replace dummy data in `handleProjectContext` with real API calls (`client.listSuites`, `client.listTags`, `client.listProjectCustomFields`)
- Consider caching the context per session to avoid repeated API calls
- Add requirements list to the context
