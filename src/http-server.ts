#!/usr/bin/env node
/**
 * TestCollab MCP Server - HTTP Transport
 *
 * Runs the MCP server with Streamable HTTP transport for browser-based clients.
 *
 * Usage:
 *   node dist/http-server.js
 *
 * Client must provide credentials via HTTP headers:
 *   X-TC-API-Token     - API token for authentication (required)
 *   X-TC-API-URL       - Base URL for TestCollab API (default: http://localhost:1337)
 *   X-TC-Default-Project - Default project ID (optional)
 *
 * Environment variables:
 *   MCP_PORT - Port for HTTP server (default: 3100)
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerTools } from "./tools/index.js";
import { randomUUID } from "node:crypto";
import { parseContextFromHeaders, runWithContext, type RequestContext } from "./context.js";

const PORT = parseInt(process.env["MCP_PORT"] || "3100", 10);

// Store transports and contexts by session ID
interface SessionData {
  transport: WebStandardStreamableHTTPServerTransport;
  context: RequestContext;
}
const sessions = new Map<string, SessionData>();

/**
 * Create and configure the MCP server
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "testcollab",
    version: "1.0.0",
  });

  // Register all tools
  registerTools(server);

  return server;
}

/**
 * Convert Node.js IncomingMessage to Web Standard Request
 * with ability to modify headers
 */
function toWebRequest(req: IncomingMessage, body: string): Request {
  const protocol = "http";
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.url}`;

  // Create headers, fixing Accept header for MCP compatibility
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  // Fix for clients that don't send proper Accept header (e.g., Codex)
  // The MCP SDK requires Accept to include both application/json and text/event-stream
  const accept = headers.get("accept") || "";
  if (!accept.includes("text/event-stream") || !accept.includes("application/json")) {
    headers.set("accept", "application/json, text/event-stream");
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
}

/**
 * Pipe Web Standard Response to Node.js ServerResponse
 */
async function sendWebResponse(webResponse: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webResponse.status;

  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (webResponse.body) {
    const reader = webResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}

/**
 * Read request body as string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Start the HTTP server with Streamable HTTP transport
 */
async function startHttpServer(): Promise<void> {
  const httpServer = createHttpServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, X-TC-API-Token, X-TC-API-URL, X-TC-Default-Project");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
      res.statusCode = 204;
      res.end();
      return;
    }

    // Set CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    // Health check endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ status: "ok", server: "testcollab-mcp" }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Read body first for POST requests
      const body = req.method === "POST" ? await readBody(req) : "";

      // Debug: log incoming headers
      console.log("[MCP] Incoming request headers:", JSON.stringify(req.headers, null, 2));

      // Parse credentials from headers
      const context = parseContextFromHeaders(req.headers as Record<string, string | string[] | undefined>);

      console.log("[MCP] Parsed context:", context ? "valid" : "null");

      if (!context) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          error: "Unauthorized",
          message: "Missing required header: X-TC-API-Token",
        }));
        return;
      }

      // Get or create session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      let sessionData: SessionData;

      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing session
        sessionData = sessions.get(sessionId)!;
        // Update context in case credentials changed
        sessionData.context = context;
      } else {
        // Create placeholder for sessionData that will be populated
        const sessionDataHolder: { data?: SessionData } = {};

        // Create new transport and server for new session
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId: string) => {
            // Store session immediately when initialized
            if (sessionDataHolder.data) {
              sessions.set(newSessionId, sessionDataHolder.data);
              console.log(`[TestCollab MCP] New session initialized: ${newSessionId}`);
            }
          },
        });

        const server = createMcpServer();

        // Clean up when transport closes
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            console.log(`[TestCollab MCP] Session closed: ${transport.sessionId}`);
          }
        };

        // Connect server to transport
        await server.connect(transport);

        sessionData = { transport, context };
        sessionDataHolder.data = sessionData;
      }

      // Convert to Web Standard Request with fixed headers
      const webRequest = toWebRequest(req, body);

      // Handle the request within the context
      await runWithContext(sessionData.context, async () => {
        const webResponse = await sessionData.transport.handleRequest(webRequest);
        await sendWebResponse(webResponse, res);
      });
      return;
    }

    // 404 for other paths
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(PORT, () => {
    console.log(`[TestCollab MCP] HTTP server running on http://localhost:${PORT}`);
    console.log(`[TestCollab MCP] MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`[TestCollab MCP] Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[TestCollab MCP] Shutting down...");
    httpServer.close(() => {
      console.log("[TestCollab MCP] Server stopped");
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    console.log("\n[TestCollab MCP] Shutting down...");
    httpServer.close(() => {
      console.log("[TestCollab MCP] Server stopped");
      process.exit(0);
    });
  });
}

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
startHttpServer().catch((error) => {
  console.error("[TestCollab MCP] Failed to start HTTP server:", error);
  process.exit(1);
});
