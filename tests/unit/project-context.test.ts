import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/api-client.js", () => ({
  getApiClient: vi.fn(),
}));

type BuildSuiteTree = typeof import("../../src/resources/project-context.js").buildSuiteTree;
type ClearProjectContextCache = typeof import("../../src/resources/project-context.js").clearProjectContextCache;
type HandleProjectContext = typeof import("../../src/resources/project-context.js").handleProjectContext;
type GetApiClient = typeof import("../../src/client/api-client.js").getApiClient;

let buildSuiteTree: BuildSuiteTree;
let clearProjectContextCache: ClearProjectContextCache;
let handleProjectContext: HandleProjectContext;
let getApiClient: GetApiClient;

const loadModules = async () => {
  const projectContext = await import("../../src/resources/project-context.js");
  buildSuiteTree = projectContext.buildSuiteTree;
  clearProjectContextCache = projectContext.clearProjectContextCache;
  handleProjectContext = projectContext.handleProjectContext;

  const apiClient = await import("../../src/client/api-client.js");
  getApiClient = apiClient.getApiClient;
};

describe("project context resource", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.TC_API_TOKEN = "test-token";
    process.env.TC_API_URL = "http://example.local";
    process.env.TC_PROJECT_CONTEXT_CACHE_TTL_MS = "60000";
    await loadModules();
    clearProjectContextCache();
  });

  it("buildSuiteTree nests suites by parent_id/parentId", () => {
    const tree = buildSuiteTree([
      { id: 1, title: "Login", parent_id: null },
      { id: 2, title: "OAuth", parent_id: 1 },
      { id: 3, title: "Settings", parentId: null },
      { id: 4, title: "SSO", parentId: 1 },
    ]);

    expect(tree).toHaveLength(2);

    const login = tree.find((node) => node.id === 1);
    expect(login?.children.map((child) => child.id).sort()).toEqual([2, 4]);
  });

  it("builds and caches project context from API data", async () => {
    const listSuites = vi.fn().mockResolvedValue([
      { id: 1, title: "Login", parent_id: null },
      { id: 2, title: "OAuth", parent_id: 1 },
    ]);
    const listTags = vi
      .fn()
      .mockResolvedValue([{ id: 10, name: "smoke" }]);
    const listRequirements = vi.fn().mockResolvedValue([
      {
        id: 501,
        title: "User can reset password",
        requirement_key: "REQ-12",
        requirement_id: "12",
      },
    ]);
    const listProjectCustomFields = vi.fn().mockResolvedValue([
      {
        id: 100,
        name: "browser",
        label: "Browser",
        type: "dropdown",
        extra: {
          options: [
            { label: "Chrome", systemValue: 1 },
            { label: "Firefox", systemValue: 2 },
          ],
        },
      },
    ]);
    const listTestPlanFolders = vi.fn().mockResolvedValue([
      { id: 42, title: "Mobile", parent_id: null },
    ]);
    const listReleases = vi.fn().mockResolvedValue([
      { id: 7, title: "Release 1.0" },
    ]);
    const listProjectUsers = vi.fn().mockResolvedValue([
      {
        id: 1000,
        user: {
          id: 27,
          name: "Jane Doe",
          email: "jane@example.com",
          username: "jane",
        },
        role: {
          id: 2,
          name: "Tester",
        },
      },
    ]);
    const getProject = vi.fn().mockResolvedValue({ company: { id: 9 } });

    vi.mocked(getApiClient).mockReturnValue({
      listSuites,
      listTags,
      listRequirements,
      listProjectCustomFields,
      listTestPlanFolders,
      listReleases,
      listProjectUsers,
      getProject,
    } as unknown as ReturnType<typeof getApiClient>);

    const response = await handleProjectContext(42);
    const payload = JSON.parse(response.contents[0].text);

    expect(payload.project_id).toBe(42);
    expect(payload.suites).toHaveLength(1);
    expect(payload.suites[0].children).toHaveLength(1);
    expect(payload.tags).toEqual([{ id: 10, name: "smoke" }]);
    expect(payload.requirements[0]).toMatchObject({
      id: 501,
      title: "User can reset password",
      requirement_key: "REQ-12",
      requirement_id: "12",
    });
    expect(payload.custom_fields[0]).toMatchObject({
      id: 100,
      name: "browser",
      label: "Browser",
      field_type: "dropdown",
      options: ["Chrome", "Firefox"],
    });
    expect(payload.test_plan_folders).toEqual([
      {
        id: 42,
        title: "Mobile",
        parent_id: null,
      },
    ]);
    expect(payload.releases).toEqual([{ id: 7, title: "Release 1.0" }]);
    expect(payload.users).toEqual([
      {
        id: 27,
        name: "Jane Doe",
        email: "jane@example.com",
        username: "jane",
        role: "Tester",
      },
    ]);

    await handleProjectContext(42);

    expect(listSuites).toHaveBeenCalledTimes(1);
    expect(listTags).toHaveBeenCalledTimes(1);
    expect(listRequirements).toHaveBeenCalledTimes(1);
    expect(listProjectCustomFields).toHaveBeenCalledTimes(2);
    expect(listTestPlanFolders).toHaveBeenCalledTimes(1);
    expect(listReleases).toHaveBeenCalledTimes(1);
    expect(listProjectUsers).toHaveBeenCalledTimes(1);
  });
});
