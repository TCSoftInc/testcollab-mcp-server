# TestCollab MCP Server - TODO

## Infrastructure

### Auto-deploy on push to master
- [ ] Set up GitLab CI/CD pipeline or webhook
- [ ] On push to master: SSH to 134.209.167.146, pull latest, npm install, npm run build, pm2 restart tc-mcp-server
- [ ] Consider using GitLab runner or simple webhook receiver

---

## V1.0 - Core Test Management (Current)

### Test Case Management
- [x] `list_test_cases` - List with filtering, sorting, pagination
- [x] `create_test_case` - Create new test case
- [x] `update_test_case` - Update existing test case
- [x] `get_test_case` - Get single test case with full details
- [ ] `delete_test_case` - Soft delete test case
- [ ] `copy_test_case` - Duplicate test case to suite
- [ ] `bulk_delete_test_cases` - Delete multiple (async queue job)
- [ ] `bulk_update_test_cases` - Update multiple (async queue job)
- [ ] `get_test_case_revisions` - Version history
- [ ] `revert_test_case` - Revert to previous revision

### Suite Management
- [ ] `list_suites` - Get suite hierarchy tree
- [ ] `get_suite` - Get suite details
- [ ] `create_suite` - Create new suite
- [ ] `update_suite` - Update suite
- [ ] `delete_suite` - Delete suite (with option to move test cases)
- [ ] `move_suite` - Reorder in hierarchy
- [ ] `copy_suite` - Clone suite with test cases (async queue job)

---

## V2.0 - Test Execution (Planned)

### Test Plan Management
- [ ] `list_test_plans` - List test plans with filtering
- [ ] `get_test_plan` - Get test plan details
- [ ] `create_test_plan` - Create new test plan
- [ ] `update_test_plan` - Update test plan
- [ ] `delete_test_plan` - Delete test plan
- [ ] `copy_test_plan` - Clone test plan
- [ ] `assign_test_cases_to_plan` - Add test cases to plan
- [ ] `remove_test_cases_from_plan` - Remove test cases from plan
- [ ] `get_test_plan_progress` - Get execution progress metrics
- [ ] `archive_test_plan` - Archive completed plan

### Test Execution
- [ ] `list_executions` - List execution results
- [ ] `get_execution` - Get execution details
- [ ] `record_execution` - Record test result
- [ ] `update_execution` - Update execution result
- [ ] `bulk_record_executions` - Batch record results
- [ ] `assign_execution` - Assign to tester
- [ ] `add_execution_comment` - Add comment to result

---

## V3.0 - Traceability & Reporting (Planned)

### Requirements Management
- [ ] `list_requirements` - List requirements
- [ ] `get_requirement` - Get requirement details
- [ ] `create_requirement` - Create requirement
- [ ] `update_requirement` - Update requirement
- [ ] `link_test_case_to_requirement` - Create traceability link
- [ ] `get_traceability_matrix` - Get coverage matrix

### Defect Management
- [ ] `list_defects` - List defects
- [ ] `get_defect` - Get defect details
- [ ] `create_defect` - Log new defect
- [ ] `update_defect` - Update defect
- [ ] `link_defect_to_test_case` - Link defect to test case

### Reports & Analytics
- [ ] `get_execution_burndown` - Burndown chart data
- [ ] `get_failure_distribution` - Failure analysis
- [ ] `get_test_case_pass_rate` - Pass rate metrics
- [ ] `get_activity_log` - Audit trail

---

## V4.0 - Advanced Features (Future)

### Project & Configuration
- [ ] `list_projects` - List accessible projects
- [ ] `get_project` - Get project details
- [ ] `get_project_metrics` - Dashboard statistics
- [ ] `list_statuses` - Get project statuses
- [ ] `list_tags` - Get project tags
- [ ] `list_custom_fields` - Get custom field definitions

### Queue & Background Operations
- [ ] `get_queue_status` - Check bulk operation progress
- [ ] `list_pending_queues` - List running background jobs

### User & Access
- [ ] `get_current_user` - Get authenticated user info
- [ ] `list_project_members` - List project team members
