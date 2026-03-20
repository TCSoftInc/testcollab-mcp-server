/**
 * TestCollab API Client
 *
 * Uses the generated SDK from tc-api-specs for type-safe API calls.
 */

import {
  createConfiguration,
  TestCasesApi,
  TestPlansApi,
  SuitesApi,
  type Configuration,
  type TestCase as SDKTestCase,
  type TestPlan as SDKTestPlan,
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

export interface TestCaseSelectorQuery {
  field: string;
  operator: string;
  value: string;
}

export interface TestCaseSelectorCollection {
  testCases?: number[];
  selector?: TestCaseSelectorQuery[];
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
  private testPlansApi: TestPlansApi;
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
    this.testPlansApi = new TestPlansApi(this.config);
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
   * List test plans with optional filtering, sorting, and pagination.
   */
  async listTestPlans(params: {
    projectId: number;
    limit?: number;
    offset?: number;
    sort?: string;
    filter?: Record<string, unknown>;
  }): Promise<SDKTestPlan[]> {
    const { projectId, limit = 25, offset = 0, sort, filter } = params;

    return this.testPlansApi.getTestPlans({
      project: projectId,
      limit,
      start: offset,
      ...(sort ? { sort } : {}),
      ...(filter && Object.keys(filter).length > 0
        ? { filter: JSON.stringify(filter) }
        : {}),
    });
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
   * Get a single test case by ID using raw API (preserves full payload)
   */
  async getTestCaseRaw(
    id: number,
    projectId: number,
    options?: { parseRs?: boolean }
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    if (options?.parseRs) {
      params.set("parse_rs", "1");
    }
    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "GET",
      `/testcases/${encodedId}?${params.toString()}`
    );
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
   * Create a new test plan.
   */
  async createTestPlan(data: {
    projectId: number;
    title: string;
    description?: string;
    priority?: number;
    testPlanFolderId?: number | null;
    release?: number;
    startDate?: string;
    endDate?: string;
    customFields?: Array<{
      id: number;
      name: string;
      label?: string;
      value: string | number | Array<string | number> | null;
      valueLabel?: string | string[];
      color?: string;
    }>;
  }): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      project: data.projectId,
      title: data.title,
    };

    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.priority !== undefined) {
      payload.priority = data.priority;
    }
    if (data.testPlanFolderId !== undefined) {
      payload.test_plan_folder = data.testPlanFolderId;
    }
    if (data.release !== undefined) {
      payload.release = data.release;
    }
    if (data.startDate !== undefined) {
      payload.start_date = data.startDate;
    }
    if (data.endDate !== undefined) {
      payload.end_date = data.endDate;
    }
    if (data.customFields !== undefined) {
      payload.custom_fields = data.customFields;
    }

    return this.rawRequest<Record<string, unknown>>("POST", "/testplans", payload);
  }

  /**
   * Get a single test plan by ID using raw API (preserves full payload).
   */
  async getTestPlanRaw(id: number): Promise<Record<string, unknown>> {
    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "GET",
      `/testplans/${encodedId}`
    );
  }

  /**
   * Get count of test cases included in a test plan.
   */
  async getTestPlanTestCaseCount(
    projectId: number,
    testPlanId: number
  ): Promise<{ count: number }> {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    params.set("filter", JSON.stringify({ testplan: testPlanId }));
    return this.rawRequest<{ count: number }>(
      "GET",
      `/testplantestcases/count?${params.toString()}`
    );
  }

  /**
   * List configurations for a test plan.
   */
  async listTestPlanConfigurations(params: {
    projectId: number;
    testplan: number;
    limit?: number;
    start?: number;
    sort?: string;
    filter?: Record<string, unknown>;
  }): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams();
    query.set("project", String(params.projectId));
    query.set("testplan", String(params.testplan));
    if (params.limit !== undefined) {
      query.set("_limit", String(params.limit));
    }
    if (params.start !== undefined) {
      query.set("_start", String(params.start));
    }
    if (params.sort) {
      query.set("_sort", params.sort);
    }
    if (params.filter && Object.keys(params.filter).length > 0) {
      query.set("_filter", JSON.stringify(params.filter));
    }
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/testplanconfigurations?${query.toString()}`
    );
  }

  /**
   * List runs (regressions) for a test plan.
   */
  async listTestPlanRegressions(params: {
    projectId: number;
    testplan: number;
    testPlanConfigurationId?: number;
    limit?: number;
    start?: number;
    sort?: string;
    filter?: Record<string, unknown>;
  }): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams();
    query.set("project", String(params.projectId));
    query.set("testplan", String(params.testplan));
    if (params.testPlanConfigurationId !== undefined) {
      query.set(
        "test_plan_configuration_id",
        String(params.testPlanConfigurationId)
      );
    }
    if (params.limit !== undefined) {
      query.set("_limit", String(params.limit));
    }
    if (params.start !== undefined) {
      query.set("_start", String(params.start));
    }
    if (params.sort) {
      query.set("_sort", params.sort);
    }
    if (params.filter && Object.keys(params.filter).length > 0) {
      query.set("_filter", JSON.stringify(params.filter));
    }
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/testplanregressions?${query.toString()}`
    );
  }

  /**
   * Get count of runs (regressions), optionally filtered.
   */
  async getTestPlanRegressionCount(
    projectId: number,
    filter?: Record<string, unknown>
  ): Promise<{ count: number }> {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    if (filter && Object.keys(filter).length > 0) {
      params.set("filter", JSON.stringify(filter));
    }
    return this.rawRequest<{ count: number }>(
      "GET",
      `/testplanregressions/count?${params.toString()}`
    );
  }

  /**
   * Update an existing test plan using raw API.
   */
  async updateTestPlan(
    id: number,
    data: {
      projectId: number;
      title: string;
      priority: number;
      status: number;
      testPlanFolderId: number | null;
      description?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      archived?: boolean;
      assignmentMethod?: "automatic" | "manual";
      assignmentCriteria?: "testCase" | "configuration";
      assignedTo?: number[];
      release?: number | null;
      customFields?: Array<{
        id: number;
        name: string;
        label?: string;
        value: string | number | Array<string | number> | null;
        valueLabel?: string | string[];
        color?: string;
      }>;
    }
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      project: data.projectId,
      title: data.title,
      priority: data.priority,
      status: data.status,
      test_plan_folder: data.testPlanFolderId,
    };

    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.startDate !== undefined) {
      payload.start_date = data.startDate;
    }
    if (data.endDate !== undefined) {
      payload.end_date = data.endDate;
    }
    if (data.archived !== undefined) {
      payload.archived = data.archived;
    }
    if (data.assignmentMethod !== undefined) {
      payload.assignment_method = data.assignmentMethod;
    }
    if (data.assignmentCriteria !== undefined) {
      payload.assignment_criteria = data.assignmentCriteria;
    }
    if (data.assignedTo !== undefined) {
      payload.assigned_to = data.assignedTo;
    }
    if (data.release !== undefined) {
      payload.release = data.release;
    }
    if (data.customFields !== undefined) {
      payload.custom_fields = data.customFields;
    }

    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "PUT",
      `/testplans/${encodedId}`,
      payload
    );
  }

  /**
   * Delete a test plan using SDK.
   */
  async deleteTestPlan(
    id: number,
    projectId: number
  ): Promise<Record<string, unknown>> {
    return this.testPlansApi.deleteTestPlan({
      id,
      project: projectId,
    }) as Promise<Record<string, unknown>>;
  }

  /**
   * Bulk add test cases to a test plan.
   */
  async bulkAddTestPlanTestCases(data: {
    testplan: number;
    testCaseCollection: TestCaseSelectorCollection;
    assignee?: number | "me";
  }): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      testplan: data.testplan,
      testCaseCollection: data.testCaseCollection,
    };
    if (data.assignee !== undefined) {
      payload.assignee = data.assignee;
    }
    return this.rawRequest<Record<string, unknown>>(
      "POST",
      "/testplantestcases/bulkAdd",
      payload
    );
  }

  /**
   * Create or replace test plan configurations.
   */
  async createTestPlanConfigurations(data: {
    projectId: number;
    testplan: number;
    parameters: Array<Array<{ id?: string; field: string; value: string }>>;
  }): Promise<Array<Record<string, unknown>> | Record<string, unknown>> {
    const payload = {
      project: data.projectId,
      testplan: data.testplan,
      parameters: data.parameters,
    };
    return this.rawRequest<Array<Record<string, unknown>> | Record<string, unknown>>(
      "POST",
      "/testplanconfigurations",
      payload
    );
  }

  /**
   * Assign a test plan.
   */
  async assignTestPlan(data: {
    projectId: number;
    testplan: number;
    executor: "me" | "team";
    assignmentCriteria: "testCase" | "configuration";
    assignmentMethod: "automatic" | "manual";
    assignment: {
      user: Array<number | "me">;
      testCases: TestCaseSelectorCollection | null;
      configuration: number[] | null;
    };
  }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set("project", String(data.projectId));
    params.set("testplan", String(data.testplan));

    const payload: Record<string, unknown> = {
      project: data.projectId,
      testplan: data.testplan,
      executor: data.executor,
      assignment_criteria: data.assignmentCriteria,
      assignment_method: data.assignmentMethod,
      assignment: data.assignment,
    };

    return this.rawRequest<Record<string, unknown>>(
      "POST",
      `/testplans/assign?${params.toString()}`,
      payload
    );
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
   * List suites for a project using SDK.
   */
  async listSuites(
    projectId: number,
    options?: {
      filter?: Record<string, unknown>;
    }
  ) {
    return this.suitesApi.getAllSuites({
      project: projectId,
      ...(options?.filter && Object.keys(options.filter).length > 0
        ? { filter: JSON.stringify(options.filter) }
        : {}),
    });
  }

  /**
   * Create a new suite using raw API
   */
  async createSuite(data: {
    projectId: number;
    title: string;
    description?: string;
    parentId?: number | null;
  }): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      project: data.projectId,
      title: data.title,
    };
    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.parentId !== undefined) {
      payload.parent_id = data.parentId;
    }
    return this.rawRequest<Record<string, unknown>>("POST", "/suites", payload);
  }

  /**
   * Get a single suite by ID using raw API
   */
  async getSuite(id: number, projectId: number): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "GET",
      `/suites/${encodedId}?${params.toString()}`
    );
  }

  /**
   * Update a suite using raw API
   */
  async updateSuite(
    id: number,
    data: {
      projectId: number;
      title?: string;
      description?: string | null;
      parentId?: number | null;
    }
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};
    if (data.title !== undefined) {
      payload.title = data.title;
    }
    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.parentId !== undefined) {
      payload.parent_id = data.parentId;
    }
    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "PUT",
      `/suites/${encodedId}?project=${encodeURIComponent(String(data.projectId))}`,
      payload
    );
  }

  /**
   * Delete a suite using raw API
   */
  async deleteSuite(id: number, projectId: number): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    const encodedId = encodeURIComponent(String(id));
    return this.rawRequest<Record<string, unknown>>(
      "DELETE",
      `/suites/${encodedId}?${params.toString()}`
    );
  }

  /**
   * Set suite sort order using raw API
   */
  async setSuiteOrder(data: {
    projectId: number;
    parentId: number | null;
    suiteIds: number[];
  }): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      project: data.projectId,
      parent_id: data.parentId,
      suites: data.suiteIds,
    };
    return this.rawRequest<Record<string, unknown>>(
      "POST",
      "/suites/setOrder",
      payload
    );
  }

  async listTestPlanFolders(projectId: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/testplanfolders?${params.toString()}`
    );
  }

  async listReleases(projectId: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/releases?${params.toString()}`
    );
  }

  async listTags(projectId: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    // if (companyId !== undefined) {
    //   params.set("company", String(companyId));
    // }
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/tags?${params.toString()}`
    );
  }

  async listRequirements(projectId: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    // if (companyId !== undefined) {
    //   params.set("company", String(companyId));
    // }
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/requirements?${params.toString()}`
    );
  }

  async listProjectUsers(projectId: number) {
    const params = new URLSearchParams();
    params.set("project", String(projectId));
    params.set("_limit", "-1");
    return this.rawRequest<Array<Record<string, unknown>>>(
      "GET",
      `/projectusers?${params.toString()}`
    );
  }

  async listProjectCustomFields(
    projectId: number,
    companyId?: number,
    entity: "TestCase" | "TestPlan" = "TestCase"
  ) {
    const encodedEntity = encodeURIComponent(entity);
    const params = new URLSearchParams();
    params.set("projects", String(projectId));
    if (companyId !== undefined) {
      params.set("company", String(companyId));
    }
    params.set("entity", encodedEntity);
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
