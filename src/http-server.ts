#!/usr/bin/env node
// TCV-7109: hosted execution tools use header credentials and the same registry
// as stdio. Request context keeps local file attachments unavailable over HTTP.
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import { parseContextFromHeaders, runWithContext, type RequestContext } from "./context.js";
import { SERVER_VERSION } from "./config.js";
import { MAX_ATTACHMENTS, MAX_BASE64_BYTES } from "./tools/test-plans/schemas.js";

const port = Number(process.env["MCP_PORT"] || 3100);
// Ten base64 files plus JSON framing; handler schemas enforce individual caps.
const MAX_REQUEST_BYTES = MAX_ATTACHMENTS * 4 * Math.ceil(MAX_BASE64_BYTES / 3) + 1024 * 1024;
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; context: RequestContext }>();

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        refused = true;
        reject(new Error("REQUEST_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (refused) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid JSON request")); }
    });
    req.on("error", reject);
  });
}

const httpServer = createHttpServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version, X-TC-API-Token, X-TC-API-URL, X-TC-Default-Project");
    res.writeHead(204).end();
    return;
  }
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/health" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", server: "testcollab-mcp" }));
    return;
  }
  if (pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  const context = parseContextFromHeaders(req.headers);
  if (!context) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "X-TC-API-Token is required" }));
    req.resume();
    return;
  }
  const sessionId = req.headers["mcp-session-id"];
  let session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
  if (sessionId && !session) {
    res.writeHead(404).end();
    req.resume();
    return;
  }
  if (session && (session.context.apiToken !== context.apiToken || session.context.apiUrl !== context.apiUrl)) {
    res.writeHead(403).end();
    req.resume();
    return;
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    if (!session) {
      const server = createServer({ serverName: "testcollab", serverVersion: SERVER_VERSION });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
        onsessioninitialized: id => { sessions.set(id, { transport, server, context }); },
      });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport);
      session = { transport, server, context };
    }
    const accept = req.headers.accept || "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) req.headers.accept = "application/json, text/event-stream";
    await runWithContext(context, () => session!.transport.handleRequest(req, res, body));
    if (!session.transport.sessionId) await session.server.close();
  } catch (error) {
    if (!res.headersSent) {
      const tooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
      res.writeHead(tooLarge ? 413 : 400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: tooLarge ? "Request body exceeds attachment limits" : "Invalid MCP request" }));
    }
    req.resume();
  }
});

httpServer.listen(port, () => console.error(`[TestCollab MCP] HTTP endpoint: http://localhost:${port}/mcp`));
async function shutdown() {
  httpServer.close();
  await Promise.allSettled([...sessions.values()].map(session => session.server.close()));
  httpServer.closeAllConnections();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
