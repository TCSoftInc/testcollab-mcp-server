/**
 * get_test_case MCP Tool
 *
 * Retrieves a single test case with full details, including steps.
 */

import { z } from "zod";
import { getApiClient } from "../../client/api-client.js";
import { getConfig } from "../../config.js";
import { getRequestContext } from "../../context.js";

// ============================================================================
// Schema Definitions
// ============================================================================

export const getTestCaseSchema = z.object({
  id: z.number().describe("Test case ID to retrieve (required)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (uses default if not specified)"),
  parse_reusable_steps: z
    .boolean()
    .optional()
    .describe("Parse reusable steps into full steps (default: true)"),
});

export type GetTestCaseInput = z.infer<typeof getTestCaseSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const getTestCaseTool = {
  name: "get_test_case",
  description: `Fetch a single test case with full details, including steps and expected results.

Required: id (test case ID)
Optional: project_id, parse_reusable_steps (default: true)

Example:
{
  "id": 1835,
  "parse_reusable_steps": true
}`,

  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Test case ID to retrieve (required)",
      },
      project_id: {
        type: "number",
        description: "Project ID (optional if default is set)",
      },
      parse_reusable_steps: {
        type: "boolean",
        description: "Parse reusable steps into full steps (default: true)",
      },
    },
    required: ["id"],
  },
};

// ============================================================================
// Helpers
// ============================================================================

const numericIdPattern = /^\d+$/;

const toNumberId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && numericIdPattern.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getField = <T>(item: unknown, key: string): T | undefined => {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  if (record[key] !== undefined) {
    return record[key] as T;
  }
  const attributes = record["attributes"];
  if (attributes && typeof attributes === "object") {
    return (attributes as Record<string, unknown>)[key] as T | undefined;
  }
  const relations = record["relations"];
  if (relations && typeof relations === "object") {
    return (relations as Record<string, unknown>)[key] as T | undefined;
  }
  return undefined;
};

const unwrapApiData = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const data = record["data"];
  return data && typeof data === "object" ? data : value;
};

const unwrapApiEntity = (value: unknown): Record<string, unknown> | null => {
  const unwrapped = unwrapApiData(value);
  if (!unwrapped || typeof unwrapped !== "object") {
    return null;
  }
  const record = unwrapped as Record<string, unknown>;
  const attributes = record["attributes"];
  if (attributes && typeof attributes === "object") {
    return { ...(attributes as Record<string, unknown>), ...record };
  }
  return record;
};

const unwrapCollection = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const data = record["data"];
  return Array.isArray(data) ? data : undefined;
};

const getArrayField = (
  container: Record<string, unknown>,
  key: string,
  altKeys?: string[]
): unknown[] | undefined => {
  const direct = unwrapCollection(getField<unknown>(container, key));
  if (direct) {
    return direct;
  }
  if (altKeys) {
    for (const altKey of altKeys) {
      const altValue = unwrapCollection(getField<unknown>(container, altKey));
      if (altValue) {
        return altValue;
      }
    }
  }
  return undefined;
};

const getExistingStepsSource = (
  testCase: Record<string, unknown>
): unknown[] | undefined => {
  const direct = getArrayField(testCase, "steps");
  const parsed = getArrayField(testCase, "stepsParsed", ["steps_parsed"]);
  if (direct && direct.length > 0) {
    return direct;
  }
  if (parsed && parsed.length > 0) {
    return parsed;
  }
  return direct ?? parsed;
};

const getStepText = (step: unknown): string | undefined => {
  if (typeof step === "string") {
    return normalizeString(step);
  }
  const raw =
    getField<string>(step, "step") ??
    getField<string>(step, "action") ??
    getField<string>(step, "description");
  return normalizeString(raw);
};

const getStepExpectedResult = (step: unknown): string | undefined => {
  const raw =
    getField<string>(step, "expectedResult") ??
    getField<string>(step, "expected_result") ??
    getField<string>(step, "expected");
  return normalizeString(raw);
};

const getStepReusableId = (step: unknown): number | null | undefined => {
  const raw =
    getField<unknown>(step, "reusableStepId") ??
    getField<unknown>(step, "reusable_step_id") ??
    getField<unknown>(step, "parsedReusableStepId") ??
    getField<unknown>(step, "parsed_reusable_step_id");
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  return toNumberId(raw) ?? null;
};

const getStepNumber = (step: unknown, index: number): number => {
  const raw =
    getField<unknown>(step, "step_no") ??
    getField<unknown>(step, "step_number") ??
    getField<unknown>(step, "stepNo");
  return toNumberId(raw) ?? index + 1;
};

const extractId = (value: unknown): number | undefined => {
  const direct = toNumberId(value);
  if (direct !== undefined) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const recordId = toNumberId(record["id"]);
  if (recordId !== undefined) {
    return recordId;
  }
  const data = record["data"];
  if (data && typeof data === "object") {
    return toNumberId((data as Record<string, unknown>)["id"]);
  }
  return undefined;
};

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleGetTestCase(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Validate input
  const parsed = getTestCaseSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid input parameters",
              details: parsed.error.errors,
            },
          }),
        },
      ],
    };
  }

  const { id, project_id, parse_reusable_steps } = parsed.data;

  // Resolve project ID: check request context first (HTTP), then env config (stdio)
  const requestContext = getRequestContext();
  const envConfig = requestContext ? null : getConfig();
  const resolvedProjectId = project_id ?? requestContext?.defaultProjectId ?? envConfig?.defaultProjectId;

  if (!resolvedProjectId) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "MISSING_PROJECT_ID",
              message:
                "project_id is required. Either provide it in the request or set TC_DEFAULT_PROJECT.",
            },
          }),
        },
      ],
    };
  }

  try {
    const client = getApiClient();
    const existingRaw = await client.getTestCaseRaw(id, resolvedProjectId, {
      parseRs: parse_reusable_steps ?? true,
    });
    const existing = unwrapApiEntity(existingRaw);

    if (!existing) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "INVALID_TEST_CASE",
                message: `Unable to load test case ${id}.`,
              },
            }),
          },
        ],
      };
    }

    const stepsSource = getExistingStepsSource(existing);
    const steps = stepsSource?.map((s, index) => ({
      step_number: getStepNumber(s, index),
      step: getStepText(s) ?? "",
      expected_result: getStepExpectedResult(s) ?? null,
      reusable_step_id: getStepReusableId(s) ?? null,
    }));

    const stepsMissingExpectedResults = (steps ?? [])
      .filter((step) => !normalizeString(step.expected_result))
      .map((step) => step.step_number);

    const suiteValue = getField<unknown>(existing, "suite");
    const projectValue = getField<unknown>(existing, "project");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              testCase: {
                id: extractId(existing) ?? id,
                title: getField<string>(existing, "title"),
                description: getField<string | null>(existing, "description"),
                priority: toNumberId(getField<unknown>(existing, "priority")),
                suite: typeof suiteValue === "object" ? extractId(suiteValue) : suiteValue,
                suiteTitle:
                  getField<string>(existing, "suite_title") ??
                  (suiteValue && typeof suiteValue === "object"
                    ? getField<string>(suiteValue, "title")
                    : undefined),
                project:
                  typeof projectValue === "object"
                    ? extractId(projectValue)
                    : projectValue,
                projectTitle:
                  projectValue && typeof projectValue === "object"
                    ? getField<string>(projectValue, "title")
                    : undefined,
                steps,
              },
              stepsMissingExpectedResults,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: "API_ERROR",
              message: message,
            },
          }),
        },
      ],
    };
  }
}
