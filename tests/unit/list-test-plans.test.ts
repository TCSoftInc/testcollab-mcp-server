import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/api-client.js", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("../../src/resources/project-context.js", () => ({
  getCachedProjectContext: vi.fn(),
}));

type HandleListTestPlans =
  typeof import("../../src/tools/test-plans/list.js").handleListTestPlans;
type GetApiClient = typeof import("../../src/client/api-client.js").getApiClient;
type GetCachedProjectContext =
  typeof import("../../src/resources/project-context.js").getCachedProjectContext;

let handleListTestPlans: HandleListTestPlans;
let getApiClient: GetApiClient;
let getCachedProjectContext: GetCachedProjectContext;

const loadModules = async () => {
  const listTestPlansTool = await import("../../src/tools/test-plans/list.js");
  handleListTestPlans = listTestPlansTool.handleListTestPlans;

  const apiClient = await import("../../src/client/api-client.js");
  getApiClient = apiClient.getApiClient;

  const projectContext = await import("../../src/resources/project-context.js");
  getCachedProjectContext = projectContext.getCachedProjectContext;
};

describe("list_test_plans tool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.TC_API_TOKEN = "test-token";
    process.env.TC_API_URL = "http://example.local";
    process.env.TC_DEFAULT_PROJECT = "16";
    await loadModules();
    vi.mocked(getCachedProjectContext).mockReturnValue(null);
  });

  it("lists test plans with filters, sorting, and pagination", async () => {
    const listTestPlans = vi.fn().mockResolvedValue([
      {
        id: 901,
        archived: false,
        title: "Release 3.0 Regression",
        priority: 2,
        assignedTo: [{ id: 12, name: "Jane QA", username: "jane.qa" }],
        status: 1,
        timeSpent: 0,
        createdBy: { id: 7, name: "QA Lead", username: "lead.qa" },
        startDate: "2026-02-21",
        endDate: "2026-02-28",
        createdAt: "2026-02-20T10:00:00.000Z",
        updatedAt: "2026-02-20T12:00:00.000Z",
        lastRun: "2026-02-22T09:30:00.000Z",
        testPlanFolder: {
          id: 42,
          project: 16,
          title: "Mobile",
          parentId: 0,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      },
      {
        id: 902,
        archived: false,
        title: "Release 3.0 Sanity",
        priority: 1,
        assignedTo: [],
        status: 1,
        timeSpent: 0,
        createdBy: { id: 7, name: "QA Lead", username: "lead.qa" },
        createdAt: "2026-02-20T13:00:00.000Z",
        updatedAt: "2026-02-20T14:00:00.000Z",
      },
    ]);

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlans,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleListTestPlans({
      title_contains: "Release",
      status: "ready",
      priority: "high",
      archived: false,
      created_by: 27,
      start_date_from: "2026-02-20",
      sort_by: "updated_at",
      sort_order: "desc",
      limit: 2,
      offset: 0,
      filter: {
        is_public: 1,
        priority: 0,
      },
    });

    const payload = JSON.parse(response.content[0].text) as {
      testPlans: Array<{ statusLabel: string; priorityLabel: string }>;
      returned: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };

    expect(payload.returned).toBe(2);
    expect(payload.limit).toBe(2);
    expect(payload.offset).toBe(0);
    expect(payload.hasMore).toBe(true);
    expect(payload.testPlans[0].statusLabel).toBe("Ready to Execute");
    expect(payload.testPlans[0].priorityLabel).toBe("High");

    expect(listTestPlans).toHaveBeenCalledWith({
      projectId: 16,
      limit: 2,
      offset: 0,
      sort: "updated_at:desc",
      filter: {
        is_public: 1,
        title_contains: "Release",
        status: 1,
        priority: 2,
        archived: false,
        created_by: 27,
        start_date_gte: "2026-02-20",
      },
    });
  });

  it("resolves folder title filter from cached project context", async () => {
    const cachedContext: NonNullable<ReturnType<GetCachedProjectContext>> = {
      project_id: 16,
      suites: [],
      tags: [],
      custom_fields: [],
      requirements: [],
      test_plan_folders: [{ id: 42, title: "Mobile", parent_id: null }],
      users: [],
    };
    vi.mocked(getCachedProjectContext).mockReturnValue(cachedContext);

    const listTestPlanFolders = vi.fn();
    const listTestPlans = vi.fn().mockResolvedValue([]);

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlanFolders,
      listTestPlans,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleListTestPlans({
      project_id: 16,
      test_plan_folder: "mobile",
      limit: 10,
      offset: 5,
    });

    const payload = JSON.parse(response.content[0].text) as {
      returned: number;
      hasMore: boolean;
    };

    expect(payload.returned).toBe(0);
    expect(payload.hasMore).toBe(false);
    expect(listTestPlanFolders).not.toHaveBeenCalled();
    expect(listTestPlans).toHaveBeenCalledWith({
      projectId: 16,
      limit: 10,
      offset: 5,
      sort: "updated_at:desc",
      filter: {
        test_plan_folder: 42,
      },
    });
  });

  it("resolves folder title filter to folder ID via API fallback", async () => {
    const listTestPlanFolders = vi.fn().mockResolvedValue([
      { id: 42, title: "Mobile" },
    ]);
    const listTestPlans = vi.fn().mockResolvedValue([]);

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlanFolders,
      listTestPlans,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleListTestPlans({
      project_id: 16,
      test_plan_folder: "mobile",
      limit: 10,
      offset: 5,
    });

    const payload = JSON.parse(response.content[0].text) as {
      returned: number;
      hasMore: boolean;
    };

    expect(payload.returned).toBe(0);
    expect(payload.hasMore).toBe(false);
    expect(listTestPlanFolders).toHaveBeenCalledWith(16);
    expect(listTestPlans).toHaveBeenCalledWith({
      projectId: 16,
      limit: 10,
      offset: 5,
      sort: "updated_at:desc",
      filter: {
        test_plan_folder: 42,
      },
    });
  });

  it("returns folder not found error for unknown folder title", async () => {
    const listTestPlanFolders = vi.fn().mockResolvedValue([
      { id: 7, title: "Web" },
    ]);
    const listTestPlans = vi.fn();

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlanFolders,
      listTestPlans,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleListTestPlans({
      project_id: 16,
      test_plan_folder: "Mobile",
    });
    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("TEST_PLAN_FOLDER_NOT_FOUND");
    expect(listTestPlans).not.toHaveBeenCalled();
  });

  it("returns missing project error when project_id cannot be resolved", async () => {
    vi.resetModules();
    process.env.TC_DEFAULT_PROJECT = "";
    await loadModules();

    const response = await handleListTestPlans({});
    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("MISSING_PROJECT_ID");
  });

  it("returns validation error for unsupported status input", async () => {
    const response = await handleListTestPlans({
      status: 9,
    });
    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string };
    };

    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns API error when list call fails", async () => {
    const listTestPlans = vi.fn().mockRejectedValue(new Error("boom"));

    vi.mocked(getApiClient).mockReturnValue({
      listTestPlans,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleListTestPlans({
      project_id: 16,
    });

    const payload = JSON.parse(response.content[0].text) as {
      error: { code: string; message: string };
    };

    expect(payload.error.code).toBe("API_ERROR");
    expect(payload.error.message).toContain("boom");
  });
});
