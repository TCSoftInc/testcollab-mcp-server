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
 * Parse request context from HTTP headers.
 * Tokens must always come from headers — never fall back to env vars.
 * Only apiUrl and defaultProject fall back to env vars for convenience.
 */
export function parseContextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext | null {
  const apiToken = headers["x-tc-api-token"];
  let apiUrl = headers["x-tc-api-url"];
  let defaultProject = headers["x-tc-default-project"];

  // Token is required from headers — no env var fallback
  if (!apiToken || typeof apiToken !== "string") {
    return null;
  }

  // apiUrl and defaultProject can fall back to env vars
  if (!apiUrl || typeof apiUrl !== "string") {
    apiUrl = process.env["TC_API_URL"] || "http://localhost:1337";
  }
  if (!defaultProject || typeof defaultProject !== "string") {
    defaultProject = process.env["TC_DEFAULT_PROJECT"];
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
