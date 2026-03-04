# Local Development Guide

How to build, test, and debug the MCP server from a local clone.

## Prerequisites

- Node.js 20+
- npm
- A TestCollab account with an API token (My Profile Settings > API Token > Generate)

## Setup

```bash
cd tc-mcp-server
npm install
npm run build
```

## Running Locally

### Option 1: Point your MCP client to the local build

After `npm run build`, configure your client to use the local `dist/index.js` instead of the npx package.

**Claude Code**

```bash
claude mcp add testcollab-local \
  -e TC_API_TOKEN=your-api-token \
  -e TC_API_URL=http://localhost:1337 \
  -e TC_DEFAULT_PROJECT=16 \
  -- node /absolute/path/to/tc-mcp-server/dist/index.js
```

**Claude Desktop / Cursor / Windsurf**

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["/absolute/path/to/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_TOKEN": "your-api-token",
        "TC_API_URL": "http://localhost:1337",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

Config file locations:
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cursor: `.cursor/mcp.json`
- Windsurf: `~/.codeium/windsurf/mcp_config.json`

### Option 2: Run stdio manually (for quick testing)

```bash
TC_API_TOKEN=your-token TC_API_URL=http://localhost:1337 TC_DEFAULT_PROJECT=16 node dist/index.js
```

The server communicates over stdin/stdout using the MCP protocol. You won't see a prompt — it's waiting for JSON-RPC messages. Press Ctrl+C to stop.

### Option 3: Watch mode (for active development)

```bash
TC_API_TOKEN=your-token TC_API_URL=http://localhost:1337 npm run dev
```

This uses `tsx watch` and restarts on file changes. The server communicates over stdin/stdout using the MCP protocol.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TC_API_TOKEN` | Yes | — | API token from your TestCollab profile |
| `TC_API_URL` | No | `https://api.testcollab.io` | API base URL (`http://localhost:1337` for local dev) |
| `TC_DEFAULT_PROJECT` | No | — | Default project ID |
| `TC_PROJECT_CONTEXT_CACHE_TTL_MS` | No | `300000` | Project context cache TTL in ms (set to `0` to disable) |

You can also create a `.env` file in the project root (see `.env.example`).

## Testing

```bash
# Run all tests (watch mode)
npm test

# Run unit tests once
npm run test:unit

# Run integration tests once
npm run test:integration

# Type check
npm run typecheck

# Lint
npm run lint
```

Tests use [Vitest](https://vitest.dev/) and mock the API client so no running backend is needed.

## Project Structure

```
src/
  index.ts              # Entry point (stdio transport)
  server.ts             # MCP server setup
  config.ts             # Environment config
  env.ts                # .env file loader
  client/
    api-client.ts       # TestCollab API client wrapper
  tools/
    index.ts            # Tool registry + Zod schemas
    test-cases/         # create, get, list, update
    test-plans/         # create, list, update
    suites/             # create, delete, get, list, move, reorder, update
  resources/
    index.ts            # MCP resource registry
    project-context.ts  # Project context (suites, tags, custom fields, users)
  types/
    index.ts            # Shared TypeScript interfaces
tests/
  unit/                 # Unit tests (mocked API)
```

## Build + Rebuild Workflow

When developing locally with an MCP client:

1. Make your code changes in `src/`
2. Run `npm run build` (or keep `npm run typecheck` running in a terminal)
3. Restart your MCP client or reconnect the server — most clients require a restart to pick up the new build

For Claude Code specifically, you can remove and re-add the server:

```bash
claude mcp remove testcollab-local
claude mcp add testcollab-local \
  -e TC_API_TOKEN=your-token \
  -e TC_API_URL=http://localhost:1337 \
  -e TC_DEFAULT_PROJECT=16 \
  -- node /absolute/path/to/tc-mcp-server/dist/index.js
```

## Debugging Tips

- **stdout is reserved for MCP protocol.** All logging goes to stderr. Use `console.error()` for debug output, never `console.log()`.
- **Server logs** appear in your MCP client's server output panel (Claude Desktop shows them in the developer console; Cursor shows them in the MCP sidebar).
- **Inspect tool schemas** by reading `src/tools/index.ts` — every tool's Zod schema defines exactly what the client sends.
- **Cache issues?** Set `TC_PROJECT_CONTEXT_CACHE_TTL_MS=0` to disable the project context cache during development.
