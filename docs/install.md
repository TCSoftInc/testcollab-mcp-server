# TestCollab MCP Server - Installation Guide

## Prerequisites

- Node.js 18+
- npm
- A TestCollab account with API token

## Step 1: Build the MCP Server

```bash
cd tc-mcp-server
npm install
npm run build
```

This creates the compiled server in `dist/index.js` (stdio) and `dist/http-server.js` (HTTP).

## Step 2: Get Your API Token

1. Log in to TestCollab
2. Go to **My Profile Settings**
3. Switch to **API Token** tab
4. Click **Generate new API token**
5. Copy the token

## Step 3: Configure Claude Code (stdio, single-client)

Create or edit `.claude/settings.json` in your project root:

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["/absolute/path/to/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_TOKEN": "your-api-token-here",
        "TC_API_URL": "http://localhost:1337",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TC_API_TOKEN` | Yes | Your TestCollab API token |
| `TC_API_URL` | No | API base URL (default: `http://localhost:1337`) |
| `TC_DEFAULT_PROJECT` | No | Default project ID - eliminates need to specify project in every request |

### Example Configuration

For a local development setup with project ID 16:

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["/Users/abhi/Documents/projects-2025/tc-oct-2025/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_TOKEN": "UgQf3UHZg6EeeFtC",
        "TC_API_URL": "http://localhost:1337",
        "TC_DEFAULT_PROJECT": "16"
      }
    }
  }
}
```

For production TestCollab:

```json
{
  "mcpServers": {
    "testcollab": {
      "command": "node",
      "args": ["/Users/abhi/Documents/projects-2025/tc-oct-2025/tc-mcp-server/dist/index.js"],
      "env": {
        "TC_API_TOKEN": "your-production-token",
        "TC_API_URL": "https://api.testcollab.io",
        "TC_DEFAULT_PROJECT": "123"
      }
    }
  }
}
```

### Multi-client / Production (HTTP transport)

Run the HTTP server and configure your MCP client to connect via URL + headers:

```bash
npm start
```

Example (Codex):

```toml
[mcp_servers.testcollab]
url = "http://localhost:3100/mcp"
http_headers = { "X-TC-Default-Project" = "123", "X-TC-API-Token" = "your-production-token", "X-TC-API-URL" = "https://api.testcollab.io" }
```

## Step 4: Restart Claude Code

After saving the settings file, restart Claude Code for the MCP server to be loaded.

## Step 5: Verify Connection

Once restarted, verify the connection by:

1. Running `/mcp` to see connected MCP servers
2. Asking Claude: "What tools do you have for TestCollab?"

You should see `testcollab` listed with the `list_test_cases` tool available.

## Step 6: Test It

Try these example prompts:

```
"Show me all test cases"

"Find high priority test cases"

"What tests have failed recently?"

"Show me tests with failure rate above 20%"

"List tests containing 'login' in the title"
```

## Troubleshooting

### Server not appearing in /mcp

1. Check that the path in `args` is correct and absolute
2. Verify the server builds without errors: `npm run build`
3. Test manually (stdio): `TC_API_TOKEN=your-token npm run start:stdio`

### Authentication errors

1. Verify your API token is valid
2. Check `TC_API_URL` points to the correct server
3. Ensure your token has access to the specified project

### "project_id is required" error

Either:
- Add `TC_DEFAULT_PROJECT` to your env config, OR
- Specify the project in your prompt: "Show me test cases in project 16"

### Connection timeout

1. Verify the TestCollab API server is running
2. Check network connectivity to `TC_API_URL`
3. For local development, ensure `http://localhost:1337` is accessible

## Claude Desktop Configuration

For Claude Desktop (instead of Claude Code), add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

## Next Steps

- See [Use Cases](use_cases.md) for common scenarios and example prompts
- Check the main [README](../README.md) for available tools and filter options
