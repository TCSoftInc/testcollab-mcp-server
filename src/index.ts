#!/usr/bin/env node
/**
 * TestCollab MCP Server
 *
 * Entry point for the MCP server that exposes TestCollab functionality
 * to AI assistants like Claude.
 *
 * Usage:
 *   TC_API_TOKEN=<token> node dist/index.js
 *
 * Environment variables:
 *   TC_API_URL   - Base URL for TestCollab API (default: http://localhost:1337)
 *   TC_API_TOKEN - API token for authentication (required)
 */

import { startServer } from "./server.js";

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("[TestCollab MCP] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[TestCollab MCP] Unhandled rejection:", reason);
  process.exit(1);
});

// Start the server
startServer().catch((error) => {
  console.error("[TestCollab MCP] Failed to start server:", error);
  process.exit(1);
});
