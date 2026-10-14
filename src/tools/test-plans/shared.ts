// TCV-7109: project and run scope are checked before any execution write.
import { z } from "zod";
import { getApiClient, type TestCollabApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";

export interface ApiRecord { [key: string]: any }
export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export const PAGE_SIZE = 100;

export function relationId(value: unknown): number | null {
  const id = value && typeof value === "object" && "id" in value ? value.id : value;
  return id == null ? null : Number(id);
}

export function toolResult(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

export async function handleTool<S extends z.AnyZodObject>(
  schema: S, args: unknown,
  action: (input: z.infer<S>, client: TestCollabApiClient, projectId: number) => Promise<unknown>,
): Promise<ToolResult> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) return toolResult({ error: { code: "VALIDATION_ERROR", details: parsed.error.errors } }, true);
  try {
    const context = getRequestContext();
    const projectId = parsed.data.project_id ?? context?.defaultProjectId ?? (context ? undefined : getConfig().defaultProjectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new Error("project_id is required or a valid default project must be set");
    return toolResult(await action(parsed.data, getApiClient(), projectId));
  } catch (error) {
    return toolResult({ error: { code: "API_ERROR", message: error instanceof Error ? error.message : String(error) } }, true);
  }
}

export async function listAll(client: TestCollabApiClient, path: string, params: Record<string, string | number>): Promise<ApiRecord[]> {
  const rows: ApiRecord[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const query = new URLSearchParams(Object.entries({ ...params, _limit: PAGE_SIZE, _start: start, _sort: "id:ASC" }).map(([key, value]): [string, string] => [key, String(value)]));
    const batch = await client.request<ApiRecord[]>("GET", `${path}?${query}`);
    if (!Array.isArray(batch)) throw new Error(`Invalid list response from ${path}`);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

export async function getPlan(client: TestCollabApiClient, projectId: number, planId: number): Promise<ApiRecord> {
  const plan = await client.request<ApiRecord>("GET", `/testplans/${planId}?project=${projectId}`);
  if (Number(plan.id) !== planId || relationId(plan.project) !== projectId) throw new Error("Test plan does not belong to the requested project");
  return plan;
}

export async function getRun(client: TestCollabApiClient, projectId: number, planId: number, runId?: number): Promise<ApiRecord> {
  const query = new URLSearchParams({ project: String(projectId), testplan: String(planId), _limit: "1", _sort: "id:DESC" });
  if (runId) query.set("id", String(runId));
  const rows = await client.request<ApiRecord[]>("GET", `/testplanregressions?${query}`);
  const run = rows[0];
  if (!run || (runId && Number(run.id) !== runId) || relationId(run.testplan) !== planId || relationId(run.project) !== projectId) {
    throw new Error("Test plan run was not found in the requested project and plan");
  }
  return run;
}

export async function getAssignedExecutions(client: TestCollabApiClient, projectId: number, planId: number, runId: number): Promise<ApiRecord[]> {
  const user = await client.request<ApiRecord>("GET", "/users/me");
  if (!user.id) throw new Error("The token owner could not be resolved");
  return listAll(client, "/executedtestcases", { project: projectId, test_plan: planId, regression: runId, assigned_to: user.id });
}

export async function getStatuses(client: TestCollabApiClient, projectId: number): Promise<ApiRecord[]> {
  // The status controller returns its vocabulary in one response and ignores
  // pagination parameters; paginating it would repeat the same page forever.
  const statuses = await client.request<ApiRecord[]>("GET", `/statuses?project=${projectId}`);
  if (!Array.isArray(statuses)) throw new Error("Invalid status vocabulary response");
  return statuses.filter(status => status.is_active !== false && status.is_active !== 0);
}

export function validateStatus(status: string, statuses: ApiRecord[]): void {
  if (!statuses.some(row => row.system_name === status)) throw new Error(`Invalid or inactive status "${status}" for this project`);
}

export function encodeComment(comment: string): string {
  // The execution API stores URI-escaped comments, as tc reportCase does.
  return escape(comment.trim());
}
