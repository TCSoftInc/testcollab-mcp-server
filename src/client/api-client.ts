/**
 * TestCollab API Client
 *
 * Uses the generated SDK from tc-api-specs for type-safe API calls.
 */

import {
  createConfiguration,
  TestCasesApi,
  SuitesApi,
  TestCasePayloadPriorityEnum,
  type Configuration,
  type TestCase as SDKTestCase,
  type TestCaseStepsPayload,
} from "@testcollab/sdk";
import { getConfig } from "../config.js";
import type {
  TestCase,
  TestCaseCollection,
  TestCaseFilter,
  SortModel,
} from "../types/index.js";

// ============================================================================
// Helper Functions for SDK Type Conversion
// ============================================================================

/**
 * Convert a numeric priority to SDK enum
 */
function toPriorityEnum(
  priority?: number
): typeof TestCasePayloadPriorityEnum[keyof typeof TestCasePayloadPriorityEnum] | undefined {
  if (priority === undefined) return undefined;
  switch (priority) {
    case 0:
      return TestCasePayloadPriorityEnum.NUMBER_0;
    case 1:
      return TestCasePayloadPriorityEnum.NUMBER_1;
    case 2:
      return TestCasePayloadPriorityEnum.NUMBER_2;
    default:
      return TestCasePayloadPriorityEnum.NUMBER_1; // Default to Normal
  }
}

/**
 * Convert step data to SDK payload format
 */
function toStepsPayload(
  steps?: Array<{
    step_no: number;
    action: string;
    expected_result?: string;
  }>
): TestCaseStepsPayload[] | undefined {
  if (!steps) return undefined;
  return steps.map((s) => ({
    step: s.action,
    expectedResult: s.expected_result,
  }));
}

// ============================================================================
// Aggrid Types (not in SDK - custom endpoint)
// ============================================================================

export interface AggridRequest {
  project: number;
  startRow?: number;
  endRow?: number;
  sortModel?: SortModel[];
  filterModel?: Record<string, unknown>;
  includeAllFelds?: boolean;
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

export class TestCollabApiClient {
  private config: Configuration;
  private baseUrl: string;
  private token: string;
  private testCasesApi: TestCasesApi;
  private suitesApi: SuitesApi;

  constructor() {
    const appConfig = getConfig();
    this.baseUrl = appConfig.apiBaseUrl;
    this.token = appConfig.apiToken;

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
   */
  private async rawRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
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

    // Build the aggrid request payload
    const aggridRequest: AggridRequest = {
      project: projectId,
      startRow: offset,
      endRow: offset + limit,
      sortModel: sort || [{ colId: "updated_at", sort: "desc" }],
      filterModel: {},
      includeAllFelds: true,
    };

    // Add suite filter if provided
    if (suiteId) {
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
   * Create a new test case using SDK
   */
  async createTestCase(data: {
    project: number;
    suite: number;
    title: string;
    description?: string;
    precondition?: string;
    expected_result?: string;
    priority?: number;
    steps?: Array<{
      step_no: number;
      action: string;
      expected_result?: string;
    }>;
    tags?: number[];
  }): Promise<SDKTestCase> {
    return this.testCasesApi.createTestCase({
      testCasePayload: {
        project: data.project,
        suite: data.suite,
        title: data.title,
        description: data.description,
        priority: toPriorityEnum(data.priority),
        steps: toStepsPayload(data.steps),
        tags: data.tags,
      },
    });
  }

  /**
   * Update an existing test case using SDK
   */
  async updateTestCase(
    id: number,
    projectId: number,
    data: {
      title: string; // Required by SDK
      description?: string;
      precondition?: string;
      expected_result?: string;
      priority?: number;
      suite?: number;
      steps?: Array<{
        step_no: number;
        action: string;
        expected_result?: string;
      }>;
      tags?: number[];
    }
  ): Promise<SDKTestCase> {
    return this.testCasesApi.updateTestCase({
      id,
      testCasePayload: {
        project: projectId,
        title: data.title,
        description: data.description,
        priority: toPriorityEnum(data.priority),
        suite: data.suite,
        steps: toStepsPayload(data.steps),
        tags: data.tags,
      },
    });
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
}

// ============================================================================
// Singleton Instance
// ============================================================================

let client: TestCollabApiClient | null = null;

export function getApiClient(): TestCollabApiClient {
  if (!client) {
    client = new TestCollabApiClient();
  }
  return client;
}

/**
 * Reset the client (useful for testing)
 */
export function resetApiClient(): void {
  client = null;
}
