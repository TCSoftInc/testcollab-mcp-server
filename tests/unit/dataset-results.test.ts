// TCV-7124: row-specific reads and writes must preserve every other row and its evidence.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runWithContext } from "../../src/context.js";
import { handleGetTestPlanCases } from "../../src/tools/test-plans/cases.js";
import { handleReportTestCaseResult } from "../../src/tools/test-plans/report.js";

const context = { apiToken: "dataset-fixture-token", apiUrl: "http://localhost:1337", defaultProjectId: 8 };
const dataset = { id: 7, name: "Accounts", parameters: [{ key: "user", field: "Username" }], datarows: [{ user: "alice" }, { user: "bob" }] };
const saved = [0, 1].flatMap(row => [0, 1].map(step => ({
  dataset_id: 7, dataset_row_index: row, step_index: step,
  step: `Saved step ${step}`, expected_result: "Saved result", status: "unexecuted",
  comment: "previous", comment_by: 5011, mentions: [5012], attachments: [30 + row * 2 + step],
})));
let execution: any;
let calls: Array<{ method: string; url: URL; body: any }>;
let failPath: string | undefined;
const input = { run_id: 6, executed_test_case_id: 90, status: "failed" };
const entry = { dataset_id: 7, dataset_row_index: 0, step_index: 0, status: "passed" };
const file = { file_name: "proof.txt", content_base64: "YQ==" };
const invoke = (handler: any, args: any) => runWithContext(context, () => handler(args)) as Promise<any>;
const unpack = (result: any) => JSON.parse(result.content[0].text);
const writes = () => calls.filter(call => call.method !== "GET");
const resultWrite = () => writes().find(call => call.url.pathname === "/executedtestcases/90")!.body;

beforeEach(() => {
  execution = { id: 90, project: 8, regression: 6, test_plan: 42,
    test_plan_test_case: { id: 50, test_case: 10 }, assigned_to: 5011,
    testdataset: JSON.stringify([dataset]), testdataset_wise_result: JSON.stringify(saved),
    test_case_revision: { steps: [{ step: "Snapshot" }] },
  };
  calls = [];
  failPath = undefined;
  let uploadId = 200;
  vi.stubGlobal("fetch", vi.fn(async (address: string, options: RequestInit) => {
    const url = new URL(address);
    const method = options.method || "GET";
    const body = options.body instanceof FormData ? options.body : options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ method, url, body });
    expect(url.origin).toBe(context.apiUrl);
    const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === failPath) return reply({ message: "refused" }, 400);
    if (method === "GET") {
      const data: Record<string, any> = {
        "/testplans/42": { id: 42, project: 8 },
        "/testplanregressions": [{ id: 6, project: 8, testplan: 42 }],
        "/testplantestcases": [{ id: 50, test_case: { id: 10, title: "Accounts" } }],
        "/testplanconfigurations": [], "/users/me": { id: 5011 },
        "/executedtestcases": [execution],
        "/testdatasets/getLatest": [{ ...dataset, datarows: [{ user: "new library row" }] }],
        "/statuses": ["passed", "failed", "unexecuted", "needs_review"].map(system_name => ({ system_name, is_active: true })),
        "/projects/8": { id: 8, company: { id: 5004 } },
      };
      if (url.pathname in data) return reply(data[url.pathname]);
    }
    if (url.pathname === "/upload") return reply([{ id: uploadId++ }]);
    if (method === "PUT") {
      if (url.pathname === "/executedtestcases/90") { execution = { ...execution, ...body }; return reply(execution); }
      return reply({ status: true });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("exposes live datasets on cases and saved datasets/row coordinates on each execution", async () => {
  const result = unpack(await invoke(handleGetTestPlanCases, { test_plan_id: 42, run_id: 6 }));
  expect(result.testCases[0].datasets[0].rows).toEqual([{ index: 0, values: { user: "new library row" } }]);
  expect(result.executions[0].datasets[0]).toMatchObject({ id: 7, parameters: dataset.parameters, rows: [{ index: 0, values: { user: "alice" } }, { index: 1, values: { user: "bob" } }] });
  expect(result.executions[0].datasetResults).toEqual(saved);
  expect(result.testCases[0].executions[0].datasets).toEqual(result.executions[0].datasets);
  const lookup = calls.find(call => call.url.pathname === "/testdatasets/getLatest")!;
  expect(Object.fromEntries(lookup.url.searchParams)).toMatchObject({ project: "8", testcase: "10" });
});

it("exposes datasets without requiring a run", async () => {
  const result = unpack(await invoke(handleGetTestPlanCases, { test_plan_id: 42 }));
  expect(result.testCases[0].datasets[0].id).toBe(7);
  expect(calls.some(call => call.url.pathname === "/executedtestcases")).toBe(false);
});

it("merges different row/step statuses and comments while preserving all unreported data", async () => {
  const result = await invoke(handleReportTestCaseResult, { ...input, dataset_results: [
    { ...entry, comment: "a & b" }, { ...entry, dataset_row_index: 1, step_index: 1, status: "needs_review" },
  ] });
  expect(result.isError).not.toBe(true);
  const rows = resultWrite().testdataset_wise_result;
  expect(rows).toEqual([{ ...saved[0], status: "passed", comment: escape("a & b") }, saved[1], saved[2], { ...saved[3], status: "needs_review" }]);
  expect(resultWrite()).toMatchObject({ status: "failed", execution_source: "agent" });
});

it("keeps datasets separate when their row and step indexes are equal", async () => {
  execution.testdataset_wise_result = [...saved, { ...saved[0], dataset_id: 8 }];
  await invoke(handleReportTestCaseResult, { ...input, dataset_results: [{ ...entry, dataset_id: 8 }] });
  expect(resultWrite().testdataset_wise_result.slice(0, 4)).toEqual(saved);
  expect(resultWrite().testdataset_wise_result[4]).toMatchObject({ dataset_id: 8, status: "passed" });
});

it("uploads row files, company-checks the IDs, and appends them only to their row and step", async () => {
  const result = unpack(await invoke(handleReportTestCaseResult, { ...input, attachments: [file], dataset_results: [
    { ...entry, attachments: [file] }, { ...entry, dataset_row_index: 1, step_index: 1, attachments: [file] },
  ] }));
  expect(result.attachmentsUploaded).toBe(3);
  const changes = writes();
  expect(changes.map(call => call.url.pathname)).toEqual(["/upload", "/upload", "/upload", "/executedtestcases/90/updateAttachments", "/executedtestcases/90"]);
  expect(changes[0]!.body.get("company")).toBe("5004");
  expect(changes[3]!.body).toEqual({ project: 8, attachments: [200, 201, 202] });
  expect(resultWrite().testdataset_wise_result.map((row: any) => row.attachments)).toEqual([[30, 201], [31], [32], [33, 202]]);
  expect(result.result.testdataset_wise_result[0].attachments).toEqual([30, 201]);
});

it.each(["/upload", "/executedtestcases/90/updateAttachments"])("does not save row results when %s fails", async path => {
  failPath = path;
  const result = await invoke(handleReportTestCaseResult, { ...input, dataset_results: [{ ...entry, attachments: [file] }] });
  expect(result.isError).toBe(true);
  expect(unpack(result).error.message).toContain("before result update");
  expect(writes().some(call => call.url.pathname === "/executedtestcases/90")).toBe(false);
});

it.each([
  [{ ...entry, dataset_id: 99 }], [{ ...entry, dataset_row_index: 2 }], [{ ...entry, step_index: 2 }],
  [{ ...entry, status: "inactive" }], [entry, entry], [{ ...entry, dataset_row_index: -1 }],
  [{ ...entry, step_index: 0.5 }], [{ ...entry, dataset_id: 0 }],
])("rejects invalid or duplicate row results before uploads or writes: %j", async dataset_results => {
  expect((await invoke(handleReportTestCaseResult, { ...input, attachments: [file], dataset_results })).isError).toBe(true);
  expect(writes()).toHaveLength(0);
});

it("rejects row input on a non-dataset execution", async () => {
  execution.testdataset_wise_result = null;
  expect((await invoke(handleReportTestCaseResult, { ...input, dataset_results: [entry] })).isError).toBe(true);
  expect(writes()).toHaveLength(0);
});

it("treats an empty row list as a case-level result", async () => {
  await invoke(handleReportTestCaseResult, { ...input, dataset_results: [] });
  expect(resultWrite()).not.toHaveProperty("testdataset_wise_result");
});

it("enforces the ten-file cap across result-level and row-level files before API access", async () => {
  const result = await invoke(handleReportTestCaseResult, { ...input, attachments: Array(10).fill(file), dataset_results: [{ ...entry, attachments: [file] }] });
  expect(result.isError).toBe(true);
  expect(calls).toHaveLength(0);
});

it("rejects hosted row file paths before API or filesystem access", async () => {
  const result = await invoke(handleReportTestCaseResult, { ...input, dataset_results: [{ ...entry, attachments: [{ file_path: "/server/private.txt" }] }] });
  expect(unpack(result).error.message).toContain("only allowed in stdio");
  expect(calls).toHaveLength(0);
});
