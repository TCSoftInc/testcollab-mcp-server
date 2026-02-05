/**
 * Type definitions for TestCollab MCP Server
 */

// ============================================================================
// Filter Types (AG Grid compatible)
// ============================================================================

export interface TextFilter {
  filterType: "text";
  type:
    | "equals"
    | "notEqual"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "isBlank";
  filter: string;
}

export interface NumberFilter {
  filterType: "number";
  type:
    | "equals"
    | "notEqual"
    | "greaterThan"
    | "greaterThanOrEqual"
    | "lessThan"
    | "lessThanOrEqual"
    | "inRange";
  filter: number | number[];
  filterTo?: number;
}

export interface DateFilter {
  filterType: "date";
  type: "equals" | "notEqual" | "greaterThan" | "lessThan" | "inRange";
  dateFrom?: string;
  dateTo?: string;
}

export type FilterCondition = TextFilter | NumberFilter | DateFilter;

export interface TestCaseFilter {
  id?: NumberFilter;
  title?: TextFilter;
  description?: TextFilter;
  steps?: TextFilter;
  priority?: NumberFilter;
  suite?: NumberFilter;
  created_by?: NumberFilter;
  reviewer?: NumberFilter;
  poster?: NumberFilter;
  created_at?: DateFilter;
  updated_at?: DateFilter;
  last_run_on?: DateFilter;
  tags?: NumberFilter;
  requirements?: NumberFilter;
  issue_key?: TextFilter;
  under_review?: NumberFilter;
  is_automated?: NumberFilter;
  automation_status?: TextFilter;
  last_run_status?: TextFilter;
  run_count?: NumberFilter;
  avg_execution_time?: NumberFilter;
  failure_rate?: NumberFilter;
  [key: `cf_${number}`]: FilterCondition;
}

export interface SortModel {
  colId: string;
  sort: "asc" | "desc";
}

// ============================================================================
// Entity Types
// ============================================================================

export interface User {
  id: number;
  name: string;
  email: string;
  username?: string;
  rank?: string;
}

export interface Tag {
  id: number;
  name: string;
  color?: string;
}

export interface Requirement {
  id: number;
  title: string;
  external_id?: string;
}

export interface Attachment {
  id: number;
  name: string;
  url: string;
  size: number;
  mime_type: string;
}

export interface Step {
  id?: number;
  step_no: number;
  action: string;
  expected_result?: string;
  is_reusable?: boolean;
  reusable_step_id?: number;
}

export interface Suite {
  id: number;
  title: string;
  description?: string;
  parent_id?: number;
  project_id: number;
  test_case_count?: number;
  children?: Suite[];
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Project {
  id: number;
  title: string;
  description?: string;
}

export interface TestCase {
  id: number;
  title: string;
  description?: string;
  precondition?: string;
  expected_result?: string;
  priority: 0 | 1 | 2;
  steps?: Step[];
  stepsParsed?: Step[];
  suite?: Suite | number;
  suite_title?: string;
  project?: Project | number;
  tags?: Tag[];
  requirements?: Requirement[];
  attachments?: Attachment[];
  custom_fields?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  created_by?: User;
  created_at?: string;
  updated_at?: string;
  under_review?: boolean | number;
  is_automated?: boolean | number;
  automation_status?: string;
  automation_info?: Record<string, unknown>;
  run_count?: number;
  last_run_on?: string;
  last_run_status?: string;
  avg_execution_time?: number;
  failure_rate?: number;
  revision?: number;
  sort_order?: number;
}

// ============================================================================
// Response Types
// ============================================================================

export interface TestCaseCollection {
  rows: TestCase[];
  totalCount: number;
  filteredCount: number;
  lastRow?: number;
}

export interface SuiteTree {
  suites: Suite[];
  total_count: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
