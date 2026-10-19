/**
 * Configuration for the TestCollab MCP Server
 */

import "./env.js";
import { readFileSync } from "node:fs";

export interface Config {
  /** Base URL for the TestCollab API */
  apiBaseUrl: string;
  /** API token for authentication */
  apiToken: string;
  /** Server name for MCP identification */
  serverName: string;
  /** Server version */
  serverVersion: string;
  /** Default project ID (optional - if set, project_id becomes optional in tools) */
  defaultProjectId?: number;
}

// TCV-7109: result provenance records the installed version. The release workflow writes
// it into package.json before it publishes.
export const SERVER_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function loadConfig(): Config {
  const defaultProjectStr = process.env["TC_DEFAULT_PROJECT"];
  const defaultProjectId = defaultProjectStr ? parseInt(defaultProjectStr, 10) : undefined;

  return {
    apiBaseUrl: getEnvOrDefault("TC_API_URL", "https://api.testcollab.io"),
    apiToken: getEnvOrThrow("TC_API_TOKEN"),
    serverName: "testcollab",
    serverVersion: SERVER_VERSION,
    defaultProjectId: defaultProjectId && !isNaN(defaultProjectId) ? defaultProjectId : undefined,
  };
}

// Singleton config instance
let config: Config | null = null;

export function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}
