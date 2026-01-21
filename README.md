# TestCollab MCP Server

MCP (Model Context Protocol) server that exposes TestCollab test management functionality to AI assistants like Claude.

## Features

### V1.0 (Current)
- **Test Case Management**
  - `list_test_cases` - List test cases with filtering, sorting, and pagination
  - `create_test_case` - Create test cases with steps and custom fields
  - `update_test_case` - Update existing test cases

### Planned
- Delete test cases
- Suite management
- Test plan management
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

## Usage

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

### With Codex

```toml
[mcp_servers.testcollab]
url = "http://localhost:3100/mcp"
http_headers = { "X-TC-Default-Project" = "17", X-TC-API-Token = "", X-TC-API-URL = "http://localhost:1337" }

# (optional) for high security - use env var
#env_http_headers = { "X-TC-Token" = "TESTCOLLAB_MCP_TOKEN" }
```


### Manual Testing

```bash
# Start the server directly (for debugging)
TC_API_TOKEN=your-token npm run dev

# Or with built version
TC_API_TOKEN=your-token npm start
```

## Available Tools

### list_test_cases

List test cases from a project with optional filtering.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `suite_id` | number | No | Filter by suite |
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

### create_test_case

Create a new test case with optional custom fields.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | number | No* | Project ID (*required if `TC_DEFAULT_PROJECT` not set) |
| `title` | string | Yes | Test case title |
| `suite_id` | number | No | Suite to place test case in |
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
  "suite_id": 123,
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
| `suite_id` | number | No | Move to different suite |
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
│   ├── tools/
│   │   ├── index.ts      # Tool registry
│   │   ├── test-cases/
│   │   │   ├── index.ts
│   │   │   └── list.ts   # list_test_cases tool
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
