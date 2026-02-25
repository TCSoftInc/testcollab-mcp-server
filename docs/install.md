# Installation Guide

## Prerequisites

- Node.js 20+
- A TestCollab account with an API token

## Step 1: Get Your API Token

1. Log in to TestCollab
2. Go to **My Profile Settings**
3. Switch to the **API Token** tab
4. Click **Generate new API token**
5. Copy the token

## Step 2: Add to Your MCP Client

Choose your client below. All examples use `npx` which downloads and runs the server automatically — no local setup needed.

### Claude Code

```bash
claude mcp add testcollab \
  -e TC_API_TOKEN=your-api-token \
  -e TC_API_URL=https://api.testcollab.io \
  -e TC_DEFAULT_PROJECT=16 \
  -- npx -y @testcollab/mcp-server
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

### Running from Source (Alternative)

If you prefer to run from a local clone instead of npx:

```bash
git clone <repo-url>
cd tc-mcp-server
npm install
npm run build
```

Then replace `"command": "npx"` and `"args": ["-y", "@testcollab/mcp-server"]` with:

```json
"command": "node",
"args": ["/absolute/path/to/tc-mcp-server/dist/index.js"]
```

## Step 3: Configure

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TC_API_TOKEN` | Yes | — | API token from your TestCollab profile |
| `TC_API_URL` | No | `https://api.testcollab.io` | TestCollab API base URL |
| `TC_DEFAULT_PROJECT` | No | — | Default project ID — if set, `project_id` becomes optional in every tool call |

## Step 4: Verify

1. Restart your MCP client
2. Ask: *"What tools do you have for TestCollab?"*
3. Try: *"Show me all test cases"*

## Troubleshooting

### Server not appearing

1. Restart the client after saving the config file
2. Check Node.js version: `node --version` (must be 20+)
3. Test the server manually: `TC_API_TOKEN=your-token npx @testcollab/mcp-server`

### Authentication errors

1. Verify your API token is valid and not expired
2. Check that `TC_API_URL` points to the correct server
3. Ensure your token has access to the specified project

### "project_id is required" error

Either:
- Add `TC_DEFAULT_PROJECT` to your env config, or
- Specify the project in your prompt: *"Show me test cases in project 16"*

### Connection timeout

1. Verify the TestCollab API is reachable from your machine
2. Check network/firewall settings if connecting to a self-hosted instance

## Next Steps

- See [Use Cases](use_cases.md) for workflows and example prompts
- See the main [README](../README.md) for the full tool reference
