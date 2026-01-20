# TestCollab MCP Server

MCP (Model Context Protocol) server that exposes TestCollab test management functionality to AI assistants like Claude.

## Features

### V1.0 (Current)
- **Test Case Management**
  - `list_test_cases` - List test cases with filtering, sorting, and pagination

### Planned
- Complete test case CRUD operations
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
```

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
        "TC_API_TOKEN": "your-api-token"
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
        "TC_API_TOKEN": "your-api-token"
      }
    }
  }
}
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
| `project_id` | number | Yes | Project ID |
| `suite_id` | number | No | Filter by suite |
| `filter` | object | No | Filter conditions |
| `sort` | array | No | Sort specification |
| `limit` | number | No | Max results (default: 50) |
| `offset` | number | No | Skip N results |

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

## License

UNLICENSED - Private
