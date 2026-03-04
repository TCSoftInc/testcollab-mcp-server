# TestCollab MCP Server

Connect your AI coding assistant to [TestCollab](https://testcollab.com) — manage test cases, test plans, and suites directly from Claude, Cursor, Windsurf, Codex, or any MCP-compatible client.

> **Note:** The HTTP transport mode (`http-server.js`) is deprecated. Use the stdio transport via `npx` as shown below.

## Quick Start

### 1. Get your API token

Log in to TestCollab → **My Profile Settings** → **API Token** tab → **Generate new API token**.

### 2. Add the server to your MCP client

**Claude Code**

```bash
# Required: API token from TestCollab user profile
TC_API_TOKEN=your-api-token-here

# Optional: API base URL (default: http://localhost:1337)
TC_API_URL=http://localhost:1337

# Optional: Default project ID (eliminates need to specify project_id in every request)
TC_DEFAULT_PROJECT=16
```

| Variable | Required | Description |
|----------|----------|-------------|
| `TC_API_TOKEN` | Yes | API token from TestCollab user profile |
| `TC_API_URL` | No | API base URL (default: `http://localhost:1337`) |
| `TC_DEFAULT_PROJECT` | No | Default project ID - if set, `project_id` becomes optional in tool calls |

Note: For HTTP transport (recommended for multi-client), send credentials per client via headers
(`X-TC-API-Token`, `X-TC-API-URL`, `X-TC-Default-Project`). Env vars are a global fallback only.

## Usage

### HTTP (recommended for multi-client)

Start the HTTP server:

```bash
npm start
```

Configure any MCP client with a URL and headers. Example (Codex):

```toml
[mcp_servers.testcollab]
url = "http://localhost:3100/mcp"
http_headers = { "X-TC-Default-Project" = "17", X-TC-API-Token = "", X-TC-API-URL = "http://localhost:1337" }

# (optional) for high security - use env var
#env_http_headers = { "X-TC-Token" = "TESTCOLLAB_MCP_TOKEN" }
```

### Stdio (single-client)

### With Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "npx",
      "args": ["-y", "@testcollab/mcp-server"],
      "env": {
        "TC_API_TOKEN": "your-api-token",
        "TC_API_URL": "https://api.testcollab.io",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "npx",
      "args": ["-y", "@testcollab/mcp-server"],
      "env": {
        "TC_API_TOKEN": "your-api-token",
        "TC_API_URL": "https://api.testcollab.io",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

### Manual Testing

```bash
# Start the HTTP server (recommended)
npm start

# Start the stdio server (single-client)
TC_API_TOKEN=your-token npm run start:stdio
```

## Available Tools

### list_test_cases

List test cases from a project with optional filtering.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `suite` | number\|string | No | Filter by suite ID or title |
| `filter` | object | No | Filter conditions |
| `sort` | array | No | Sort specification |
| `limit` | number | No | Max results (1-100, default: 50) |
| `offset` | number | No | Skip N results (default: 0) |

**Filter Example:**
```json
{
  "mcpServers": {
    "testcollab": {
      "command": "npx",
      "args": ["-y", "@testcollab/mcp-server"],
      "env": {
        "TC_API_TOKEN": "your-api-token",
        "TC_API_URL": "https://api.testcollab.io",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

### 3. Verify

Restart your client, then ask: *"What tools do you have for TestCollab?"*

You should see the TestCollab tools listed. Try: *"Show me all test cases"*.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TC_API_TOKEN` | Yes | — | API token from your TestCollab profile |
| `TC_API_URL` | No | `https://api.testcollab.io` | TestCollab API base URL |
| `TC_DEFAULT_PROJECT` | No | — | Default project ID (makes `project_id` optional in every tool call) |

> **EU region:** If your TestCollab account is hosted in the EU, use `https://api-eu.testcollab.io` as your `TC_API_URL`.

## What You Can Do

| Tool | Description |
|------|-------------|
| **get_project_context** | Get suites, tags, custom fields, requirements, users — call this first |
| **list_test_cases** | Query test cases with filtering, sorting, and pagination |
| **get_test_case** | Fetch a test case with full step details |
| **create_test_case** | Create a test case with steps, tags, custom fields |
| **update_test_case** | Update any test case field |
| **list_test_plans** | List test plans with filtering and sorting |
| **create_test_plan** | Create a test plan with cases, configurations, and assignment |
| **update_test_plan** | Update test plan metadata, status, or assignment |
| **delete_test_plan** | Delete a test plan |
| **list_suites** | List all test suites in a project (supports `title`, `parent`, and `description` filters) |
| **get_suite** | Get suite details |
| **create_suite** | Create a new suite |
| **update_suite** | Update a suite |
| **delete_suite** | Delete a suite |
| **move_suite** | Move a suite to a different parent |
| **reorder_suites** | Reorder suites within a parent |

## Example Prompts

```
"Show me all high-priority test cases in the Login suite"

"Create a test case for verifying password reset with 5 steps"

"List all test plans created this week"

"Create a regression test plan with all test cases tagged 'smoke'"

"Move the Payment suite under the Checkout suite"
```

See [Use Cases](docs/use_cases.md) for detailed workflows.

## Local Development Setup

If you're contributing or want to run from source instead of npx:

```bash
git clone <repo-url>
cd tc-mcp-server
npm install
npm run build
```

Then point your MCP client to the built file:

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["/path/to/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_TOKEN": "your-api-token",
        "TC_API_URL": "http://localhost:1337",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

### Dev Commands

```bash
npm run dev          # Watch mode with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
npm run typecheck    # Type check
npm run lint         # Lint
```

## Troubleshooting

**Server not appearing in your client**
- Restart the client after adding the config
- Verify Node.js 20+ is installed: `node --version`
- Test manually: `TC_API_TOKEN=your-token npx @testcollab/mcp-server`

**Authentication errors**
- Verify your API token is valid and not expired
- Check that `TC_API_URL` points to the correct server

**"project_id is required" error**
- Set `TC_DEFAULT_PROJECT` in your env config, or
- Specify the project in your prompt: *"Show me test cases in project 16"*

## License

UNLICENSED — Private
