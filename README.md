# TestCollab MCP Server

Connect your AI coding assistant to [TestCollab](https://testcollab.com) — manage test cases, test plans, and suites directly from Claude, Cursor, Windsurf, Codex, or any MCP-compatible client.

## Quick Start

### 1. Get your API token

Log in to TestCollab → **My Profile Settings** → **API Token** tab → **Generate new API token**.

### 2. Add the server to your MCP client

**Claude Code** — add to `.mcp.json` in your project root:

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

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

**Codex** - register TestCollab from the command line:

```bash
codex mcp add testcollab \
  --env TC_API_TOKEN=your-api-token \
  --env TC_API_URL=https://api.testcollab.io \
  --env TC_DEFAULT_PROJECT=16 \
  -- npx -y @testcollab/mcp-server
```

Or add the server to `~/.codex/config.toml` for all projects, or `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.testcollab]
command = "npx"
args = ["-y", "@testcollab/mcp-server"]

[mcp_servers.testcollab.env]
TC_API_TOKEN = "your-api-token"
TC_API_URL = "https://api.testcollab.io"
TC_DEFAULT_PROJECT = "16"
```

Run `codex mcp list` to confirm the server is configured. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/) for configuration scopes and additional options.

**Cursor** — add to `.cursor/mcp.json` in your project root:

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
TC_API_TOKEN=your-token npm start
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
| **get_project_context** | Get suites, tags, custom fields, requirements, test plan folders, releases, users — call this first |
| **list_test_cases** | Query test cases with filtering, sorting, and pagination |
| **get_test_case** | Fetch a test case with full step details |
| **create_test_case** | Create a test case with steps, tags, custom fields |
| **update_test_case** | Update any test case field |
| **list_test_plans** | List test plans with filtering/sorting (including release ID/title filters) |
| **get_test_plan** | Fetch one test plan with included test cases count, configurations, runs, current progress status, and release info |
| **create_test_plan** | Create a test plan with cases selected by IDs, selectors, or tag ID/name; preserve default assignees unless overridden |
| **get_test_plan_cases** | Get case steps, expected results, configuration statuses and assigned execution IDs for a run |
| **report_test_case_result** | Record one execution with status, comments, milliseconds, step results and evidence files |
| **report_results** | Report a structured batch, set plan custom fields and optionally skip omitted assignments |
| **update_test_plan** | Update test plan metadata, status, assignment, and release association |
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

## Execute a plan through MCP

Create a tagged plan using the existing creation flow:

```json
{
  "title":"Smoke tests",
  "test_cases":{"tag_name":"Smoke","assignee":"me"},
  "override_assignees":false
}
```

`test_cases.tag_id` selects a numeric project tag instead. Use one tag reference;
tag selection can include additional `selector` filters, and is separate from
explicit `test_case_ids`. Existing case, configuration, assignment, release,
folder and custom-field options remain available. With `override_assignees`
omitted or false, default case assignees are kept and the supplied assignee fills
only unassigned cases. Set it to true to replace defaults.

Call `get_test_plan_cases` with `test_plan_id`. Also supply `run_id` to get the
token owner's assigned execution IDs and the run's revision steps. The response
includes `testCases`, `configurations`, `statuses` with active `systemName` values,
and `executions`. Use these internal IDs; `TC-` display numbers are different IDs.

Report one assigned execution with `report_test_case_result`:

```json
{
  "run_id":365,
  "executed_test_case_id":53404,
  "status":"passed",
  "comment":"Login succeeded",
  "time_taken":1200,
  "step_results":[{"step":"Sign in","expected_result":"Home page appears","status":"passed"}],
  "attachments":[{"file_name":"run.log","content_base64":"T2sK"}]
}
```

`step_results` are matched to the run's steps by position: each saved step keeps its
text and expected result, and takes the status and comment you send. A step you do not
send takes the case status. Send at most one result per step. Status uses an active system name, including custom statuses. `time_taken` adds
**milliseconds** (the CLI's `tc reportCase --time-taken` takes seconds). The token determines the executor;
results record `execution_source: agent` ("Agent" in the Run Mode column) and
`execution_context.tool: tc-mcp-server`. TestCollab counts an `agent` result as machine-executed.

Attachments allow up to **10 files per result**. In stdio mode, use
`{"file_path":"/path/to/screenshot.png"}` for a local regular file up to 10 MB.
You can also use `file_name` plus standard padded `content_base64` for
up to 1 MB decoded per file. Omit data-URL prefixes. Optional `mime_type` overrides
file-extension detection.
Invalid evidence is checked before result writes. Errors after a saved result
identify a failed time/evidence update; repeating the time update can add it twice.

For `report_results`, pass `test_plan_id` and a nonempty `results` array:

```json
{
  "test_plan_id":131,
  "results":[{"test_case_id":1724,"configuration_id":9,"status":"passed","time_taken":1200}],
  "skip_missing":true,
  "custom_fields":[{"id":5,"name":"environment_text","value":"staging","valueLabel":"staging"}]
}
```

Optional `run_id` selects a run; otherwise the latest run is used. The caller's
assigned executions are matched by internal case and configuration IDs.
`configuration_id` is required when more than one assigned execution matches.
Invalid and duplicate targets are refused before writes. Custom fields use API
IDs, system names and typed values; unspecified existing values are kept.
`skip_missing` marks omitted caller assignments skipped after supplied results
succeed. The response lists confirmed results, skipped IDs and per-execution
errors. Check it before retrying a partial failure. Batch evidence can be attached
through `report_test_case_result`. File parsing, auto-create and builds are outside
this execution flow.

See [execution architecture and verification](docs/features/mcp-test-plan-execution.md).

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

MIT
