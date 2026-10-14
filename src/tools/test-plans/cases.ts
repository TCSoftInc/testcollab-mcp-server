// TCV-7109: expose runnable cases and unambiguous execution IDs per configuration.
import { getTestPlanCasesSchema } from "./schemas.js";
import { getAssignedExecutions, getPlan, getRun, getStatuses, handleTool, listAll, relationId, type ApiRecord } from "./shared.js";

function arrayValue(value: unknown): ApiRecord[] {
  if (typeof value === "string") return value ? JSON.parse(value) : [];
  return Array.isArray(value) ? value : [];
}

export async function handleGetTestPlanCases(args: unknown) {
  return handleTool(getTestPlanCasesSchema, args, async (input, client, projectId) => {
    const plan = await getPlan(client, projectId, input.test_plan_id);
    if (input.run_id) await getRun(client, projectId, input.test_plan_id, input.run_id);
    const [cases, configurations, statuses, executionRows] = await Promise.all([
      listAll(client, "/testplantestcases", { project: projectId, testplan: input.test_plan_id }),
      listAll(client, "/testplanconfigurations", { project: projectId, testplan: input.test_plan_id }),
      getStatuses(client, projectId),
      input.run_id ? getAssignedExecutions(client, projectId, input.test_plan_id, input.run_id) : Promise.resolve([]),
    ]);
    const casesById = new Map(cases.map(row => [Number(row.id), row]));
    const configById = new Map(configurations.map(row => [Number(row.id), row]));
    const configLabel = (id: number | null) => arrayValue(configById.get(id!)?.parameters).map(p => `${p.field}: ${p.value}`).join(", ") || null;
    const executions = executionRows.map(row => {
      const planCaseId = relationId(row.test_plan_test_case);
      const testCase = casesById.get(planCaseId!)?.test_case;
      const configId = relationId(row.test_plan_config);
      return {
        id: row.id, testPlanTestCaseId: planCaseId, testCaseId: relationId(testCase),
        title: testCase?.title ?? row.test_case_revision?.title ?? null,
        configId, configLabel: configLabel(configId), status: row.status,
        assignedTo: relationId(row.assigned_to),
        // A run uses a revision snapshot. Return it so later edits cannot change
        // the instructions the caller executes for an already-created run.
        steps: arrayValue(row.test_case_revision?.steps_parsed ?? row.test_case_revision?.steps).map(step => ({
          step: step.step, expectedResult: step.expectedResult ?? step.expected_result ?? "",
        })),
      };
    });
    return {
      testPlan: { id: plan.id, title: plan.title, description: plan.description, status: plan.status, totalCases: cases.length, runId: input.run_id ?? null },
      statuses: statuses.map(status => ({ id: status.id, name: status.name, systemName: status.system_name, priority: status.priority, ignoreResult: !!status.ignore_result })),
      configurations: configurations.map(config => ({ id: config.id, parameters: arrayValue(config.parameters), assignedTo: relationId(config.assigned_to) })),
      executions,
      testCases: cases.map(row => {
        const tc = row.test_case;
        if (!tc || typeof tc !== "object") throw new Error(`Test plan case ${row.id} has no test case details`);
        return {
          id: tc.id, displayNumber: tc.display_number, testPlanTestCaseId: row.id,
          title: tc.title, description: tc.description, priority: tc.priority, suite: tc.suite ?? null, status: row.status,
          steps: arrayValue(tc.steps_parsed ?? tc.steps).map(step => ({ step: step.step, expectedResult: step.expectedResult ?? step.expected_result ?? "" })),
          configResults: arrayValue(row.results).map(result => {
            const id = relationId(result.configId ?? result.config_id);
            return { configId: id, configLabel: configLabel(id), status: result.status };
          }),
          executions: executions.filter(execution => execution.testPlanTestCaseId === Number(row.id)),
        };
      }),
    };
  });
}
