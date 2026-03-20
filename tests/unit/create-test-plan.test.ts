import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/api-client.js", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("../../src/resources/project-context.js", () => ({
  getCachedProjectContext: vi.fn(),
}));

type HandleCreateTestPlan =
  typeof import("../../src/tools/test-plans/create.js").handleCreateTestPlan;
type GetApiClient = typeof import("../../src/client/api-client.js").getApiClient;
type GetCachedProjectContext =
  typeof import("../../src/resources/project-context.js").getCachedProjectContext;

let handleCreateTestPlan: HandleCreateTestPlan;
let getApiClient: GetApiClient;
let getCachedProjectContext: GetCachedProjectContext;

const loadModules = async () => {
  const createTestPlanTool = await import("../../src/tools/test-plans/create.js");
  handleCreateTestPlan = createTestPlanTool.handleCreateTestPlan;

  const apiClient = await import("../../src/client/api-client.js");
  getApiClient = apiClient.getApiClient;

  const projectContext = await import("../../src/resources/project-context.js");
  getCachedProjectContext = projectContext.getCachedProjectContext;
};

describe("create_test_plan tool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.TC_API_TOKEN = "test-token";
    process.env.TC_API_URL = "http://example.local";
    process.env.TC_DEFAULT_PROJECT = "16";
    await loadModules();
    vi.mocked(getCachedProjectContext).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates test plan and executes all optional flow steps", async () => {
    const listTestPlanFolders = vi.fn().mockResolvedValue([
      { id: 42, title: "Mobile" },
    ]);
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      { id: 12, name: "build", label: "Build", type: "text" },
      {
        id: 13,
        name: "browser",
        label: "Browser",
        type: "dropdown",
        extra: {
          actAsConfig: true,
          options: [{ label: "Chrome", id: "1" }],
        },
      },
      {
        id: 14,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 777, title: "Release 2.9 Regression" });
    const bulkAddTestPlanTestCases = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 3 });
    const createTestPlanConfigurations = vi
      .fn()
      .mockResolvedValue([{ id: 9001 }]);
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlanFolders,
      getProject,
      listProjectCustomFields,
      createTestPlan,
      bulkAddTestPlanTestCases,
      createTestPlanConfigurations,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Release 2.9 Regression",
      test_plan_folder: "Mobile",
      custom_fields: [
        { name: "build", value: "2.9.0-rc1" },
        { name: "browser", value: "Chrome" },
      ],
      test_cases: {
        test_case_ids: ["101", "102", "103"],
      },
      configurations: [
        [
          { field: "Browser", value: "Chrome" },
          { field: "OS", value: "Windows" },
        ],
      ],
      assignment: {
        executor: "team",
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: ["27", "31"],
        test_case_ids: ["101", "102"],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.create_test_plan.status).toBe("completed");
    expect(payload.steps.add_test_cases.status).toBe("completed");
    expect(payload.steps.add_configurations.status).toBe("completed");
    expect(payload.steps.assign_test_plan.status).toBe("completed");

    expect(createTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 16,
        title: "Release 2.9 Regression",
        testPlanFolderId: 42,
      })
    );

    const createTestPlanArg = createTestPlan.mock.calls[0][0] as {
      customFields?: Array<{ id: number; name: string; value: unknown }>;
    };
    expect(createTestPlanArg.customFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 12, name: "build", value: "2.9.0-rc1" }),
        expect.objectContaining({ id: 13, name: "browser", value: "1" }),
      ])
    );

    expect(bulkAddTestPlanTestCases).toHaveBeenCalledWith({
      testplan: 777,
      testCaseCollection: {
        testCases: [101, 102, 103],
        selector: [],
      },
    });

    expect(createTestPlanConfigurations).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 777,
      parameters: [
        [
          { field: "Browser", value: "Chrome" },
          { field: "OS", value: "Windows" },
        ],
      ],
    });

    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 777,
      executor: "team",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: [27, 31],
        testCases: {
          testCases: [101, 102],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("resolves test_plan_folder title from cached project context", async () => {
    const cachedContext: NonNullable<ReturnType<GetCachedProjectContext>> = {
      project_id: 16,
      suites: [],
      tags: [],
      test_case_custom_fields: [],
      test_plan_custom_fields: [],
      test_plan_configuration_fields: [],
      custom_fields: [],
      requirements: [],
      test_plan_folders: [{ id: 42, title: "Mobile", parent_id: null }],
      releases: [],
      users: [],
    };
    vi.mocked(getCachedProjectContext).mockReturnValue(cachedContext);

    const listTestPlanFolders = vi.fn();
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 777, title: "Release 2.9 Regression" });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlanFolders,
      createTestPlan,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Release 2.9 Regression",
      test_plan_folder: "mobile",
      assignment: {
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(listTestPlanFolders).not.toHaveBeenCalled();
    expect(createTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 16,
        testPlanFolderId: 42,
      })
    );
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 777,
      executor: "team",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: [27],
        testCases: {
          testCases: [],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it('passes test_cases.assignee as "me" for bulk add and auto-assignment', async () => {
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 778, title: "Me-assigned plan" });
    const bulkAddTestPlanTestCases = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      bulkAddTestPlanTestCases,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Me-assigned plan",
      project_id: 16,
      test_cases: {
        test_case_ids: [1001],
        assignee: "me",
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.add_test_cases.status).toBe("completed");
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(bulkAddTestPlanTestCases).toHaveBeenCalledWith({
      testplan: 778,
      testCaseCollection: {
        testCases: [1001],
        selector: [],
      },
      assignee: "me",
    });
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 778,
      executor: "me",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: ["me"],
        testCases: {
          testCases: [1001],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("resolves test_cases.assignee by project user name and auto-assigns", async () => {
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 780, title: "Named-assignee plan" });
    const bulkAddTestPlanTestCases = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const listProjectUsers = vi.fn().mockResolvedValue([
      {
        id: 2001,
        user: {
          id: 45,
          name: "Jane Doe",
          username: "jane",
          email: "jane@example.com",
        },
      },
    ]);

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      bulkAddTestPlanTestCases,
      assignTestPlan,
      listProjectUsers,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Named-assignee plan",
      project_id: 16,
      test_cases: {
        test_case_ids: [1001],
        assignee: "Jane Doe",
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.add_test_cases.status).toBe("completed");
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(bulkAddTestPlanTestCases).toHaveBeenCalledWith({
      testplan: 780,
      testCaseCollection: {
        testCases: [1001],
        selector: [],
      },
      assignee: 45,
    });
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 780,
      executor: "team",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: [45],
        testCases: {
          testCases: [1001],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("returns missing-info error when test cases are provided without assignee info", async () => {
    const createTestPlan = vi.fn();
    const bulkAddTestPlanTestCases = vi.fn();
    const assignTestPlan = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      bulkAddTestPlanTestCases,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Unassigned plan",
      project_id: 16,
      test_cases: {
        test_case_ids: [1001, 1002],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: {
        code: string;
        details?: {
          missing_fields?: string[];
          follow_up_questions?: string[];
        };
      };
    };

    expect(payload.error.code).toBe("MISSING_ASSIGNEE_INFO");
    expect(payload.error.details?.missing_fields).toEqual([
      "test_cases.assignee",
      "assignment.user_ids",
    ]);
    expect(payload.error.details?.follow_up_questions).toEqual([
      'Who should be assigned as test_cases.assignee? (user ID, "me", name, username, or email)',
      "Which user_ids should receive the manual assignment?",
    ]);
    expect(createTestPlan).not.toHaveBeenCalled();
    expect(bulkAddTestPlanTestCases).not.toHaveBeenCalled();
    expect(assignTestPlan).not.toHaveBeenCalled();
  });

  it('uses assignment user "me" when prompt-level input targets self', async () => {
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 779, title: "Self assignment" });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Self assignment",
      project_id: 16,
      assignment: {
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: ["me"],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 779,
      executor: "me",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: ["me"],
        testCases: {
          testCases: [],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("resolves assignment.user_ids by project user name", async () => {
    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 781, title: "Named assignment" });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const listProjectUsers = vi.fn().mockResolvedValue([
      {
        id: 3001,
        user: {
          id: 91,
          name: "Alex QA",
          username: "alex.qa",
          email: "alex.qa@example.com",
        },
      },
    ]);

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      assignTestPlan,
      listProjectUsers,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Named assignment",
      project_id: 16,
      assignment: {
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: ["Alex QA"],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 781,
      executor: "team",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: [91],
        testCases: {
          testCases: [],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("uses generated title when title is not provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 20, 10, 30, 5));

    const createTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 782, title: "Generated title" });
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      project_id: 16,
      assignment: {
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.create_test_plan.status).toBe("completed");
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(createTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 16,
        title: "Test Plan 20 February 2026 10:30:05",
      })
    );
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 782,
      executor: "team",
      assignmentCriteria: "testCase",
      assignmentMethod: "automatic",
      assignment: {
        user: [27],
        testCases: {
          testCases: [],
          selector: [],
        },
        configuration: null,
      },
    });
  });

  it("returns missing-info error when assignee info is not provided", async () => {
    const createTestPlan = vi.fn();
    const assignTestPlan = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan without assignee",
      project_id: 16,
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: {
        code: string;
        details?: {
          missing_fields?: string[];
          follow_up_questions?: string[];
        };
      };
    };

    expect(payload.error.code).toBe("MISSING_ASSIGNEE_INFO");
    expect(payload.error.details?.missing_fields).toEqual([
      "test_cases.assignee",
      "assignment.user_ids",
    ]);
    expect(payload.error.details?.follow_up_questions).toEqual([
      'Who should be assigned as test_cases.assignee? (user ID, "me", name, username, or email)',
      "Which user_ids should receive the manual assignment?",
    ]);
    expect(createTestPlan).not.toHaveBeenCalled();
    expect(assignTestPlan).not.toHaveBeenCalled();
  });

  it("returns missing required info details when project_id cannot be resolved", async () => {
    vi.resetModules();
    process.env.TC_DEFAULT_PROJECT = "";
    await loadModules();

    const response = await handleCreateTestPlan({
      title: "Plan without explicit project",
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: {
        code: string;
        details?: {
          missing_fields?: string[];
          follow_up_questions?: string[];
        };
      };
    };

    expect(payload.error.code).toBe("MISSING_PROJECT_ID");
    expect(payload.error.details?.missing_fields).toContain("project_id");
    expect(payload.error.details?.follow_up_questions).toContain(
      "Which project_id should I use?"
    );
  });

  it("returns missing required info details for manual assignment without users", async () => {
    const response = await handleCreateTestPlan({
      title: "Manual assignment without users",
      project_id: 16,
      assignment: {
        executor: "team",
        assignment_criteria: "testCase",
        assignment_method: "manual",
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: {
        code: string;
        details?: {
          missing_fields?: string[];
          follow_up_questions?: string[];
        };
      };
    };

    expect(payload.error.code).toBe("MISSING_ASSIGNMENT_USERS");
    expect(payload.error.details?.missing_fields).toContain("assignment.user_ids");
    expect(payload.error.details?.follow_up_questions).toContain(
      "Which user_ids should receive the manual assignment?"
    );
  });

  it("sends null testCases for configuration-based assignment", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 889, title: "Plan B" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlanConfigurations = vi.fn().mockResolvedValue([{ id: 9001 }]);
    const assignTestPlan = vi.fn().mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      createTestPlanConfigurations,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan B",
      project_id: 16,
      configurations: [[{ field: "OS", value: "Windows" }]],
      assignment: {
        assignment_criteria: "configuration",
        assignment_method: "manual",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.add_configurations.status).toBe("completed");
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 889,
      executor: "team",
      assignmentCriteria: "configuration",
      assignmentMethod: "manual",
      assignment: {
        user: [27],
        testCases: null,
        configuration: [9001],
      },
    });
  });

  it("uses empty test case selector and null configuration for automatic configuration assignment", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 892, title: "Plan E" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlanConfigurations = vi.fn().mockResolvedValue([{ id: 9004 }]);
    const assignTestPlan = vi.fn().mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      createTestPlanConfigurations,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan E",
      project_id: 16,
      configurations: [[{ field: "OS", value: "Windows" }]],
      assignment: {
        assignment_criteria: "configuration",
        assignment_method: "automatic",
        user_ids: [27, 31],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(assignTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentCriteria: "configuration",
        assignmentMethod: "automatic",
        assignment: expect.objectContaining({
          testCases: { testCases: [], selector: [] },
          configuration: null,
        }),
      })
    );
  });

  it("syncs test plan assigned_to with all configuration assignees", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 893, title: "Plan F" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlanConfigurations = vi
      .fn()
      .mockResolvedValue([{ id: 9101 }, { id: 9102 }]);
    const assignTestPlan = vi.fn().mockResolvedValue({ status: true, created_id: 1 });
    const listTestPlanConfigurations = vi.fn().mockResolvedValue([
      { id: 9101, assigned_to: 27 },
      { id: 9102, assigned_to: 31 },
    ]);
    const getTestPlanRaw = vi.fn().mockResolvedValue({
      id: 893,
      title: "Plan F",
      priority: 1,
      status: 1,
      test_plan_folder: null,
      release: null,
    });
    const updateTestPlan = vi.fn().mockResolvedValue({ status: true });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      createTestPlanConfigurations,
      assignTestPlan,
      listTestPlanConfigurations,
      getTestPlanRaw,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan F",
      project_id: 16,
      priority: 1,
      configurations: [
        [{ field: "OS", value: "Windows" }],
        [{ field: "OS", value: "Linux" }],
      ],
      assignment: {
        assignment_criteria: "configuration",
        assignment_method: "automatic",
        user_ids: [27, 31],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      steps: Record<string, { status: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.steps.assign_test_plan.status).toBe("completed");
    expect(assignTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentCriteria: "configuration",
        assignmentMethod: "automatic",
        assignment: expect.objectContaining({
          user: [27, 31],
          testCases: { testCases: [], selector: [] },
          configuration: null,
        }),
      })
    );
    expect(updateTestPlan).toHaveBeenCalledWith(
      893,
      expect.objectContaining({
        projectId: 16,
        title: "Plan F",
        priority: 1,
        status: 1,
        testPlanFolderId: null,
        assignmentMethod: "automatic",
        assignmentCriteria: "configuration",
        assignedTo: [27, 31],
      })
    );
  });

  it("infers configuration assignment criteria when configurations are provided and criteria is omitted", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 891, title: "Plan D" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlanConfigurations = vi.fn().mockResolvedValue([{ id: 9003 }]);
    const assignTestPlan = vi.fn().mockResolvedValue({ status: true, created_id: 1 });

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      createTestPlanConfigurations,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan D",
      project_id: 16,
      configurations: [[{ field: "OS", value: "Linux" }]],
      assignment: {
        assignment_method: "manual",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(assignTestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentCriteria: "configuration",
        assignmentMethod: "manual",
        assignment: expect.objectContaining({
          testCases: null,
          configuration: [9003],
        }),
      })
    );
  });

  it("retries configuration assignment when initial assign reports missing configurations", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 890, title: "Plan C" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const createTestPlanConfigurations = vi.fn().mockResolvedValue([{ id: 9002 }]);
    const listTestPlanConfigurations = vi.fn().mockResolvedValue([{ id: 9002 }]);
    const assignTestPlan = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'API request failed: 404 Not Found - {"statusCode":404,"error":"Not Found","message":"No configurations found"}'
        )
      )
      .mockResolvedValueOnce({ status: true, created_id: 1 });
    const updateTestPlan = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      createTestPlanConfigurations,
      listTestPlanConfigurations,
      assignTestPlan,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan C",
      project_id: 16,
      priority: 1,
      configurations: [[{ field: "OS", value: "Windows" }]],
      assignment: {
        assignment_criteria: "configuration",
        assignment_method: "automatic",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(assignTestPlan).toHaveBeenCalledTimes(2);
    expect(updateTestPlan).not.toHaveBeenCalled();
  });

  it("returns partial failure if add_test_cases step fails and stops subsequent steps", async () => {
    const createTestPlan = vi.fn().mockResolvedValue({ id: 888, title: "Plan A" });
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 15,
        name: "os",
        label: "OS",
        type: "text",
        extra: { actAsConfig: true },
      },
    ]);
    const bulkAddTestPlanTestCases = vi
      .fn()
      .mockResolvedValue({ status: false, message: "No valid test cases provided" });
    const createTestPlanConfigurations = vi.fn();
    const assignTestPlan = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
      bulkAddTestPlanTestCases,
      createTestPlanConfigurations,
      assignTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Plan A",
      project_id: 16,
      test_cases: {
        test_case_ids: [1001],
      },
      configurations: [[{ field: "OS", value: "Windows" }]],
      assignment: {
        executor: "team",
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
      testPlan: { id: number };
      steps: Record<string, { status: string }>;
    };

    expect(payload.error.code).toBe("ADD_TEST_CASES_FAILED");
    expect(payload.testPlan.id).toBe(888);
    expect(payload.steps.create_test_plan.status).toBe("completed");
    expect(payload.steps.add_test_cases.status).toBe("failed");
    expect(payload.steps.add_configurations.status).toBe("pending");
    expect(payload.steps.assign_test_plan.status).toBe("pending");

    expect(createTestPlan).toHaveBeenCalledTimes(1);
    expect(bulkAddTestPlanTestCases).toHaveBeenCalledTimes(1);
    expect(createTestPlanConfigurations).not.toHaveBeenCalled();
    expect(assignTestPlan).not.toHaveBeenCalled();
  });

  it("returns INVALID_CONFIGURATION_FIELD when configuration field is not actAsConfig", async () => {
    const createTestPlan = vi.fn();
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      { id: 12, name: "build", label: "Build", type: "text" },
      {
        id: 13,
        name: "browser",
        label: "Browser",
        type: "dropdown",
        extra: { actAsConfig: true },
      },
    ]);

    vi.mocked(getApiClient).mockReturnValue({
      createTestPlan,
      getProject,
      listProjectCustomFields,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleCreateTestPlan({
      title: "Config validation",
      project_id: 16,
      configurations: [[{ field: "Build", value: "2.9.0-rc1" }]],
      assignment: {
        assignment_criteria: "testCase",
        assignment_method: "automatic",
        user_ids: [27],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: {
        code: string;
      };
    };

    expect(payload.error.code).toBe("INVALID_CONFIGURATION_FIELD");
    expect(createTestPlan).not.toHaveBeenCalled();
  });
});
