// TCV-7109: result writes reuse the execution API; the token determines executor.
import type { TestCollabApiClient } from "../../client/api-client.js";
import { SERVER_VERSION } from "../../config.js";
import { prepareAttachments, type PreparedAttachment } from "./attachments.js";
import { reportResultsSchema, reportTestCaseResultSchema } from "./schemas.js";
import { encodeComment, getAssignedExecutions, getPlan, getRun, getStatuses, handleTool, relationId, validateStatus, type ApiRecord } from "./shared.js";

interface ResultInput { status: string; comment?: string; time_taken?: number; step_results?: Array<{ status: string; step?: string; expected_result?: string; comment?: string }> }

async function writeResult(client: TestCollabApiClient, projectId: number, execution: ApiRecord, input: ResultInput) {
  const payload: ApiRecord = {
    id: execution.id, project: projectId, test_plan: relationId(execution.test_plan),
    test_plan_test_case: relationId(execution.test_plan_test_case), status: input.status,
    execution_source: "api", execution_context: { tool: "tc-mcp-server", tool_version: SERVER_VERSION },
  };
  const configId = relationId(execution.test_plan_config);
  if (configId) payload.test_plan_config = configId;
  if (input.comment !== undefined) payload.comment = encodeComment(input.comment);
  if (input.step_results !== undefined) payload.step_wise_result = input.step_results.map(step => ({
    status: step.status,
    ...(step.step === undefined ? {} : { step: step.step }),
    ...(step.expected_result === undefined ? {} : { expectedResult: step.expected_result }),
    ...(step.comment === undefined ? {} : { comment: encodeComment(step.comment) }),
  }));
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

async function attachFiles(client: TestCollabApiClient, projectId: number, executionId: number, files: PreparedAttachment[]) {
  if (!files.length) return 0;
  const project = await client.request<ApiRecord>("GET", `/projects/${projectId}`);
  const companyId = relationId(project.company);
  if (!companyId) throw new Error("Project company was not returned");
  const ids: number[] = [];
  for (const file of files) ids.push(await client.uploadAttachment(file, companyId));
  await client.request("PUT", `/executedtestcases/${executionId}/updateAttachments`, { project: projectId, attachments: ids });
  return ids.length;
}

export async function handleReportTestCaseResult(args: unknown) {
  return handleTool(reportTestCaseResultSchema, args, async (input, client, projectId) => {
    const files = await prepareAttachments(input.attachments);
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
    const updated = await writeResult(client, projectId, execution, input);
    try {
      const attachmentsUploaded = await attachFiles(client, projectId, input.executed_test_case_id, files);
      return { success: true, id: input.executed_test_case_id, status: updated.status, attachmentsUploaded, result: updated };
    } catch (error) {
      throw new Error(`Result saved for execution ${execution.id}, but evidence upload failed: ${error instanceof Error ? error.message : String(error)}. Do not repeat the result or time update.`);
    }
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
