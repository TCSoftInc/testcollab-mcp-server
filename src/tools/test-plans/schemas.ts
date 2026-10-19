// TCV-7109: shared schemas are used for both discovery and handler validation.
import { z } from "zod";

export const MAX_ATTACHMENTS = 10;
export const MAX_BASE64_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const idSchema = z.number().int().positive();
const projectId = idSchema.optional().describe("Project ID; falls back to the transport's default project");
export const statusSchema = z.string().trim().min(1).describe("Active status system name, including custom statuses; see get_test_plan_cases.statuses");

const fileName = z.string().min(1).refine(name => !/[\\/\x00]/.test(name) && name !== "." && name !== "..", "Use a file name without a directory");
export const attachmentSchema = z.union([
  z.object({ file_path: z.string().min(1), mime_type: z.string().optional() }).strict(),
  z.object({
    file_name: fileName,
    content_base64: z.string().max(4 * Math.ceil(MAX_BASE64_BYTES / 3)),
    mime_type: z.string().optional(),
  }).strict(),
]);
export type AttachmentInput = z.infer<typeof attachmentSchema>;

export const stepResultSchema = z.object({
  step: z.string().optional(),
  expected_result: z.string().optional(),
  status: statusSchema,
  comment: z.string().optional(),
  // TCV-7123: step evidence uses the same file formats and per-file limits.
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional().describe("Files for this step; up to 10 files total across the result, steps and dataset rows"),
}).strict();

// TCV-7124: coordinates refer to the saved execution, with zero-based row/step indexes.
export const datasetResultSchema = z.object({
  dataset_id: idSchema,
  dataset_row_index: z.number().int().nonnegative(),
  step_index: z.number().int().nonnegative(),
  status: statusSchema,
  comment: z.string().optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
}).strict();
export type DatasetResultInput = z.infer<typeof datasetResultSchema>;

export const customFieldSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  label: z.string().optional(),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])), z.null()]),
  valueLabel: z.union([z.string(), z.array(z.string())]).optional(),
  color: z.string().optional(),
}).strict();

export const getTestPlanCasesSchema = z.object({
  project_id: projectId,
  test_plan_id: idSchema,
  run_id: idSchema.optional().describe("Include the token owner's assigned execution IDs for this plan run"),
}).strict();

export const reportTestCaseResultSchema = z.object({
  project_id: projectId,
  run_id: idSchema,
  executed_test_case_id: idSchema.describe("Execution ID returned by get_test_plan_cases; this is not a test case ID"),
  status: statusSchema,
  comment: z.string().optional(),
  time_taken: z.number().finite().positive().optional().describe("Additional execution time in milliseconds"),
  step_results: z.array(stepResultSchema).optional(),
  dataset_results: z.array(datasetResultSchema).optional().describe("Results by dataset ID and zero-based row/step indexes from get_test_plan_cases. Unreported entries are preserved. The case status must rank at least as high as every row status. Files count toward the 10-file call limit"),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional().describe("Up to 10 files total, including step and dataset row attachments. file_path: stdio only, max 10 MB. file_name + content_base64: max 1 MB decoded per file"),
}).strict();

export const reportResultsSchema = z.object({
  project_id: projectId,
  test_plan_id: idSchema,
  run_id: idSchema.optional().describe("Run to report; defaults to the latest run, as tc report does"),
  results: z.array(z.object({
    test_case_id: idSchema.describe("Internal test case ID returned by get_test_plan_cases, not its TC- display number"),
    configuration_id: idSchema.optional().describe("Required when a case has multiple assigned configurations"),
    status: statusSchema,
    comment: z.string().optional(),
    time_taken: z.number().finite().positive().optional().describe("Additional time in milliseconds"),
  }).strict()).min(1),
  skip_missing: z.boolean().default(false).describe("Mark the caller's assigned executions omitted from results as skipped; only after all supplied results succeed"),
  custom_fields: z.array(customFieldSchema).optional().describe("Test-plan field values in API format; other existing values are preserved"),
}).strict();
