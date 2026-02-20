# TestCollab MCP Server

MCP (Model Context Protocol) server that exposes TestCollab test management functionality to AI assistants like Claude.

## Features

### V1.0 (Current)
- **Project Context**
  - `get_project_context` - Get suites, tags, custom fields, requirements, test plan folders, and users for name-to-ID resolution
- **Test Case Management**
  - `list_test_cases` - List test cases with filtering, sorting, and pagination
  - `get_test_case` - Fetch a single test case with full details (including steps)
  - `create_test_case` - Create test cases with steps and custom fields
  - `update_test_case` - Update existing test cases
- **Test Plan Management**
  - `list_test_plans` - List test plans with filtering, sorting, and pagination
  - `create_test_plan` - Create a test plan with optional cases, configurations, and assignment in one call
  - `update_test_plan` - Update test plan metadata (title, status, folder, dates, custom fields, etc.)

### Planned
- Delete test cases
- Suite management
- Additional test plan management tools (get/delete)
- Test execution recording

## Installation

```bash
cd tc-mcp-server
npm install
npm run build
```

## Configuration

Create a `.env` file or set environment variables:

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
      "command": "node",
      "args": ["/path/to/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_URL": "http://localhost:1337",
        "TC_API_TOKEN": "your-api-token",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

### With Claude Code

Add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["./tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_URL": "http://localhost:1337",
        "TC_API_TOKEN": "your-api-token",
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

Recommended flow: call `get_project_context` first at the start of each conversation, then call other tools. This avoids name-to-ID resolution errors for suite names, folder titles, users, tags, and custom fields.

### get_project_context

Get project context metadata used by other tools for resolving names to IDs.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |

**Example:**
```json
{
  "project_id": 16
}
```

**Response:**
```json
{
  "project_id": 16,
  "suites": [{ "id": 1, "title": "Authentication", "parent_id": null, "children": [] }],
  "tags": [{ "id": 2, "name": "regression" }],
  "custom_fields": [{ "id": 5, "name": "env_dropdown", "label": "env", "field_type": "dropdown", "options": ["staging", "production"] }],
  "requirements": [{ "id": 12, "title": "Requirement A", "requirement_key": "REQ-12", "requirement_id": "12" }],
  "test_plan_folders": [{ "id": 42, "title": "Mobile", "parent_id": null }],
  "users": [{ "id": 27, "name": "Jane Doe", "username": "jane", "email": "jane@example.com", "role": "Tester" }]
}
```

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
  "project_id": 1,
  "filter": {
    "priority": {
      "filterType": "number",
      "type": "greaterThanOrEqual",
      "filter": 1
    },
    "title": {
      "filterType": "text",
      "type": "contains",
      "filter": "login"
    }
  },
  "sort": [{ "colId": "updated_at", "sort": "desc" }],
  "limit": 25
}
```

**Response:**
```json
{
  "rows": [...],
  "totalCount": 150,
  "filteredCount": 25
}
```

### get_test_case

Fetch a single test case with full details (including steps).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | Yes | Test case ID |
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `parse_reusable_steps` | boolean | No | Parse reusable steps into full steps (default: true) |

**Example:**
```json
{
  "id": 1835,
  "parse_reusable_steps": true
}
```

**Response:**
```json
{
  "success": true,
  "testCase": {
    "id": 1835,
    "title": "login check",
    "priority": 1,
    "steps": [
      { "step_number": 1, "step": "Navigate to login", "expected_result": "Login page loads" },
      { "step_number": 2, "step": "Enter credentials", "expected_result": null }
    ]
  },
  "stepsMissingExpectedResults": [2]
}
```

### create_test_case

Create a new test case with optional custom fields.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title` | string | Yes | Test case title |
| `suite` | number\|string | No | Suite ID or title to place test case in |
| `description` | string | No | HTML-formatted description |
| `priority` | number | No | 0=Low, 1=Normal, 2=High (default: 1) |
| `steps` | array | No | Test steps array |
| `tags` | array | No | Array of tag IDs |
| `requirements` | array | No | Array of requirement IDs |
| `custom_fields` | array | No | Array of custom field values |
| `attachments` | array | No | Array of attachment file IDs |

**Example:**
```json
{
  "title": "Verify login with valid credentials",
  "suite": 123,
  "priority": 2,
  "description": "<p>Test user login</p>",
  "steps": [
    { "step": "Navigate to login page", "expected_result": "Page loads" },
    { "step": "Enter valid credentials", "expected_result": "Fields accept input" },
    { "step": "Click Login", "expected_result": "User logged in" }
  ],
  "custom_fields": [
    { "id": 5, "name": "env_dropdown", "value": 1, "valueLabel": "staging" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test case created successfully",
  "testCase": {
    "id": 1234,
    "title": "Verify login with valid credentials",
    "project": { "id": 16, "name": "My Project" },
    "suite": { "id": 123, "title": "Login Suite" },
    "priority": "2"
  }
}
```

### update_test_case

Update an existing test case.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | Yes | Test case ID to update |
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title` | string | No | New title |
| `suite` | number\|string | No | Move to different suite by ID or title |
| `description` | string | No | HTML-formatted description |
| `priority` | number | No | 0=Low, 1=Normal, 2=High |
| `steps` | array | No | Replace all steps |
| `tags` | array | No | Replace all tags (array of tag IDs) |
| `requirements` | array | No | Replace all requirements (array of requirement IDs) |
| `custom_fields` | array | No | Update custom field values |
| `attachments` | array | No | Replace attachments (array of file IDs) |

**Example:**
```json
{
  "id": 1234,
  "title": "Updated: Verify login with valid credentials",
  "priority": 2,
  "steps": [
    { "step": "Navigate to login page", "expected_result": "Page loads" },
    { "step": "Enter valid credentials", "expected_result": "Fields accept input" },
    { "step": "Click Login", "expected_result": "User logged in" },
    { "step": "Verify dashboard", "expected_result": "Dashboard displayed" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test case updated successfully",
  "testCase": {
    "id": 1234,
    "title": "Updated: Verify login with valid credentials",
    "project": { "id": 16, "name": "My Project" },
    "suite": { "id": 123, "title": "Login Suite" },
    "priority": "2"
  }
}
```

### create_test_plan

Create a new test plan with optional test cases, configurations, and assignment.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title` | string | No | Test plan title (defaults to `Test Plan DD Month YYYY HH:mm:ss`) |
| `description` | string | No | HTML-formatted description |
| `priority` | number | No | 0=Low, 1=Normal, 2=High |
| `test_plan_folder` | number\|string\|null | No | Folder ID/title, or `null` for root |
| `start_date` | string | No | Planned start date (`YYYY-MM-DD`) |
| `end_date` | string | No | Planned end date (`YYYY-MM-DD`) |
| `custom_fields` | array | No | Array of custom field values |
| `test_cases` | object | No | `{ test_case_ids?: number[]\|string[], selector?: {field,operator,value}[], assignee?: number\|string }` |
| `configurations` | array | No | Array of configuration rows: `[[{field,value,id?}]]` |
| `assignment` | object | No | `{ executor?, assignment_criteria?, assignment_method?, user_ids?, test_case_ids?, selector?, configuration_ids? }` |

**Example:**
```json
{
  "project_id": 16,
  "title": "Release 2.9 Regression",
  "description": "<p>Full validation for release 2.9</p>",
  "priority": 1,
  "test_plan_folder": 42,
  "start_date": "2026-02-20",
  "end_date": "2026-02-24",
  "test_cases": {
    "test_case_ids": [101, 102, 103]
  },
  "configurations": [
    [
      { "field": "Browser", "value": "Chrome" },
      { "field": "OS", "value": "Windows" }
    ]
  ],
  "assignment": {
    "executor": "team",
    "assignment_criteria": "testCase",
    "assignment_method": "automatic",
    "user_ids": [27, 31]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test plan created successfully",
  "testPlan": {
    "id": 812,
    "title": "Release 2.9 Regression",
    "project_id": 16
  },
  "steps": {
    "create_test_plan": { "endpoint": "/testplans", "status": "completed" },
    "add_test_cases": { "endpoint": "/testplantestcases/bulkAdd", "status": "completed" },
    "add_configurations": { "endpoint": "/testplanconfigurations", "status": "completed" },
    "assign_test_plan": { "endpoint": "/testplans/assign", "status": "completed" }
  }
}
```

### update_test_plan

Update an existing test plan. Only provided fields are changed.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | number | Yes | Test plan ID to update |
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title` | string | No | New test plan title |
| `description` | string\|null | No | New description (HTML, `null` to clear) |
| `priority` | number\|string | No | `0/1/2` or `low/normal/high` |
| `status` | number\|string | No | `0/1/2/3` or `draft/ready/finished/finished_with_failures` |
| `test_plan_folder` | number\|string\|null | No | Folder ID/title, or `null` for root |
| `start_date` | string\|null | No | Planned start date (`YYYY-MM-DD`) or `null` to clear |
| `end_date` | string\|null | No | Planned end date (`YYYY-MM-DD`) or `null` to clear |
| `archived` | boolean | No | Archive/unarchive the test plan |
| `custom_fields` | array\|null | No | Custom fields update (`null`/`[]` to clear) |
| `assignee` | number\|string | No | Assign to one user (`ID`, `"me"`, name, username, or email) |
| `assignment` | object | No | Advanced assignment payload (`executor`, `assignment_criteria`, `assignment_method`, `user_ids`, `test_case_ids`, `selector`, `configuration_ids`) |

**Behavior notes:**
- Provide at least one updatable field besides `id`.
- `assignee` and `assignment` are mutually exclusive.
- `test_plan_folder` accepts folder ID or title; title lookups use cached project context first, then API fallback.
- `assignment.user_ids` supports IDs, `"me"`, names, usernames, or emails. Name-based matches must resolve to exactly one project user.

**Example:**
```json
{
  "id": 812,
  "project_id": 16,
  "title": "Release 3.0 Regression",
  "status": "ready",
  "test_plan_folder": "Mobile",
  "assignee": "me",
  "custom_fields": [
    { "name": "build", "value": "3.0.0-rc1" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test plan updated successfully",
  "testPlan": {
    "id": 812,
    "title": "Release 3.0 Regression",
    "project_id": 16
  },
  "updatedFields": ["title", "status", "test_plan_folder", "custom_fields"]
}
```

### list_test_plans

List test plans from a project with optional filtering.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title_contains` | string | No | Filter plans whose title contains this text |
| `status` | number\|string | No | `0/1/2/3` or `draft/ready/finished/finished_with_failures` |
| `priority` | number\|string | No | `0/1/2` or `low/normal/high` |
| `archived` | boolean | No | Filter by archived state |
| `created_by` | number | No | Filter by creator user ID |
| `test_plan_folder` | number\|string | No | Filter by folder ID or folder title |
| `created_at_from` / `created_at_to` | string | No | Created date range (ISO date/time) |
| `updated_at_from` / `updated_at_to` | string | No | Updated date range (ISO date/time) |
| `start_date_from` / `start_date_to` | string | No | Planned start date range (`YYYY-MM-DD`) |
| `end_date_from` / `end_date_to` | string | No | Planned end date range (`YYYY-MM-DD`) |
| `last_run_from` / `last_run_to` | string | No | Last run date range (ISO date/time) |
| `filter` | object | No | Raw advanced filter keys (merged with explicit filters) |
| `sort_by` | string | No | `updated_at` (default), `created_at`, `title`, `priority`, `status`, `start_date`, `end_date`, `last_run` |
| `sort_order` | string | No | `asc` or `desc` (default) |
| `limit` | number | No | Max results (1-100, default: 25) |
| `offset` | number | No | Skip N results (default: 0) |

**Behavior notes:**
- `test_plan_folder` accepts folder ID or folder title.
- Folder title lookups use cached project context when available; otherwise they fallback to live folder lookup.
- If a folder title matches multiple folders, use folder ID to avoid ambiguity.

**Example:**
```json
{
  "project_id": 16,
  "title_contains": "Release",
  "status": "ready",
  "priority": "high",
  "created_by": 27,
  "test_plan_folder": "Mobile",
  "start_date_from": "2026-02-20",
  "start_date_to": "2026-03-01",
  "filter": {
    "is_public": 1
  },
  "sort_by": "updated_at",
  "sort_order": "desc",
  "limit": 25,
  "offset": 0
}
```

**Response:**
```json
{
  "testPlans": [
    {
      "id": 901,
      "title": "Release 3.0 Regression",
      "status": 1,
      "statusLabel": "Ready to Execute",
      "priority": 2,
      "priorityLabel": "High",
      "archived": false
    }
  ],
  "returned": 1,
  "limit": 25,
  "offset": 0,
  "hasMore": false
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
tc-mcp-server/
├── src/
│   ├── index.ts          # Entry point
│   ├── server.ts         # MCP server setup
│   ├── config.ts         # Configuration
│   ├── client/
│   │   └── api-client.ts # TestCollab API client
│   ├── resources/
│   │   ├── index.ts      # Resource registry
│   │   └── project-context.ts # Project context cache + handlers
│   ├── tools/
│   │   ├── index.ts      # Tool registry
│   │   ├── test-cases/
│   │   │   ├── index.ts
│   │   │   ├── list.ts   # list_test_cases tool
│   │   │   ├── get.ts    # get_test_case tool
│   │   │   ├── create.ts # create_test_case tool
│   │   │   └── update.ts # update_test_case tool
│   │   ├── test-plans/
│   │   │   ├── index.ts
│   │   │   ├── list.ts   # list_test_plans tool
│   │   │   ├── update.ts # update_test_plan tool
│   │   │   └── create.ts # create_test_plan tool
│   │   └── suites/
│   │       └── index.ts
│   └── types/
│       └── index.ts      # Type definitions
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

## Documentation

- [Installation Guide](docs/install.md) - Step-by-step setup for Claude Code and Claude Desktop
- [Use Cases](docs/use_cases.md) - Common scenarios and example prompts for chatbot integration

## License

UNLICENSED - Private
