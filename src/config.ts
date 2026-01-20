/**
 * Configuration for the TestCollab MCP Server
 */

export interface Config {
  /** Base URL for the TestCollab API */
  apiBaseUrl: string;
  /** API token for authentication */
  apiToken: string;
  /** Server name for MCP identification */
  serverName: string;
  /** Server version */
  serverVersion: string;
}

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
  return {
    apiBaseUrl: getEnvOrDefault("TC_API_URL", "http://localhost:1337"),
    apiToken: getEnvOrThrow("TC_API_TOKEN"),
    serverName: "testcollab",
    serverVersion: "1.0.0",
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
