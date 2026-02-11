# Project Context Resource

## Problem

When users say things like "list test cases in suite Login" to the MCP server, the AI has no way to resolve the suite name "Login" to its numeric ID. The `list_test_cases` tool accepts `suite` (ID or title), so the AI either fails or has to ask the user for the ID - defeating the purpose of natural language interaction.

The same problem applies to tags, custom fields, and any other entity referenced by name but stored by numeric ID.

## Solution

Added a `project_context` MCP resource that exposes project metadata as structured JSON. The AI client loads this resource into its context and can resolve human-readable names to IDs without extra tool calls.

## Client Setup (Required)

The server only **registers** the resource. It does **not** auto-fetch it during tool calls. Your MCP client must explicitly load the resource at conversation start (or before the first tool call that needs name → ID resolution).

**What to do in the client:**
- Call `resources/list` and then `resources/read` for `testcollab://project/{project_id}/context`, or enable your client’s “preload resources” option if it has one.
- If you don’t see project-context queries, it means the client never read the resource.

**How to verify:**
- When the resource is read, the server logs `Building project context for {project_id}` and the API calls for suites/tags/requirements/custom fields.
- If those logs never appear, the resource was not requested.

## Runtime Check

1. Start the MCP server and make sure your client is configured with `TC_DEFAULT_PROJECT` (or pass `project_id` when reading the resource).
2. From the client, call `resources/list`, then `resources/read` on `testcollab://project/{project_id}/context`.
3. Check server logs for `Building project context for {project_id}` and the API calls.
4. If you only call `list_test_cases`, you will not see project-context logs because tool calls do not auto-load resources.
5. After the resource is read and cached, `list_test_cases` will reuse that cached context for name lookups (log: `Using cached project context for list_test_cases lookups`).

## Client Snippets

### Claude Code

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "testcollab://project/16/context"
  }
}
```

### Codex CLI

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "testcollab://project/16/context"
  }
}
```

### Cursor

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "testcollab://project/16/context"
  }
}
```

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
  ],
  "requirements": [
    { "id": 501, "title": "User can reset password", "requirement_key": "REQ-12", "requirement_id": "12" }
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

## Caching

The resource caches project context per API token + API URL + project ID to avoid repeated API calls.

Set `TC_PROJECT_CONTEXT_CACHE_TTL_MS` to control cache TTL (default: 5 minutes). Set to `0` to disable caching.
