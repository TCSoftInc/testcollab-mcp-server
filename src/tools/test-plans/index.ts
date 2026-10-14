/**
 * Test Plan Tools
 *
 * Exports all test plan related MCP tools.
 */

export {
  getTestPlanTool,
  getTestPlanRegistrationSchema,
  getTestPlanSchema,
  handleGetTestPlan,
} from "./get.js";
export {
  createTestPlanTool,
  createTestPlanSchema,
  handleCreateTestPlan,
} from "./create.js";
export {
  listTestPlansTool,
  listTestPlansSchema,
  handleListTestPlans,
} from "./list.js";
export {
  updateTestPlanTool,
  updateTestPlanSchema,
  handleUpdateTestPlan,
} from "./update.js";
export {
  deleteTestPlanTool,
  deleteTestPlanSchema,
  handleDeleteTestPlan,
} from "./delete.js";

// TCV-7109: execution tools extend the existing plan tool set.
export { handleGetTestPlanCases } from "./cases.js";
export { handleReportTestCaseResult, handleReportResults } from "./report.js";
export { getTestPlanCasesSchema, reportTestCaseResultSchema, reportResultsSchema } from "./schemas.js";
