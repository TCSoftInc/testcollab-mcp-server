/**
 * Request Context
 *
 * Provides request-scoped configuration for HTTP transport.
 * Uses AsyncLocalStorage to pass credentials through the call stack without
 * modifying every function signature.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** API token for authentication */
  apiToken: string;
  /** Base URL for TestCollab API */
  apiUrl: string;
  /** Default project ID (optional) */
  defaultProjectId?: number;
}

// AsyncLocalStorage instance for request-scoped context
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function with request context
 * All code within the callback can access the context via getRequestContext()
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current request context
 * Returns undefined if not running within a request context (e.g., stdio transport)
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Parse request context from HTTP headers, with env var fallback
 */
export function parseContextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext | null {
  // Try headers first
  let apiToken = headers["x-tc-api-token"];
  let apiUrl = headers["x-tc-api-url"];
  let defaultProject = headers["x-tc-default-project"];

  // Fall back to env vars if headers not provided
  if (!apiToken || typeof apiToken !== "string") {
    apiToken = process.env["TC_API_TOKEN"];
  }
  if (!apiUrl || typeof apiUrl !== "string") {
    apiUrl = process.env["TC_API_URL"] || "http://localhost:1337";
  }
  if (!defaultProject || typeof defaultProject !== "string") {
    defaultProject = process.env["TC_DEFAULT_PROJECT"];
  }

  // Token is required (from either headers or env)
  if (!apiToken || typeof apiToken !== "string") {
    return null;
  }

  const context: RequestContext = {
    apiToken,
    apiUrl: typeof apiUrl === "string" ? apiUrl : "http://localhost:1337",
  };

  // Parse default project if provided
  if (defaultProject && typeof defaultProject === "string") {
    const parsed = parseInt(defaultProject, 10);
    if (!isNaN(parsed)) {
      context.defaultProjectId = parsed;
    }
  }

  return context;
}
