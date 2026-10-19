// TCV-7109: result writes reuse the execution API; the token determines executor.
import type { TestCollabApiClient } from "../../client/api-client.js";
import { SERVER_VERSION } from "../../config.js";
import { prepareAttachments, type PreparedAttachment } from "./attachments.js";
import { addDatasetAttachments, mergeDatasetResults } from "./datasets.js";
import { reportResultsSchema, reportTestCaseResultSchema } from "./schemas.js";
import { encodeComment, getAssignedExecutions, getPlan, getRun, getStatuses, handleTool, relationId, validateStatus, type ApiRecord } from "./shared.js";

// TCV-7109: an MCP tool is always called by an AI assistant, so results record the API's
// `agent` source ("Agent" in Run Mode). The API counts `agent` as machine-executed.
const EXECUTION_SOURCE = "agent";

interface ResultInput { status: string; comment?: string; time_taken?: number; step_results?: Array<{ status: string; step?: string; expected_result?: string; comment?: string }> }

// TCV-7109: tc-api rows can hold the step list as JSON text, as JSON encoded twice, or as "null".
function savedSteps(raw: unknown): ApiRecord[] {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

// TCV-7109: the Run screen draws its step list from the saved step results. Keep each saved
// step (text, expected result, index, files) and take the status and the comment from the
// input, matched by position. A step with no input takes the case status, as tc-api and
// tc report do, so an old step status cannot block the new case status. An execution with
// no saved steps stores the input in the API's own format (`expected_result`).
function mergeStepResults(execution: ApiRecord, caseStatus: string, results: NonNullable<ResultInput["step_results"]>): ApiRecord[] {
  const saved = savedSteps(execution.step_wise_result);
  if (!saved.length) return results.map(step => ({
    status: step.status,
    ...(step.step === undefined ? {} : { step: step.step }),
    ...(step.expected_result === undefined ? {} : { expected_result: step.expected_result }),
    ...(step.comment === undefined ? {} : { comment: encodeComment(step.comment) }),
  }));
  if (results.length > saved.length) throw new Error(`Execution ${execution.id} has ${saved.length} steps, but ${results.length} step results were sent`);
  return saved.map((step, index) => {
    const result = results[index];
    if (!result) return { ...step, status: caseStatus };
    return { ...step, status: result.status, ...(result.comment === undefined ? {} : { comment: encodeComment(result.comment) }) };
  });
}

// Accept merged steps and dataset rows containing company-checked uploaded IDs.
async function writeResult(client: TestCollabApiClient, projectId: number, execution: ApiRecord, input: ResultInput, stepResults?: ApiRecord[], datasetResults?: ApiRecord[]) {
  const payload: ApiRecord = {
    id: execution.id, project: projectId, test_plan: relationId(execution.test_plan),
    test_plan_test_case: relationId(execution.test_plan_test_case), status: input.status,
    execution_source: EXECUTION_SOURCE, execution_context: { tool: "tc-mcp-server", tool_version: SERVER_VERSION },
  };
  const configId = relationId(execution.test_plan_config);
  if (configId) payload.test_plan_config = configId;
  if (input.comment !== undefined) payload.comment = encodeComment(input.comment);
  // TCV-7109: an empty list means no step results; tc-api then gives every step the case status.
  if (input.step_results?.length) payload.step_wise_result = stepResults ?? mergeStepResults(execution, input.status, input.step_results);
  // TCV-7124: supplying saved row entries prevents tc-api from rebuilding all rows with the case status.
  if (datasetResults) payload.testdataset_wise_result = datasetResults;
  const updated = await client.request<ApiRecord>("PUT", `/executedtestcases/${execution.id}`, payload);
  if (Number(updated.id) !== Number(execution.id)) throw new Error("TestCollab did not confirm the result write");
  if (input.time_taken !== undefined) {
    try {
      await client.request("PUT", `/executedtestcases/${execution.id}/updateTimeTaken`, { project: projectId, time_taken: input.time_taken });
    } catch (error) {
      throw new Error(`Result saved for execution ${execution.id}, but time update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return updated;
}

// TCV-7123: return company-checked IDs so they can also be saved on their steps.
async function attachFiles(client: TestCollabApiClient, projectId: number, executionId: number, files: PreparedAttachment[]) {
  if (!files.length) return [];
  const project = await client.request<ApiRecord>("GET", `/projects/${projectId}`);
  const companyId = relationId(project.company);
  if (!companyId) throw new Error("Project company was not returned");
  const ids: number[] = [];
  for (const file of files) ids.push(await client.uploadAttachment(file, companyId));
  await client.request("PUT", `/executedtestcases/${executionId}/updateAttachments`, { project: projectId, attachments: ids });
  return ids;
}

export async function handleReportTestCaseResult(args: unknown) {
  return handleTool(reportTestCaseResultSchema, args, async (input, client, projectId) => {
    // TCV-7123/7124: one file cap across result, step and dataset row evidence.
    const topLevelCount = input.attachments?.length ?? 0;
    const stepFiles = (input.step_results || []).flatMap(step => step.attachments || []);
    const rowFiles = (input.dataset_results || []).flatMap(row => row.attachments || []);
    const files = await prepareAttachments([...(input.attachments || []), ...stepFiles, ...rowFiles]);
    const query = new URLSearchParams({ project: String(projectId), regression: String(input.run_id), id: String(input.executed_test_case_id), _limit: "1" });
    const rows = await client.request<ApiRecord[]>("GET", `/executedtestcases?${query}`);
    const execution = rows[0];
    if (!execution || Number(execution.id) !== input.executed_test_case_id || relationId(execution.project) !== projectId || relationId(execution.regression) !== input.run_id) {
      throw new Error("Executed test case was not found in the requested project and run");
    }
    const planId = relationId(execution.test_plan);
    if (!planId || !relationId(execution.test_plan_test_case)) throw new Error("Execution has no test plan relationship");
    await getPlan(client, projectId, planId);
    await getRun(client, projectId, planId, input.run_id);
    const statuses = await getStatuses(client, projectId);
    validateStatus(input.status, statuses);
    for (const step of input.step_results || []) validateStatus(step.status, statuses);
    for (const row of input.dataset_results || []) validateStatus(row.status, statuses);
    // Resolve every step and coordinate before uploading any evidence.
    const stepResults = input.step_results?.length ? mergeStepResults(execution, input.status, input.step_results) : undefined;
    const datasetResults = input.dataset_results?.length ? mergeDatasetResults(execution, input.dataset_results) : undefined;
    let nestedFileIds: number[];
    try {
      nestedFileIds = await attachFiles(client, projectId, input.executed_test_case_id, files.slice(topLevelCount));
    } catch (error) {
      throw new Error(`Evidence upload/link failed before result update for execution ${execution.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let offset = 0;
    for (const [index, step] of (input.step_results || []).entries()) {
      const count = step.attachments?.length ?? 0;
      if (count) {
        const saved = stepResults![index]!;
        saved.attachments = [...(saved.attachments || []), ...nestedFileIds.slice(offset, offset + count)];
        offset += count;
      }
    }
    if (rowFiles.length) addDatasetAttachments(datasetResults!, input.dataset_results!, nestedFileIds.slice(stepFiles.length));
    const updated = await writeResult(client, projectId, execution, input, stepResults, datasetResults);
    let attachmentsUploaded: number;
    try {
      attachmentsUploaded = nestedFileIds.length + (await attachFiles(client, projectId, input.executed_test_case_id, files.slice(0, topLevelCount))).length;
    } catch (error) {
      throw new Error(`Result saved for execution ${execution.id}, but evidence upload failed: ${error instanceof Error ? error.message : String(error)}. Do not repeat the result or time update.`);
    }
    // TCV-7109: time and evidence are separate writes after the result. Return the row as
    // saved after them, so a caller can confirm the call instead of repeating it (time adds up).
    const reread = input.time_taken === undefined && !files.length ? undefined
      : (await client.request<ApiRecord[]>("GET", `/executedtestcases?${query}`).catch(() => []))[0];
    const saved = reread && Number(reread.id) === input.executed_test_case_id ? reread : updated;
    return { success: true, id: input.executed_test_case_id, status: saved.status, attachmentsUploaded, result: saved };
  });
}

export async function handleReportResults(args: unknown) {
  const result = await handleTool(reportResultsSchema, args, async (input, client, projectId) => {
    const plan = await getPlan(client, projectId, input.test_plan_id);
    const run = await getRun(client, projectId, input.test_plan_id, input.run_id);
    const [executions, statuses] = await Promise.all([
      getAssignedExecutions(client, projectId, input.test_plan_id, Number(run.id)),
      getStatuses(client, projectId),
    ]);
    const selected = new Set<number>();
    // Resolve the entire input before writes: no result may silently pick one
    // configuration of a matrix or overwrite the same execution twice.
    const records = input.results.map(record => {
      validateStatus(record.status, statuses);
      const matches = executions.filter(execution => relationId(execution.test_plan_test_case?.test_case) === record.test_case_id &&
        (record.configuration_id === undefined || relationId(execution.test_plan_config) === record.configuration_id));
      if (matches.length !== 1) throw new Error(`Test case ${record.test_case_id} has ${matches.length} matching assigned executions; provide a valid configuration_id and use get_test_plan_cases to check assignments`);
      const execution = matches[0]!;
      if (selected.has(Number(execution.id))) throw new Error(`Execution ${execution.id} was supplied more than once`);
      selected.add(Number(execution.id));
      return { record, execution };
    });
    const omitted = executions.filter(execution => !selected.has(Number(execution.id)));
    if (input.skip_missing && omitted.length) validateStatus("skipped", statuses);
    if (input.custom_fields) {
      if (new Set(input.custom_fields.map(field => field.id)).size !== input.custom_fields.length || new Set(input.custom_fields.map(field => field.name)).size !== input.custom_fields.length) {
        throw new Error("A custom field was supplied more than once");
      }
      const supplied = input.custom_fields;
      const merged = (plan.custom_fields || []).filter((field: ApiRecord) => !supplied.some(update => Number(update.id) === Number(field.id) || update.name === field.name)).concat(supplied);
      const updated = await client.request<ApiRecord>("PUT", `/testplans/${plan.id}`, { project: projectId, title: plan.title, custom_fields: merged });
      if (Number(updated.id) !== Number(plan.id)) throw new Error("TestCollab did not confirm the custom field update");
    }
    const reported: ApiRecord[] = [];
    const errors: ApiRecord[] = [];
    for (const { record, execution } of records) {
      try {
        const updated = await writeResult(client, projectId, execution, record);
        reported.push({ testCaseId: record.test_case_id, executedTestCaseId: execution.id, configurationId: relationId(execution.test_plan_config), status: updated.status });
      } catch (error) {
        errors.push({ executedTestCaseId: execution.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const skipped: number[] = [];
    if (input.skip_missing && !errors.length) {
      // Individual execution writes keep skipping within the chosen run and
      // record MCP provenance, unlike the latest-run-only bulk skip endpoint.
      for (const execution of omitted) {
        try {
          await writeResult(client, projectId, execution, { status: "skipped" });
          skipped.push(Number(execution.id));
        } catch (error) {
          errors.push({ executedTestCaseId: execution.id, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return { success: !errors.length, testPlanId: plan.id, runId: run.id, reported, skipped, errors };
  });
  if (!result.isError && JSON.parse(result.content[0]!.text).success === false) return { ...result, isError: true };
  return result;
}
