// TCV-7109: real MCP clients exercise transport context and multipart uploads.
import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiRecord } from "../../src/tools/test-plans/shared.js";

let api: Server;
let apiUrl: string;
let client: Client | undefined;
let processHandle: ChildProcess | undefined;
let tempDir: string;
let writes: Array<{ path: string; body: string; contentType: string }>;
// TCV-7123: retain execution writes so the transport can confirm saved step evidence.
let execution: ApiRecord;

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "localhost", resolve));
  return (server.address() as { port: number }).port;
}

beforeEach(async () => {
  writes = [];
  let nextFileId = 200;
  const dataset = { id: 7, name: "Users", parameters: [{ key: "user", field: "Username" }], datarows: [{ user: "alice" }, { user: "bob" }] };
  execution = { id: 90, project: 8, regression: 6, test_plan: 42, test_plan_test_case: { id: 50, test_case: 10 }, assigned_to: 5011,
    testdataset: [dataset], testdataset_wise_result: [0, 1].map(dataset_row_index => ({ dataset_id: 7, dataset_row_index, step_index: 0, status: "unexecuted", step: "Sign in" })),
    step_wise_result: [
      { step_index: 0, step: "Sign in", expected_result: "Home", status: "unexecuted", attachments: [3] },
      { step_index: 1, step: "Sign out", expected_result: "Login", status: "unexecuted", attachments: null },
    ],
  };
  tempDir = await mkdtemp(path.join(os.tmpdir(), "tcv7109-mcp-"));
  api = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    expect(url.searchParams.get("token")).toBe("transport-fixture-token");
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") {
      const data: Record<string, unknown> = {
        "/executedtestcases": [execution],
        "/testplans/42": { id: 42, project: 8, title: "Protocol plan" },
        "/testplanregressions": [{ id: 6, project: 8, testplan: 42 }],
        "/statuses": [{ id: 1, system_name: "passed", is_active: true }],
        "/projects/8": { id: 8, company: { id: 5004 } },
        "/users/me": { id: 5011 },
        "/testplantestcases": [{ id: 50, test_case: { id: 10, title: "Sign in" } }],
        "/testplanconfigurations": [],
        "/testdatasets/getLatest": [dataset],
      };
      if (!(url.pathname in data)) { res.statusCode = 404; res.end("{}"); return; }
      res.end(JSON.stringify(data[url.pathname]));
    } else {
      writes.push({ path: url.pathname, body, contentType: String(req.headers["content-type"]) });
      if (url.pathname === "/upload") { res.end(JSON.stringify([{ id: nextFileId++ }])); return; }
      if (url.pathname === "/executedtestcases/90") Object.assign(execution, JSON.parse(body));
      if (url.pathname.endsWith("/updateAttachments")) execution.attachments = [...(execution.attachments || []), ...JSON.parse(body).attachments.map((id: number) => ({ id }))];
      res.end(JSON.stringify(url.pathname === "/executedtestcases/90" ? execution : { status: true }));
    }
  });
  apiUrl = `http://localhost:${await listen(api)}`;
});

afterEach(async () => {
  if (client) { await client.close(); client = undefined; }
  if (processHandle) {
    const child = processHandle;
    processHandle = undefined;
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      await stopped;
      clearTimeout(killTimer);
    }
  }
  await new Promise<void>(resolve => api.close(() => resolve()));
  await rm(tempDir, { recursive: true });
});

const tools = ["create_test_plan", "get_test_plan_cases", "report_test_case_result", "report_results"];
const resultInput = { run_id: 6, executed_test_case_id: 90, status: "passed" };

it("stdio discovers execution tools and attaches a local file through multipart upload", async () => {
  client = new Client({ name: "tcv7109-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "src/index.ts"],
    env: { ...process.env as Record<string, string>, TC_API_TOKEN: "transport-fixture-token", TC_API_URL: apiUrl, TC_DEFAULT_PROJECT: "8" },
    stderr: "pipe",
  });
  await client.connect(transport);
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining([...tools, "get_test_plan", "create_suite"]));
  expect((await client.listResources()).resources[0]?.uri).toBe("testcollab://project/8/context");
  const file = path.join(tempDir, "local.log");
  await writeFile(file, "local execution evidence");
  const result = await client.callTool({ name: "report_test_case_result", arguments: { ...resultInput, attachments: [{ file_path: file }] } });
  expect(result.isError).not.toBe(true);
  const upload = writes.find(write => write.path === "/upload")!;
  expect(upload.contentType).toContain("multipart/form-data; boundary=");
  expect(upload.body).toContain("local execution evidence");
  expect(upload.body).toContain("5004");
  expect(JSON.parse(writes[0]!.body).execution_context.tool).toBe("tc-mcp-server");
}, 10000);

// TCV-7123: use a real stdio client and multipart upload for both nested file formats.
it("stdio discovers step attachments and saves local and base64 files under the right steps", async () => {
  client = new Client({ name: "tcv7123-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "src/index.ts"],
    env: { ...process.env as Record<string, string>, TC_API_TOKEN: "transport-fixture-token", TC_API_URL: apiUrl, TC_DEFAULT_PROJECT: "8" },
    stderr: "pipe",
  });
  await client.connect(transport);
  const tool = (await client.listTools()).tools.find(tool => tool.name === "report_test_case_result")!;
  const properties = tool.inputSchema.properties as ApiRecord;
  const stepAttachments = properties.step_results.items.properties.attachments;
  expect(stepAttachments.maxItems).toBe(10);
  expect(stepAttachments.items.anyOf.map((format: ApiRecord) => format.required)).toEqual([["file_path"], ["file_name", "content_base64"]]);
  const file = path.join(tempDir, "step.log");
  await writeFile(file, "local step evidence");
  const result = await client.callTool({ name: "report_test_case_result", arguments: { ...resultInput,
    step_results: [
      { status: "passed", attachments: [{ file_path: file }] },
      { status: "passed", attachments: [{ file_name: "step-2.log", content_base64: Buffer.from("base64 step evidence").toString("base64") }] },
    ],
    attachments: [{ file_name: "run.log", content_base64: "T2sK" }],
  } });
  expect(result.isError).not.toBe(true);
  const saved = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  expect(saved.attachmentsUploaded).toBe(3);
  expect(saved.result.step_wise_result).toEqual([
    { step_index: 0, step: "Sign in", expected_result: "Home", status: "passed", attachments: [3, 200] },
    { step_index: 1, step: "Sign out", expected_result: "Login", status: "passed", attachments: [201] },
  ]);
  expect(saved.result.attachments).toEqual([{ id: 200 }, { id: 201 }, { id: 202 }]);
  expect(writes.map(write => write.path)).toEqual(["/upload", "/upload", "/executedtestcases/90/updateAttachments", "/executedtestcases/90", "/upload", "/executedtestcases/90/updateAttachments"]);
  const uploads = writes.filter(write => write.path === "/upload");
  expect(uploads[0]!.body).toContain("local step evidence");
  expect(uploads[1]!.body).toContain("base64 step evidence");
}, 10000);

// TCV-7124: discovery and row files also travel through the real stdio protocol.
it("stdio reads datasets and reports a row/step file without replacing another row", async () => {
  client = new Client({ name: "tcv7124-test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "src/index.ts"],
    env: { ...process.env as Record<string, string>, TC_API_TOKEN: "transport-fixture-token", TC_API_URL: apiUrl, TC_DEFAULT_PROJECT: "8" },
    stderr: "pipe",
  }));
  const discovered = (await client.listTools()).tools;
  expect(discovered.find(tool => tool.name === "report_test_case_result")!.inputSchema.properties).toHaveProperty("dataset_results");
  const casesResult = await client.callTool({ name: "get_test_plan_cases", arguments: { test_plan_id: 42, run_id: 6 } });
  expect(casesResult.isError).not.toBe(true);
  const data = JSON.parse((casesResult.content as any)[0].text);
  expect(data.executions[0].datasets[0].rows[1]).toEqual({ index: 1, values: { user: "bob" } });
  const file = path.join(tempDir, "row-proof.log");
  await writeFile(file, "bob row evidence");
  const result = await client.callTool({ name: "report_test_case_result", arguments: { ...resultInput,
    dataset_results: [{ dataset_id: 7, dataset_row_index: 1, step_index: 0, status: "passed", comment: "bob passed", attachments: [{ file_path: file }] }],
  } });
  expect(result.isError).not.toBe(true);
  expect(writes.find(write => write.path === "/upload")!.body).toContain("bob row evidence");
  const rows = JSON.parse(writes.find(write => write.path === "/executedtestcases/90")!.body).testdataset_wise_result;
  expect(rows[0]).toMatchObject({ dataset_row_index: 0, status: "unexecuted" });
  expect(rows[0]).not.toHaveProperty("attachments");
  expect(rows[1]).toMatchObject({ dataset_row_index: 1, status: "passed", comment: escape("bob passed"), attachments: [200] });
}, 10000);

// TCV-7109: the HTTP transport is disabled; its server is archived in archive/http-server.ts.
it.skip("HTTP requires token headers, retains resources, refuses file_path, and accepts base64", async () => {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const endpoint = `http://localhost:${port}`;
  processHandle = spawn(process.execPath, ["--import", "tsx", "src/http-server.ts"], {
    env: { ...process.env, MCP_PORT: String(port), TC_API_TOKEN: "transport-fixture-token", TC_API_URL: apiUrl, TC_DEFAULT_PROJECT: "8" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 5000;
  while (true) {
    try { if ((await fetch(`${endpoint}/health`)).ok) break; } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error("HTTP MCP server did not start");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  client = new Client({ name: "tcv7109-test", version: "1" });
  expect((await fetch(`${endpoint}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { "X-TC-API-Token": "transport-fixture-token" } } });
  await client.connect(transport);
  expect((await client.listResources()).resources[0]?.uri).toBe("testcollab://project/8/context");
  const discovered = (await client.listTools()).tools;
  expect(discovered.map(tool => tool.name)).toEqual(expect.arrayContaining(tools));
  expect(discovered.find(tool => tool.name === "report_test_case_result")!.inputSchema.properties).not.toHaveProperty("executed_by");
  expect((await fetch(`${endpoint}/mcp`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-TC-API-Token": "different-token", "mcp-session-id": transport.sessionId! },
    body: JSON.stringify({ jsonrpc: "2.0", id: 100, method: "tools/list" }),
  })).status).toBe(403);
  expect((await fetch(`${endpoint}/mcp`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-TC-API-Token": "transport-fixture-token" },
    body: " ".repeat(16 * 1024 * 1024),
  })).status).toBe(413);
  const rejected = await client.callTool({ name: "report_test_case_result", arguments: { ...resultInput, attachments: [{ file_path: "/server/private.txt" }] } });
  expect(rejected.isError).toBe(true);
  expect(JSON.stringify(rejected.content)).toContain("only allowed in stdio mode");
  expect(writes).toHaveLength(0);
  const accepted = await client.callTool({ name: "report_test_case_result", arguments: { ...resultInput, attachments: [{ file_name: "remote.log", content_base64: Buffer.from("hosted execution evidence").toString("base64") }] } });
  expect(accepted.isError).not.toBe(true);
  expect(writes.find(write => write.path === "/upload")!.body).toContain("hosted execution evidence");
}, 10000);
