/**
 * TestCollab API Client
 *
 * Uses the generated SDK from tc-api-specs for type-safe API calls.
 */

import {
  createConfiguration,
  TestCasesApi,
  SuitesApi,
  type Configuration,
  type TestCase as SDKTestCase,
} from "@testcollab/sdk";
import { getConfig } from "../config.js";
import { getRequestContext } from "../context.js";
import type {
  TestCase,
  TestCaseCollection,
  TestCaseFilter,
  SortModel,
} from "../types/index.js";

// ============================================================================
// Aggrid Types (not in SDK - custom endpoint)
// ============================================================================

export interface AggridRequest {
  project: string; // Must be string, not number
  startRow: number;
  endRow: number;
  rowGroupCols: unknown[];
  valueCols: Array<{
    id: string;
    aggFunc: string;
    displayName: string;
    field: string;
  }>;
  pivotCols: unknown[];
  pivotMode: boolean;
  groupKeys: unknown[];
  filterModel: Record<string, unknown>;
  sortModel: SortModel[];
  showImmediateChildren?: boolean;
  suite?: number | false;
}

export interface AggridResponse {
  rows: TestCase[];
  lastRow: number | null;
  totalCount: number;
  filteredCount: number;
}

// ============================================================================
// API Client Class
// ============================================================================

export interface ApiClientCredentials {
  apiToken: string;
  apiUrl: string;
}

export class TestCollabApiClient {
  private config: Configuration;
  private baseUrl: string;
  private token: string;
  private testCasesApi: TestCasesApi;
  private suitesApi: SuitesApi;

  constructor(credentials?: ApiClientCredentials) {
    // Use provided credentials or fall back to env config
    if (credentials) {
      this.baseUrl = credentials.apiUrl;
      this.token = credentials.apiToken;
    } else {
      const appConfig = getConfig();
      this.baseUrl = appConfig.apiBaseUrl;
      this.token = appConfig.apiToken;
    }

    // Create SDK configuration
    this.config = createConfiguration(this.token, {
      basePath: this.baseUrl,
    });

    // Initialize API instances
    this.testCasesApi = new TestCasesApi(this.config);
    this.suitesApi = new SuitesApi(this.config);
  }

  /**
   * Make a raw HTTP request (for endpoints not in SDK like aggrid)
   * Uses token as query parameter (same as SDK)
   */
  private async rawRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${separator}token=${encodeURIComponent(this.token)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * List test cases using the aggrid endpoint (optimized for filtering/pagination)
   * Note: aggrid endpoint is not in the public SDK, so we use raw HTTP
   */
  async listTestCases(params: {
    projectId: number;
    suiteId?: number;
    filter?: TestCaseFilter;
    sort?: SortModel[];
    limit?: number;
    offset?: number;
  }): Promise<TestCaseCollection> {
    const { projectId, suiteId, filter, sort, limit = 50, offset = 0 } = params;

    // Build the aggrid request payload with exact format the backend expects
    const aggridRequest: AggridRequest = {
      project: String(projectId), // Must be string
      startRow: offset,
      endRow: offset + limit,
      rowGroupCols: [],
      valueCols: [
        { id: "id", aggFunc: "count", displayName: "ID", field: "id" },
      ],
      pivotCols: [],
      pivotMode: false,
      groupKeys: [],
      filterModel: {},
      sortModel: sort || [],
      showImmediateChildren: false,
    };

    // Add suite filter if provided
    if (suiteId) {
      aggridRequest.suite = suiteId;
      aggridRequest.filterModel = {
        ...aggridRequest.filterModel,
        suite: {
          filterType: "number",
          type: "equals",
          filter: suiteId,
        },
      };
    }

    // Merge in additional filters
    if (filter) {
      aggridRequest.filterModel = {
        ...aggridRequest.filterModel,
        ...filter,
      };
    }

    const response = await this.rawRequest<AggridResponse>(
      "POST",
      "/testcases/aggrid",
      aggridRequest
    );

    return {
      rows: response.rows,
      totalCount: response.totalCount,
      filteredCount: response.filteredCount,
      lastRow: response.lastRow ?? undefined,
    };
  }

  /**
   * Get a single test case by ID using SDK
   */
  async getTestCase(id: number, projectId: number): Promise<SDKTestCase> {
    return this.testCasesApi.getTestCase({
      id,
      project: projectId,
    });
  }

  /**
   * Get a single project by ID (raw API call)
   */
  async getProject(projectId: number): Promise<Record<string, unknown>> {
    const encodedProjectId = encodeURIComponent(String(projectId));
    return this.rawRequest<Record<string, unknown>>(
      "GET",
      `/projects/${encodedProjectId}`
    );
  }

  /**
   * Create a new test case using raw API (supports custom fields)
   */
  async createTestCase(data: {
    projectId: number;
    title: string;
    suiteId?: number;
    description?: string;
    priority?: number;
    steps?: Array<{
      step: string;
      expected_result?: string;
    }>;
    tags?: number[];
    requirements?: number[];
    customFields?: Array<{
      id: number;
      name: string;
      label?: string;
      value: string | number | null;
      valueLabel?: string;
      color?: string;
    }>;
    attachments?: string[];
  }): Promise<TestCase> {
    const payload: Record<string, unknown> = {
      project: data.projectId,
      title: data.title,
    };

    if (data.suiteId !== undefined) {
      payload.suite = data.suiteId;
    }
    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.priority !== undefined) {
      payload.priority = data.priority;
    }
    if (data.steps && data.steps.length > 0) {
      payload.steps = data.steps;
    }
    if (data.tags && data.tags.length > 0) {
      payload.tags = data.tags;
    }
    if (data.requirements && data.requirements.length > 0) {
      payload.requirements = data.requirements;
    }
    if (data.customFields && data.customFields.length > 0) {
      payload.custom_fields = data.customFields;
    }
    if (data.attachments && data.attachments.length > 0) {
      payload.attachments = data.attachments;
    }

    return this.rawRequest<TestCase>("POST", "/testcases", payload);
  }

  /**
   * Update an existing test case using raw API (supports partial updates and custom fields)
   */
  async updateTestCase(
    id: number,
    projectId: number,
    data: {
      title?: string;
      description?: string | null;
      priority?: number;
      suiteId?: number | null;
      steps?: Array<{
        step: string;
        expectedResult?: string;
        reusableStepId?: number | null;
      }> | null;
      tags?: number[] | null;
      requirements?: number[] | null;
      customFields?: Array<{
        id: number;
        name: string;
        label?: string;
        value: string | number | null;
        valueLabel?: string;
        color?: string;
      }> | null;
      attachments?: string[] | null;
    }
  ): Promise<TestCase> {
    const payload: Record<string, unknown> = {
      project: projectId,
    };

    if (data.title !== undefined) {
      payload.title = data.title;
    }
    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.priority !== undefined) {
      payload.priority = data.priority;
    }
    if (data.suiteId !== undefined) {
      payload.suite = data.suiteId;
    }
    if (data.steps !== undefined) {
      payload.steps = data.steps;
    }
    if (data.tags !== undefined) {
      payload.tags = data.tags;
    }
    if (data.requirements !== undefined) {
      payload.requirements = data.requirements;
    }
    if (data.customFields !== undefined) {
      payload.custom_fields = data.customFields;
    }
    if (data.attachments !== undefined) {
      payload.attachments = data.attachments;
    }

    return this.rawRequest<TestCase>("PUT", `/testcases/${id}`, payload);
  }

  /**
   * Delete a test case using SDK
   */
  async deleteTestCase(
    id: number,
    projectId: number
  ): Promise<{ success: boolean }> {
    await this.testCasesApi.deleteTestCase({
      id,
      project: projectId,
    });
    return { success: true };
  }

  /**
   * List suites for a project using SDK
   */
  async listSuites(projectId: number) {
    return this.suitesApi.getAllSuites({
      project: projectId,
    });
  }

  async listTags(projectId: number, companyId?: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    if (companyId !== undefined) {
      params.set("company", String(companyId));
    }
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/tags?${params.toString()}`
    );
  }

  async listRequirements(projectId: number, companyId?: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    if (companyId !== undefined) {
      params.set("company", String(companyId));
    }
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/requirements?${params.toString()}`
    );
  }

  async listProjectCustomFields(projectId: number, companyId?: number) {
    const entity = encodeURIComponent("TestCase");
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    if (companyId !== undefined) {
      params.set("company", String(companyId));
    }
    params.set("entity", entity);
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/customfields?${params.toString()}`
    );
  }
}

// ============================================================================
// Client Factory
// ============================================================================

// Singleton for stdio transport (uses env vars)
let stdioClient: TestCollabApiClient | null = null;

/**
 * Get an API client instance.
 *
 * For HTTP transport: Creates a new client using request context credentials.
 * For stdio transport: Returns singleton client using env var credentials.
 */
export function getApiClient(): TestCollabApiClient {
  // Check for request context (HTTP transport)
  const requestContext = getRequestContext();

  if (requestContext) {
    // HTTP transport: create client with request credentials
    // Note: We create a new client per-request for simplicity
    // Could optimize with a cache keyed by token if needed
    return new TestCollabApiClient({
      apiToken: requestContext.apiToken,
      apiUrl: requestContext.apiUrl,
    });
  }

  // Stdio transport: use singleton with env vars
  if (!stdioClient) {
    stdioClient = new TestCollabApiClient();
  }
  return stdioClient;
}

/**
 * Reset the stdio client (useful for testing)
 */
export function resetApiClient(): void {
  stdioClient = null;
}
