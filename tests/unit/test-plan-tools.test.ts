// TCV-7109: exercise real handlers, schemas, and API request serialization.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithContext } from "../../src/context.js";
import { handleCreateTestPlan } from "../../src/tools/test-plans/create.js";
import { handleGetTestPlanCases } from "../../src/tools/test-plans/cases.js";
import { handleReportResults, handleReportTestCaseResult } from "../../src/tools/test-plans/report.js";
import { prepareAttachments } from "../../src/tools/test-plans/attachments.js";
import { MAX_BASE64_BYTES, MAX_FILE_BYTES } from "../../src/tools/test-plans/schemas.js";
import type { ApiRecord, ToolResult } from "../../src/tools/test-plans/shared.js";

// The release workflow bumps package.json before it runs the tests, so never assert a fixed version.
const packageVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const context = { apiToken: "secret-fixture-token", apiUrl: "http://localhost:1337", defaultProjectId: 8 };
const plan = { id: 42, project: { id: 8 }, title: "MCP plan", custom_fields: [{ id: 1, name: "keep", value: "old" }] };
const run = { id: 6, project: 8, testplan: 42 };
const cases = [
  { id: 50, test_case: { id: 10, title: "Login", steps_parsed: [{ step: "Sign in", expectedResult: "Home" }] }, status: "passed", results: [{ configId: 9, status: "passed" }, { configId: 11, status: "unexecuted" }] },
  { id: 51, test_case: { id: 12, title: "Logout", steps: [{ step: "Sign out", expected_result: "Login" }] }, status: "unexecuted" },
];
const execution = { id: 90, project: 8, regression: { id: 6 }, test_plan: { id: 42 }, test_plan_test_case: { id: 50, test_case: 10 }, test_plan_config: { id: 9 }, assigned_to: 5011, test_case_revision: { steps: [{ step: "Snapshot step", expectedResult: "Snapshot result" }] } };
const otherExecution = { ...execution, id: 91, test_plan_test_case: { id: 51, test_case: 12 } };
const statuses = [{ id: 1, system_name: "passed", is_active: true }, { id: 2, system_name: "skipped", is_active: true }, { id: 3, system_name: "needs_review", is_active: true }, { id: 4, system_name: "inactive", is_active: false }];
let assigned: ApiRecord[];
let calls: Array<{ method: string; url: URL; body: any }>;
let routeOverride: ((method: string, url: URL, body: any) => Response | undefined) | undefined;

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function unpack(result: ToolResult) { return JSON.parse(result.content[0]!.text); }
function call(handler: (args: unknown) => Promise<ToolResult>, input: unknown) { return runWithContext(context, () => handler(input)); }
function writes() { return calls.filter(call => call.method !== "GET"); }

beforeEach(() => {
  assigned = [{ ...execution }, { ...otherExecution }];
  calls = [];
  routeOverride = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const method = options.method || "GET";
    const body = options.body instanceof FormData ? options.body : options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ method, url, body });
    expect(url.origin).toBe("http://localhost:1337");
    expect(url.searchParams.get("token")).toBe(context.apiToken);
    const overridden = routeOverride?.(method, url, body);
    if (overridden) return overridden;
    if (method === "GET") {
      const paged = (items: any[]) => {
        const start = Number(url.searchParams.get("_start") || 0);
        const limit = Number(url.searchParams.get("_limit") || 100);
        return response(limit < 0 ? items.slice(start) : items.slice(start, start + limit));
      };
      switch (url.pathname) {
        case "/tags": return paged([{ id: 7, name: "Smoke", project: 8 }]);
        case "/projectusers": return paged([{ user: { id: 5011, blocked: false } }]);
        case "/testplans/42": return response(plan);
        case "/testplanregressions": return response([run]);
        case "/testplantestcases": return paged(cases);
        case "/testplanconfigurations": return paged([{ id: 9, parameters: [{ field: "Browser", value: "Chrome" }] }, { id: 11, parameters: [{ field: "Browser", value: "Firefox" }] }]);
        case "/statuses": return paged(statuses);
        case "/users/me": return response({ id: 5011 });
        case "/executedtestcases": return url.searchParams.has("id") ? response([execution]) : paged(assigned);
        case "/projects/8": return response({ id: 8, company: { id: 5004 } });
      }
    }
    if (url.pathname === "/testplans" && method === "POST") return response(plan);
    if (url.pathname === "/testplans/42" && method === "PUT") return response(plan);
    if (url.pathname === "/upload") return response([{ id: 200 }]);
    if (/^\/executedtestcases\/\d+$/.test(url.pathname)) return response({ ...body, id: Number(url.pathname.split("/").pop()) });
    if (url.pathname === "/testplantestcases/bulkAdd" || url.pathname === "/testplans/assign" || /updateTimeTaken|updateAttachments/.test(url.pathname)) return response({ status: true });
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("create_test_plan tag selection", () => {
  it.each([{ tag_id: 7 }, { tag_name: "Smoke" }])("extends the existing creation flow with %j and preserves defaults", async tag => {
    const result = unpack(await call(handleCreateTestPlan, { title: "Tagged plan", test_cases: { ...tag, assignee: 5011 } }));
    expect(result.success).toBe(true);
    expect(writes().map(row => row.url.pathname)).toEqual(["/testplans", "/testplantestcases/bulkAdd", "/testplans/assign"]);
    expect(JSON.parse(writes()[1]!.body.testCaseCollection.selector[0].value).filter).toEqual([[7]]);
    expect(writes()[1]!.body).not.toHaveProperty("assignee");
    expect(writes()[2]!.body).toMatchObject({ override_existing_assignees: false, assignment: { user: [5011] } });
  });
  it("sends an explicit override to bulk add and assignment", async () => {
    const result = unpack(await call(handleCreateTestPlan, { test_cases: { tag_id: 7, assignee: 5011 }, override_assignees: true }));
    expect(result.success).toBe(true);
    expect(writes()[1]!.body.assignee).toBe(5011);
    expect(writes()[2]!.body.override_existing_assignees).toBe(true);
  });
  it.each([{ tag_id: 99 }, { tag_name: "missing" }, { tag_id: 7, tag_name: "Smoke" }, { tag_id: 7, test_case_ids: [10] }])("refuses invalid tag selection before any write: %j", async selection => {
    const result = unpack(await call(handleCreateTestPlan, { test_cases: selection }));
    expect(result.error.code).toBe("INVALID_TAG_SELECTION");
    expect(writes()).toHaveLength(0);
  });
});

describe("get_test_plan_cases", () => {
  it("returns cases, expected results, custom status names, and configuration status", async () => {
    const result = unpack(await call(handleGetTestPlanCases, { test_plan_id: 42 }));
    expect(result.testCases[0].steps).toEqual([{ step: "Sign in", expectedResult: "Home" }]);
    expect(result.testCases[1].steps[0].expectedResult).toBe("Login");
    expect(result.testCases[0].configResults[1]).toEqual({ configId: 11, configLabel: "Browser: Firefox", status: "unexecuted" });
    expect(result.statuses.map((row: any) => row.systemName)).toContain("needs_review");
    expect(result.statuses.map((row: any) => row.systemName)).not.toContain("inactive");
    expect(calls.some(row => row.url.pathname === "/users/me")).toBe(false);
  });
  it("returns the caller's executions and run revision steps", async () => {
    const result = unpack(await call(handleGetTestPlanCases, { test_plan_id: 42, run_id: 6 }));
    expect(result.executions[0]).toMatchObject({ id: 90, testCaseId: 10, testPlanTestCaseId: 50, configId: 9, steps: [{ step: "Snapshot step", expectedResult: "Snapshot result" }] });
    const request = calls.find(row => row.url.pathname === "/executedtestcases")!;
    expect(Object.fromEntries(request.url.searchParams)).toMatchObject({ regression: "6", assigned_to: "5011", test_plan: "42", project: "8" });
  });
  it("paginates past 100 cases without losing cases", async () => {
    routeOverride = (_method, url) => url.pathname === "/testplantestcases" ? response(Number(url.searchParams.get("_start")) === 0 ? Array.from({ length: 100 }, (_, i) => ({ ...cases[0], id: i + 1000 })) : [{ ...cases[1], id: 1100 }]) : undefined;
    const result = unpack(await call(handleGetTestPlanCases, { test_plan_id: 42 }));
    expect(result.testCases).toHaveLength(101);
    expect(calls.filter(row => row.url.pathname === "/testplantestcases").map(row => row.url.searchParams.get("_start"))).toEqual(["0", "100"]);
  });
  it("reads a full status vocabulary once because that endpoint ignores pagination", async () => {
    routeOverride = (_method, url) => {
      if (url.pathname !== "/statuses") return undefined;
      if (calls.filter(row => row.url.pathname === "/statuses").length > 1) throw new Error("Status endpoint was incorrectly paginated");
      return response(Array.from({ length: 100 }, (_, id) => ({ id: id + 1, system_name: `custom_${id}`, is_active: true })));
    };
    const result = await call(handleGetTestPlanCases, { test_plan_id: 42 });
    expect(result.isError).toBeUndefined();
    expect(unpack(result).statuses).toHaveLength(100);
    expect(calls.filter(row => row.url.pathname === "/statuses")).toHaveLength(1);
  });
  it.each(["project", "run"])("refuses a mismatched %s", async mismatch => {
    routeOverride = (_method, url) => mismatch === "project" && url.pathname === "/testplans/42" ? response({ ...plan, project: 9 }) : mismatch === "run" && url.pathname === "/testplanregressions" ? response([{ ...run, testplan: 99 }]) : undefined;
    expect((await call(handleGetTestPlanCases, { test_plan_id: 42, run_id: 6 })).isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
});

describe("report_test_case_result", () => {
  const input = { run_id: 6, executed_test_case_id: 90, status: "needs_review" };
  it("reports custom status, encoded comments, steps and milliseconds with MCP provenance", async () => {
    const result = await call(handleReportTestCaseResult, { ...input, comment: "Review <this>\nline", time_taken: 25, step_results: [{ step: "Check", expected_result: "Pass", status: "needs_review", comment: "a & b" }] });
    expect(result.isError).toBeUndefined();
    expect(writes()[0]!.body).toMatchObject({ status: "needs_review", project: 8, test_plan: 42, test_plan_test_case: 50, test_plan_config: 9, execution_source: "agent", execution_context: { tool: "tc-mcp-server", tool_version: packageVersion }, comment: escape("Review <this>\nline"), step_wise_result: [{ step: "Check", expected_result: "Pass", status: "needs_review", comment: escape("a & b") }] });
    expect(writes()[0]!.body.step_wise_result[0]).not.toHaveProperty("expectedResult");
    expect(writes()[0]!.body).not.toHaveProperty("executed_by");
    expect(writes()[1]!.body).toEqual({ project: 8, time_taken: 25 });
  });
  it("uploads a hosted base64 file against the company, then links it", async () => {
    const result = await call(handleReportTestCaseResult, { ...input, attachments: [{ file_name: "log.txt", content_base64: Buffer.from("log line").toString("base64") }] });
    expect(unpack(result).attachmentsUploaded).toBe(1);
    const upload = writes().find(row => row.url.pathname === "/upload")!;
    expect(upload.body.get("company")).toBe("5004");
    expect(await upload.body.get("files").text()).toBe("log line");
    expect(writes().at(-1)!.body).toEqual({ project: 8, attachments: [200] });
  });
  it("returns the execution as saved after the time and evidence updates", async () => {
    let lookups = 0;
    routeOverride = (method, url) => {
      if (method !== "GET" || url.pathname !== "/executedtestcases" || !url.searchParams.has("id")) return undefined;
      lookups += 1;
      return response([lookups === 1 ? execution : { ...execution, status: "needs_review", time_taken: 25, attachments: [{ id: 200 }] }]);
    };
    const result = unpack(await call(handleReportTestCaseResult, { ...input, time_taken: 25, attachments: [{ file_name: "log.txt", content_base64: Buffer.from("log").toString("base64") }] }));
    expect(lookups).toBe(2);
    expect(result.result).toMatchObject({ time_taken: 25, attachments: [{ id: 200 }] });
  });
  it("does not re-read without time or files", async () => {
    let lookups = 0;
    routeOverride = (method, url) => { if (method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")) lookups += 1; return undefined; };
    await call(handleReportTestCaseResult, input);
    expect(lookups).toBe(1);
  });
  it.each([
    ["fails", () => response({ message: "down" }, 500)],
    ["returns another row", () => response([{ ...execution, id: 999 }])],
  ])("returns the write reply when the re-read %s", async (_label, reread) => {
    let lookups = 0;
    routeOverride = (method, url) => {
      if (method !== "GET" || url.pathname !== "/executedtestcases" || !url.searchParams.has("id")) return undefined;
      lookups += 1;
      return lookups === 1 ? response([execution]) : reread();
    };
    const result = unpack(await call(handleReportTestCaseResult, { ...input, time_taken: 5 }));
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ id: 90, status: "needs_review" });
  });
  it("keeps the saved steps, takes status and comment by position, and gives unsent steps the case status", async () => {
    const saved = [
      { step_index: 0, step: "Sign in", expected_result: "Home", status: "unexecuted", comment: null, attachments: [3] },
      { step_index: 1, step: "Sign out", expected_result: "Login", status: "unexecuted", comment: null, attachments: null },
    ];
    routeOverride = (method, url) => method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")
      ? response([{ ...execution, step_wise_result: saved }]) : undefined;
    const result = await call(handleReportTestCaseResult, { ...input, step_results: [{ status: "passed", comment: "a & b", step: "agent text", expected_result: "agent result" }] });
    expect(result.isError).toBeUndefined();
    expect(writes()[0]!.body.step_wise_result).toEqual([{ ...saved[0], status: "passed", comment: escape("a & b") }, { ...saved[1], status: "needs_review" }]);
  });
  it("lets a new pass replace old failed steps that were not sent", async () => {
    const saved = [0, 1, 2].map(i => ({ step: `Step ${i}`, expected_result: `Result ${i}`, status: "failed", comment: "old" }));
    routeOverride = (method, url) => method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")
      ? response([{ ...execution, step_wise_result: saved }]) : undefined;
    await call(handleReportTestCaseResult, { ...input, status: "passed", step_results: [{ status: "passed" }] });
    expect(writes()[0]!.body.step_wise_result.map((step: ApiRecord) => step.status)).toEqual(["passed", "passed", "passed"]);
    expect(writes()[0]!.body.step_wise_result.map((step: ApiRecord) => step.step)).toEqual(["Step 0", "Step 1", "Step 2"]);
  });
  it("sends no step results for an empty list, so tc-api gives every step the case status", async () => {
    await call(handleReportTestCaseResult, { ...input, step_results: [] });
    expect(writes()[0]!.body).not.toHaveProperty("step_wise_result");
  });
  it.each([
    ["JSON text", (steps: ApiRecord[]) => JSON.stringify(steps)],
    ["JSON encoded twice", (steps: ApiRecord[]) => JSON.stringify(JSON.stringify(steps))],
  ])("reads saved steps stored as %s", async (_label, encode) => {
    routeOverride = (method, url) => method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")
      ? response([{ ...execution, step_wise_result: encode([{ step: "Sign in", expected_result: "Home", status: "unexecuted" }]) }]) : undefined;
    await call(handleReportTestCaseResult, { ...input, step_results: [{ status: "passed" }] });
    expect(writes()[0]!.body.step_wise_result).toEqual([{ step: "Sign in", expected_result: "Home", status: "passed" }]);
  });
  it("treats saved steps stored as the text null as no saved steps", async () => {
    routeOverride = (method, url) => method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")
      ? response([{ ...execution, step_wise_result: "null" }]) : undefined;
    await call(handleReportTestCaseResult, { ...input, step_results: [{ status: "passed", step: "Sign in" }] });
    expect(writes()[0]!.body.step_wise_result).toEqual([{ status: "passed", step: "Sign in" }]);
  });
  it("refuses more step results than saved steps before writes", async () => {
    routeOverride = (method, url) => method === "GET" && url.pathname === "/executedtestcases" && url.searchParams.has("id")
      ? response([{ ...execution, step_wise_result: JSON.stringify([{ step_index: 0, step: "Sign in", status: "unexecuted" }]) }]) : undefined;
    const result = await call(handleReportTestCaseResult, { ...input, step_results: [{ status: "passed" }, { status: "passed" }] });
    expect(unpack(result).error.message).toContain("has 1 steps, but 2 step results");
    expect(writes()).toHaveLength(0);
  });
  it("refuses hosted file paths before file access or API calls", async () => {
    const result = await call(handleReportTestCaseResult, { ...input, attachments: [{ file_path: "/server/private.txt" }] });
    expect(unpack(result).error.message).toContain("only allowed in stdio");
    expect(calls).toHaveLength(0);
  });
  it.each(["inactive", "nonexistent"])("refuses %s status before writes", async status => {
    expect((await call(handleReportTestCaseResult, { ...input, status })).isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("refuses an invalid step status before writes", async () => {
    expect((await call(handleReportTestCaseResult, { ...input, step_results: [{ status: "inactive" }] })).isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("refuses an execution from another run", async () => {
    routeOverride = (_method, url) => url.pathname === "/executedtestcases" ? response([{ ...execution, regression: 7 }]) : undefined;
    expect((await call(handleReportTestCaseResult, input)).isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("refuses an executor input", async () => {
    expect((await call(handleReportTestCaseResult, { ...input, executed_by: 2 })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it("reports evidence failure accurately after the result was saved", async () => {
    routeOverride = (_method, url) => url.pathname === "/upload" ? response({ message: "Upload refused" }, 400) : undefined;
    const result = await call(handleReportTestCaseResult, { ...input, attachments: [{ file_name: "a.txt", content_base64: "YQ==" }] });
    expect(result.isError).toBe(true);
    expect(unpack(result).error.message).toContain("Result saved for execution 90");
  });
  it("redacts API tokens from returned errors", async () => {
    routeOverride = (_method, url) => url.pathname === "/executedtestcases/90" ? response({ status: false, message: `Failed at token=${context.apiToken}` }) : undefined;
    const result = await call(handleReportTestCaseResult, input);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toContain(context.apiToken);
    expect(result.content[0]!.text).toContain("[REDACTED]");
  });
});

describe("report_results", () => {
  it("uses caller assignments, saves custom fields without dropping existing values, and skips omitted executions", async () => {
    const result = await call(handleReportResults, { test_plan_id: 42, results: [{ test_case_id: 10, configuration_id: 9, status: "passed", comment: "ok", time_taken: 20 }], skip_missing: true, custom_fields: [{ id: 2, name: "env", value: "staging" }] });
    expect(result.isError).toBeUndefined();
    expect(unpack(result)).toMatchObject({ runId: 6, skipped: [91], reported: [{ testCaseId: 10, executedTestCaseId: 90, status: "passed" }] });
    expect(writes()[0]!.body).toMatchObject({ title: "MCP plan", custom_fields: [{ id: 1, name: "keep", value: "old" }, { id: 2, name: "env", value: "staging" }] });
    expect(writes().at(-1)!.body).toMatchObject({ id: 91, status: "skipped", execution_context: { tool: "tc-mcp-server" } });
  });
  it("shows the API's reason when the plan custom field update fails, before any result write", async () => {
    routeOverride = (method, url) => method === "PUT" && url.pathname === "/testplans/42"
      ? response({ status: false, title: "Data for required custom field(s) is not provided : env" }) : undefined;
    const result = await call(handleReportResults, { test_plan_id: 42, results: [{ test_case_id: 10, status: "passed" }], custom_fields: [{ id: 2, name: "env", value: "" }] });
    expect(unpack(result).error.message).toContain("required custom field(s) is not provided");
    expect(writes().filter(row => row.url.pathname.startsWith("/executedtestcases"))).toHaveLength(0);
  });
  it("accepts a list of labels for a multi-select plan field", async () => {
    const result = await call(handleReportResults, { test_plan_id: 42, results: [{ test_case_id: 10, status: "passed" }], custom_fields: [{ id: 3, name: "browsers", value: ["chrome", "firefox"], valueLabel: ["Chrome", "Firefox"] }] });
    expect(result.isError).toBeUndefined();
    expect(writes()[0]!.body.custom_fields).toContainEqual({ id: 3, name: "browsers", value: ["chrome", "firefox"], valueLabel: ["Chrome", "Firefox"] });
  });
  it("refuses an ambiguous matrix before any writes", async () => {
    assigned.push({ ...execution, id: 92, test_plan_config: { id: 11 } });
    const result = await call(handleReportResults, { test_plan_id: 42, results: [{ test_case_id: 10, status: "passed" }] });
    expect(result.isError).toBe(true);
    expect(unpack(result).error.message).toContain("2 matching");
    expect(writes()).toHaveLength(0);
  });
  it("reports two configurations of the same case to different execution IDs", async () => {
    assigned.push({ ...execution, id: 92, test_plan_config: { id: 11 } });
    const result = await call(handleReportResults, { test_plan_id: 42, run_id: 6, results: [{ test_case_id: 10, configuration_id: 9, status: "passed" }, { test_case_id: 10, configuration_id: 11, status: "needs_review" }] });
    expect(unpack(result).reported.map((row: any) => row.executedTestCaseId)).toEqual([90, 92]);
    expect(writes().map(row => row.body.test_plan_config)).toEqual([9, 11]);
  });
  it.each([
    [{ test_case_id: 99, status: "passed" }],
    [{ test_case_id: 10, status: "passed" }, { test_case_id: 10, status: "passed" }],
    [{ test_case_id: 10, status: "inactive" }],
  ])("refuses invalid inputs before any writes: %j", async results => {
    expect((await call(handleReportResults, { test_plan_id: 42, results, skip_missing: true })).isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("returns per-execution errors and does not skip omitted cases after a failed result", async () => {
    assigned.push({ ...execution, id: 92, test_plan_test_case: { id: 52, test_case: 13 } });
    routeOverride = (_method, url) => url.pathname === "/executedtestcases/90" ? response({ status: false, message: "Result refused" }) : undefined;
    const result = await call(handleReportResults, { test_plan_id: 42, results: [{ test_case_id: 10, status: "passed" }, { test_case_id: 12, status: "passed" }], skip_missing: true });
    expect(result.isError).toBe(true);
    expect(unpack(result)).toMatchObject({ success: false, reported: [{ executedTestCaseId: 91 }], errors: [{ executedTestCaseId: 90, message: "Result refused" }], skipped: [] });
    expect(writes().some(row => row.url.pathname === "/executedtestcases/92")).toBe(false);
  });
});

describe("attachment limits", () => {
  it("accepts exactly 1 MB decoded and refuses one byte more", async () => {
    expect((await prepareAttachments([{ file_name: "a.txt", content_base64: Buffer.alloc(MAX_BASE64_BYTES).toString("base64") }]))[0]!.content.length).toBe(MAX_BASE64_BYTES);
    await expect(prepareAttachments([{ file_name: "a.txt", content_base64: Buffer.alloc(MAX_BASE64_BYTES + 1).toString("base64") }])).rejects.toThrow("exceeds 1 MB");
  });
  it.each(["not base64!", "YQ=", "YR==", "data:text/plain;base64,YQ=="])("refuses malformed base64 %s", async content => {
    await expect(prepareAttachments([{ file_name: "a.txt", content_base64: content }])).rejects.toThrow("Invalid base64");
  });
  it("limits local files to 10 MB and rejects directories", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tcv7109-"));
    try {
      const file = path.join(directory, "log.txt");
      await writeFile(file, Buffer.alloc(MAX_FILE_BYTES));
      expect((await prepareAttachments([{ file_path: file }]))[0]!.content.length).toBe(MAX_FILE_BYTES);
      await writeFile(file, Buffer.alloc(MAX_FILE_BYTES + 1));
      await expect(prepareAttachments([{ file_path: file }])).rejects.toThrow("exceeds 10 MB");
      await expect(prepareAttachments([{ file_path: directory }])).rejects.toThrow("regular file");
    } finally { await rm(directory, { recursive: true }); }
  });
  it("allows 10 files and refuses 11", async () => {
    const files = Array.from({ length: 10 }, () => ({ file_name: "a.txt", content_base64: "YQ==" }));
    expect(await prepareAttachments(files)).toHaveLength(10);
    await expect(prepareAttachments([...files, files[0]!])).rejects.toThrow("at most 10");
  });
});
