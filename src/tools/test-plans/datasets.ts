// TCV-7124: use execution snapshots and merge row results like tc-cli's applyExampleResults.
import type { DatasetResultInput } from "./schemas.js";
import { encodeComment, type ApiRecord } from "./shared.js";

export function datasetArray(raw: unknown): ApiRecord[] {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i++) value = JSON.parse(value);
  return Array.isArray(value) ? value : [];
}

export function describeDatasets(raw: unknown): ApiRecord[] {
  return datasetArray(raw).filter(Boolean).map(dataset => ({
    id: dataset.id, name: dataset.name,
    parameters: datasetArray(dataset.parameters),
    rows: datasetArray(dataset.datarows).map((values, index) => ({ index, values })),
  }));
}

const coordinate = (row: ApiRecord) => `${row.dataset_id}|${row.dataset_row_index}|${row.step_index}`;

export function mergeDatasetResults(execution: ApiRecord, inputs: DatasetResultInput[]): ApiRecord[] {
  const saved = datasetArray(execution.testdataset_wise_result);
  const positions = new Map(saved.map((row, index) => [coordinate(row), index]));
  const selected = new Set<string>();
  const merged = saved.map(row => ({ ...row }));
  for (const input of inputs) {
    const key = coordinate(input);
    const index = positions.get(key);
    if (index === undefined) throw new Error(`Dataset row/step ${key} was not found in execution ${execution.id}; use get_test_plan_cases with run_id`);
    if (selected.has(key)) throw new Error(`Dataset row/step ${key} was supplied more than once`);
    selected.add(key);
    merged[index] = { ...saved[index], status: input.status,
      ...(input.comment === undefined ? {} : { comment: encodeComment(input.comment) }),
    };
  }
  return merged;
}

// Uploaded IDs are linked to the execution before they are put on a row/step.
export function addDatasetAttachments(results: ApiRecord[], inputs: DatasetResultInput[], ids: number[]): void {
  let offset = 0;
  for (const input of inputs) {
    const count = input.attachments?.length || 0;
    if (!count) continue;
    const row = results.find(row => coordinate(row) === coordinate(input))!;
    row.attachments = [...new Set([...datasetArray(row.attachments), ...ids.slice(offset, offset + count)])];
    offset += count;
  }
}
