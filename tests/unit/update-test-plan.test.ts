import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/api-client.js", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("../../src/resources/project-context.js", () => ({
  getCachedProjectContext: vi.fn(),
}));

type HandleUpdateTestPlan =
  typeof import("../../src/tools/test-plans/update.js").handleUpdateTestPlan;
type GetApiClient = typeof import("../../src/client/api-client.js").getApiClient;
type GetCachedProjectContext =
  typeof import("../../src/resources/project-context.js").getCachedProjectContext;

let handleUpdateTestPlan: HandleUpdateTestPlan;
let getApiClient: GetApiClient;
let getCachedProjectContext: GetCachedProjectContext;

const loadModules = async () => {
  const updateTestPlanTool = await import("../../src/tools/test-plans/update.js");
  handleUpdateTestPlan = updateTestPlanTool.handleUpdateTestPlan;

  const apiClient = await import("../../src/client/api-client.js");
  getApiClient = apiClient.getApiClient;

  const projectContext = await import("../../src/resources/project-context.js");
  getCachedProjectContext = projectContext.getCachedProjectContext;
};

describe("update_test_plan tool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.TC_API_TOKEN = "test-token";
    process.env.TC_API_URL = "http://example.local";
    process.env.TC_DEFAULT_PROJECT = "16";
    await loadModules();
    vi.mocked(getCachedProjectContext).mockReturnValue(null);
  });

  it("updates a test plan with merged required fields and resolved folder/custom fields", async () => {
    const getTestPlanRaw = vi.fn().mockResolvedValue({
      id: 812,
      title: "Release 2.9 Regression",
      priority: 1,
      status: 0,
      test_plan_folder: { id: 11, title: "General" },
      description: "<p>Old</p>",
    });
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
          options: [{ label: "Chrome", id: "1" }],
        },
      },
    ]);
    const updateTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 812, title: "Release 3.0 Regression" });

    vi.mocked(getApiClient).mockReturnValue({
      getTestPlanRaw,
      listTestPlanFolders,
      getProject,
      listProjectCustomFields,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      title: "Release 3.0 Regression",
      status: "ready",
      test_plan_folder: "mobile",
      custom_fields: [
        { name: "build", value: "3.0.0-rc1" },
        { name: "browser", value: "Chrome" },
      ],
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      updatedFields: string[];
    };

    expect(payload.success).toBe(true);
    expect(payload.updatedFields).toEqual(
      expect.arrayContaining([
        "title",
        "status",
        "test_plan_folder",
        "custom_fields",
      ])
    );
    expect(updateTestPlan).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        projectId: 16,
        title: "Release 3.0 Regression",
        priority: 1,
        status: 1,
        testPlanFolderId: 42,
      })
    );

    const updateArg = updateTestPlan.mock.calls[0][1] as {
      customFields?: Array<{ id: number; name: string; value: unknown }>;
    };
    expect(updateArg.customFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 12, name: "build", value: "3.0.0-rc1" }),
        expect.objectContaining({ id: 13, name: "browser", value: "1" }),
      ])
    );
  });

  it("returns INVALID_INPUT when no updatable fields are provided", async () => {
    const response = await handleUpdateTestPlan({
      id: 812,
      project_id: 16,
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns MISSING_PROJECT_ID when project cannot be resolved", async () => {
    vi.resetModules();
    process.env.TC_DEFAULT_PROJECT = "";
    await loadModules();

    const response = await handleUpdateTestPlan({
      id: 812,
      title: "Release 3.0 Regression",
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("MISSING_PROJECT_ID");
  });

  it("returns folder not found when folder title does not exist", async () => {
    const getTestPlanRaw = vi.fn().mockResolvedValue({
      id: 812,
      title: "Release 2.9 Regression",
      priority: 1,
      status: 0,
      test_plan_folder: { id: 11, title: "General" },
    });
    const listTestPlanFolders = vi.fn().mockResolvedValue([
      { id: 2, title: "Web" },
    ]);
    const updateTestPlan = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      getTestPlanRaw,
      listTestPlanFolders,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      test_plan_folder: "Mobile",
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("TEST_PLAN_FOLDER_NOT_FOUND");
    expect(updateTestPlan).not.toHaveBeenCalled();
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

    const getTestPlanRaw = vi.fn().mockResolvedValue({
      id: 812,
      title: "Release 2.9 Regression",
      priority: 1,
      status: 0,
      test_plan_folder: { id: 11, title: "General" },
    });
    const listTestPlanFolders = vi.fn();
    const updateTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 812, title: "Release 2.9 Regression" });

    vi.mocked(getApiClient).mockReturnValue({
      getTestPlanRaw,
      listTestPlanFolders,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      test_plan_folder: "mobile",
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(listTestPlanFolders).not.toHaveBeenCalled();
    expect(updateTestPlan).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        projectId: 16,
        testPlanFolderId: 42,
      })
    );
  });

  it('updates assignment via assignee="me" without metadata changes', async () => {
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const updateTestPlan = vi.fn();
    const getTestPlanRaw = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      assignTestPlan,
      updateTestPlan,
      getTestPlanRaw,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      assignee: "me",
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      updatedFields: string[];
      message: string;
    };

    expect(payload.success).toBe(true);
    expect(payload.message).toContain("assignment");
    expect(payload.updatedFields).toContain("assignee");
    expect(updateTestPlan).not.toHaveBeenCalled();
    expect(getTestPlanRaw).not.toHaveBeenCalled();
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 812,
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

  it("sends null testCases for configuration assignment updates", async () => {
    const assignTestPlan = vi
      .fn()
      .mockResolvedValue({ status: true, created_id: 1 });
    const updateTestPlan = vi.fn();
    const getTestPlanRaw = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      assignTestPlan,
      updateTestPlan,
      getTestPlanRaw,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      assignment: {
        assignment_criteria: "configuration",
        assignment_method: "manual",
        user_ids: [27],
        configuration_ids: [9001],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
    };

    expect(payload.success).toBe(true);
    expect(assignTestPlan).toHaveBeenCalledWith({
      projectId: 16,
      testplan: 812,
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

  it("falls back to direct test plan assignee update when assign endpoint has no testcases", async () => {
    const assignTestPlan = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'API request failed: 404 Not Found - {"statusCode":404,"error":"Not Found","message":"No testcases found"}'
        )
      );
    const getTestPlanRaw = vi.fn().mockResolvedValue({
      id: 812,
      title: "Release 2.9 Regression",
      priority: 1,
      status: 0,
      test_plan_folder: null,
    });
    const updateTestPlan = vi
      .fn()
      .mockResolvedValue({ id: 812, title: "Release 2.9 Regression" });

    vi.mocked(getApiClient).mockReturnValue({
      assignTestPlan,
      getTestPlanRaw,
      updateTestPlan,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleUpdateTestPlan({
      id: 812,
      assignee: 5004,
    });

    const payload = JSON.parse(response.content[0].text) as {
      success: boolean;
      results?: {
        assign_test_plan?: {
          fallback_assignment?: boolean;
          assigned_to?: number[];
        };
      };
    };

    expect(payload.success).toBe(true);
    expect(payload.results?.assign_test_plan?.fallback_assignment).toBe(true);
    expect(payload.results?.assign_test_plan?.assigned_to).toEqual([5004]);
    expect(getTestPlanRaw).toHaveBeenCalledWith(812);
    expect(updateTestPlan).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        projectId: 16,
        title: "Release 2.9 Regression",
        priority: 1,
        status: 0,
        testPlanFolderId: null,
        assignmentMethod: "automatic",
        assignmentCriteria: "testCase",
        assignedTo: [5004],
      })
    );
  });

  it('returns INVALID_INPUT when both assignee and assignment are provided', async () => {
    const response = await handleUpdateTestPlan({
      id: 812,
      assignee: "me",
      assignment: {
        user_ids: [12],
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("INVALID_INPUT");
  });
});
