/**
 * MCP Server Setup
 *
 * Initializes and configures the MCP server for TestCollab
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";

/**
 * Create and configure the MCP server
 */
export function createServer(): McpServer {
  const config = getConfig();

  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // Register all tools and resources
  registerTools(server);
  registerResources(server);

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`[TestCollab MCP] Starting server...`);

  await server.connect(transport);

  console.error(`[TestCollab MCP] Server connected and ready`);
}
