# TestCollab MCP Server - Use Cases

This document describes common use cases for the TestCollab MCP Server when integrated with AI coding assistants like Claude Code, Cursor, Windsurf, or Codex.

## Setup

See the [Installation Guide](install.md) for full setup instructions. Quick start for Claude Code:

```bash
claude mcp add testcollab \
  -e TC_API_TOKEN=your-api-token \
  -e TC_API_URL=https://api.testcollab.io \
  -e TC_DEFAULT_PROJECT=16 \
  -- npx -y @testcollab/mcp-server
```

---

## Available Tools

### Test Cases
| Tool | Description |
|------|-------------|
| `get_project_context` | Get suites, tags, custom fields, requirements, and users for a project |
| `list_test_cases` | Query test cases with filtering, sorting, and pagination |
| `get_test_case` | Fetch a single test case with full step details |
| `create_test_case` | Create a test case with steps, tags, and custom fields |
| `update_test_case` | Update any test case field, including step patching |

### Test Plans
| Tool | Description |
|------|-------------|
| `list_test_plans` | List test plans with filtering and sorting |
| `create_test_plan` | Create a test plan with cases, configurations, and assignment |
| `update_test_plan` | Update test plan metadata, status, or assignment |

### Suites
| Tool | Description |
|------|-------------|
| `list_suites` | List all test suites in a project |
| `get_suite` | Get suite details |
| `create_suite` | Create a new suite |
| `update_suite` | Update a suite |
| `delete_suite` | Delete a suite |
| `move_suite` | Move a suite to a different parent |
| `reorder_suites` | Reorder suites within a parent |

---

## YOLO Mode — Full Codebase Test Generation

With auto-accept mode enabled in your AI coding assistant (e.g. YOLO mode), you can point the AI at your entire codebase and have it autonomously scan the code, create a suite structure, and generate test cases — all in one go.

**Example prompt:**
> "Scan this entire codebase. Create suites mirroring the module structure and generate test cases with detailed steps for every feature you find."

**What happens:**
1. The AI reads your source files, routes, controllers, and models
2. Creates a suite hierarchy matching your code structure
3. Generates test cases with steps for each feature, endpoint, or user flow it discovers

**Benchmarks:**

| Codebase size | Approximate time | What you get |
|---------------|-----------------|--------------|
| Small (< 20 files) | ~5 minutes | 20-40 test cases across 5-10 suites |
| Medium (~50 files) | ~20-30 minutes | 50-100+ test cases across 15-25 suites |
| Large (100+ files) | ~45-60 minutes | 150+ test cases across 30+ suites |

This works best with auto-accept / YOLO mode enabled in your client, so the AI doesn't pause for approval on each tool call.

**Accuracy notes:**
- Suite structures and test case titles are generally accurate — the AI infers these well from code structure and naming.
- Test steps can sometimes be hallucinated, especially for UI flows the AI hasn't directly observed. Review generated steps before using them in execution.
- For best results, make sure your TestCollab project has a **detailed project description** — specify what kind of application you're testing (web app, REST API, mobile app, desktop, IoT, etc.), the tech stack, and key user roles. This gives the AI the context it needs to write realistic, actionable steps instead of generic ones.

---

## AI Coding Assistant Workflows

These use cases show how developers use TestCollab through AI assistants during real development work.

### 1. Creating Tests While Implementing a Feature

**Context:** Developer is implementing a new password reset feature and wants to document test cases as they build.

**User prompt:**
> "I just implemented the password reset flow. Create test cases for: 1) successful reset with valid email, 2) reset with unregistered email, 3) expired reset token handling"

**What the AI does:**
1. Creates three test cases using `create_test_case`
2. Sets appropriate priority levels
3. Adds detailed steps based on the implementation context

**Tool calls:**
```json
// Call 1
{
  "title": "Password reset - successful reset with valid email",
  "priority": 2,
  "description": "Verify that users can successfully reset their password using a valid registered email address",
  "steps": [
    {"step": "Navigate to /forgot-password", "expected_result": "Password reset form is displayed"},
    {"step": "Enter a valid registered email address", "expected_result": "Email field accepts input"},
    {"step": "Click 'Send Reset Link' button", "expected_result": "Success message displayed, email sent"},
    {"step": "Open reset link from email", "expected_result": "Password reset form displayed"},
    {"step": "Enter new password and confirm", "expected_result": "Password updated, redirected to login"},
    {"step": "Login with new password", "expected_result": "Login successful"}
  ]
}

// Call 2
{
  "title": "Password reset - unregistered email shows generic message",
  "priority": 1,
  "description": "Verify that reset requests for unregistered emails don't reveal account existence",
  "steps": [
    {"step": "Navigate to /forgot-password", "expected_result": "Password reset form displayed"},
    {"step": "Enter an email not registered in the system", "expected_result": "Email field accepts input"},
    {"step": "Click 'Send Reset Link' button", "expected_result": "Same success message as valid email (security)"},
    {"step": "Check that no email was actually sent", "expected_result": "No email received"}
  ]
}

// Call 3
{
  "title": "Password reset - expired token rejected",
  "priority": 2,
  "description": "Verify that expired password reset tokens are properly rejected",
  "steps": [
    {"step": "Generate a password reset token", "expected_result": "Token created with expiry"},
    {"step": "Wait for token to expire (or manually expire in DB)", "expected_result": "Token is now expired"},
    {"step": "Attempt to use the expired reset link", "expected_result": "Error message: 'Reset link has expired'"},
    {"step": "Verify user is prompted to request a new reset", "expected_result": "Link to request new reset shown"}
  ]
}
```

---

### 2. Finding Existing Tests Before Making Changes

**Context:** Developer is about to refactor the authentication module and wants to understand existing test coverage.

**User prompt:**
> "Before I refactor the auth module, show me all test cases related to authentication and login"

**What the AI does:**
1. Searches for tests containing "auth", "login", "password", "session"
2. Provides a summary of coverage areas
3. Highlights any gaps

**Tool call:**
```json
{
  "filter": {
    "title": {
      "filterType": "text",
      "type": "contains",
      "filter": "login"
    }
  },
  "limit": 50
}
```

**Example response:**
> "Found 12 test cases related to authentication:
>
> **Login tests (5):**
> - TC-1501: 'Verify user login with valid credentials' - High priority, passing
> - TC-1502: 'Verify login fails with invalid password' - High priority, passing
> - TC-1503: 'Verify login session timeout' - Normal priority, passing
> - TC-1504: 'Verify remember me functionality' - Low priority, not run recently
> - TC-1505: 'Verify account lockout after failed attempts' - High priority, failing
>
> **Session tests (3):** ...
>
> **Note:** TC-1505 is currently failing - you may want to investigate before refactoring."

---

### 3. Updating Tests After Code Changes

**Context:** Developer changed the error message format in the API and needs to update related test cases.

**User prompt:**
> "I changed the login error from 'Invalid credentials' to 'The email or password you entered is incorrect'. Update test case 1502 with the new expected message."

**What the AI does:**
1. Updates the specific test case using `update_test_case`
2. Modifies only the relevant step's expected result

**Tool call:**
```json
{
  "id": 1502,
  "steps": [
    {"step": "Navigate to login page", "expected_result": "Login form displayed"},
    {"step": "Enter valid email address", "expected_result": "Email accepted"},
    {"step": "Enter incorrect password", "expected_result": "Password field accepts input"},
    {"step": "Click login button", "expected_result": "Error displayed: 'The email or password you entered is incorrect'"},
    {"step": "Verify user remains on login page", "expected_result": "Login form still visible, not authenticated"}
  ]
}
```

---

### 4. Bulk Test Creation from User Stories

**Context:** Sprint planning just finished and the team has new user stories that need test cases.

**User prompt:**
> "Create test cases for user story: 'As a user, I want to export my data as CSV so I can analyze it in Excel'. Cover success path, empty data, and large dataset scenarios."

**What the AI does:**
1. Creates multiple test cases covering different scenarios
2. Uses consistent naming convention
3. Sets appropriate priorities

**Tool calls:**
```json
// Success path - High priority
{
  "title": "Data export - successfully export user data as CSV",
  "priority": 2,
  "description": "User story: Export data as CSV for Excel analysis",
  "steps": [
    {"step": "Login as user with existing data", "expected_result": "Dashboard displayed"},
    {"step": "Navigate to Settings > Export Data", "expected_result": "Export options displayed"},
    {"step": "Select 'CSV' format", "expected_result": "CSV option selected"},
    {"step": "Click 'Export' button", "expected_result": "Download starts"},
    {"step": "Open downloaded file in Excel", "expected_result": "Data displays correctly with proper columns"}
  ]
}

// Empty data - Normal priority
{
  "title": "Data export - handle empty dataset gracefully",
  "priority": 1,
  "description": "Verify export behavior when user has no data",
  "steps": [
    {"step": "Login as new user with no data", "expected_result": "Empty dashboard displayed"},
    {"step": "Navigate to Settings > Export Data", "expected_result": "Export options displayed"},
    {"step": "Click 'Export' button", "expected_result": "Message: 'No data to export' or empty CSV with headers only"}
  ]
}

// Large dataset - Normal priority
{
  "title": "Data export - handle large dataset (10k+ rows)",
  "priority": 1,
  "description": "Verify export performance and completeness with large data",
  "steps": [
    {"step": "Login as user with 10,000+ data records", "expected_result": "Dashboard loads"},
    {"step": "Navigate to Settings > Export Data", "expected_result": "Export options displayed"},
    {"step": "Select CSV and click Export", "expected_result": "Progress indicator shown"},
    {"step": "Wait for download to complete", "expected_result": "File downloads within 30 seconds"},
    {"step": "Verify row count in exported file", "expected_result": "All 10,000+ rows present"}
  ]
}
```

---

### 5. Investigating Test Failures During PR Review

**Context:** CI pipeline failed and developer needs to understand which tests are failing.

**User prompt:**
> "The build failed. Show me high priority tests that are currently failing."

**What the AI does:**
1. Queries for failed tests with high priority
2. Provides context on failure patterns

**Tool call:**
```json
{
  "filter": {
    "priority": {
      "filterType": "number",
      "type": "equals",
      "filter": 2
    },
    "last_run_status": {
      "filterType": "number",
      "type": "equals",
      "filter": 2
    }
  },
  "sort": [{"colId": "failure_rate", "sort": "desc"}]
}
```

**Example response:**
> "Found 3 high-priority failing tests:
>
> 1. **TC-1523: 'Verify payment processing'** - 35% failure rate
>    - Last failed: 2 hours ago
>    - This test has been flaky - may be environment-related
>
> 2. **TC-1489: 'User authentication flow'** - 12% failure rate
>    - Last failed: Today
>    - Recently modified on Jan 18 - check recent changes
>
> 3. **TC-1501: 'Verify user login with valid credentials'** - 5% failure rate
>    - Last failed: Today
>    - Usually stable - likely a real regression"

---

### 6. Syncing Test Cases with Code Changes

**Context:** Developer refactored a function and needs to update all tests that reference the old behavior.

**User prompt:**
> "I renamed the `calculateTotal()` function to `computeOrderTotal()` and changed the return type from number to an object `{total, tax, discount}`. Find and update any test cases that reference this."

**What the AI does:**
1. Searches for test cases mentioning the old function
2. Updates each one with the new function name and expected return format

**Tool call (search):**
```json
{
  "filter": {
    "steps": {
      "filterType": "text",
      "type": "contains",
      "filter": "calculateTotal"
    }
  }
}
```

**Tool call (update for each found test):**
```json
{
  "id": 1567,
  "steps": [
    {"step": "Call computeOrderTotal() with test cart", "expected_result": "Returns object with total, tax, and discount properties"},
    {"step": "Verify total calculation", "expected_result": "total equals sum of items minus discount plus tax"},
    {"step": "Verify tax calculation", "expected_result": "tax property contains correct tax amount"},
    {"step": "Verify discount applied", "expected_result": "discount property reflects applied discounts"}
  ]
}
```

---

### 7. Creating Tests from Bug Reports

**Context:** A bug was reported and fixed; now need to add regression tests.

**User prompt:**
> "Bug fix: Users could bypass email verification by directly accessing /dashboard. Create a test case for this regression."

**What the AI does:**
1. Creates a high-priority security test
2. Documents the attack vector and expected fix behavior

**Tool call:**
```json
{
  "title": "Security - unverified users cannot access dashboard directly",
  "priority": 2,
  "description": "Regression test for bug: Users could bypass email verification by directly navigating to /dashboard URL",
  "steps": [
    {"step": "Register a new user account", "expected_result": "Account created, verification email sent"},
    {"step": "Do NOT click verification link in email", "expected_result": "Account remains unverified"},
    {"step": "Attempt to login with unverified account", "expected_result": "Login succeeds but restricted access"},
    {"step": "Directly navigate to /dashboard URL", "expected_result": "Redirected to verification pending page"},
    {"step": "Attempt to access /api/user/data endpoint", "expected_result": "401 Unauthorized - email not verified"},
    {"step": "Complete email verification", "expected_result": "Account now verified"},
    {"step": "Navigate to /dashboard", "expected_result": "Dashboard loads successfully"}
  ]
}
```

---

### 8. Reviewing Test Coverage Before Release

**Context:** Preparing for a release and need to ensure critical paths are tested.

**User prompt:**
> "We're releasing v2.0 tomorrow. Give me a test coverage summary - focus on high priority tests and any that haven't been run recently."

**What the AI does:**
1. Queries all high-priority tests
2. Identifies tests not run in last 7 days
3. Calculates coverage metrics

**Tool calls:**
```json
// High priority tests
{
  "filter": {
    "priority": {"filterType": "number", "type": "equals", "filter": 2}
  },
  "limit": 100
}

// Tests not run recently
{
  "filter": {
    "last_run_on": {
      "filterType": "date",
      "type": "lessThan",
      "dateFrom": "2026-01-14"
    }
  },
  "sort": [{"colId": "priority", "sort": "desc"}]
}
```

**Example response:**
> "**Release Readiness Summary:**
>
> **High Priority Tests:** 64 total
> - Passing: 58 (91%)
> - Failing: 4 (6%)
> - Not run: 2 (3%)
>
> **Tests not run in 7+ days:** 18 tests
> - 3 are high priority - recommend running before release
> - TC-1489, TC-1512, TC-1534
>
> **Recommended actions:**
> 1. Investigate 4 failing high-priority tests
> 2. Run the 3 stale high-priority tests
> 3. Consider running full regression suite overnight"

---

### 9. Updating Test Priority Based on Feature Importance

**Context:** A feature that was low priority is now critical for a key customer.

**User prompt:**
> "The PDF export feature is now critical for Enterprise customers. Update all PDF-related tests to high priority."

**What the AI does:**
1. Searches for all PDF-related tests
2. Updates each to high priority

**Tool call (search):**
```json
{
  "filter": {
    "title": {
      "filterType": "text",
      "type": "contains",
      "filter": "PDF"
    }
  }
}
```

**Tool calls (update each):**
```json
{"id": 1601, "priority": 2}
{"id": 1602, "priority": 2}
{"id": 1603, "priority": 2}
```

**Example response:**
> "Updated 3 test cases to high priority:
> - TC-1601: 'PDF export - basic document generation' - was Normal, now High
> - TC-1602: 'PDF export - include images and charts' - was Low, now High
> - TC-1603: 'PDF export - handle large documents' - was Normal, now High"

---

### 10. Creating Tests from API Documentation

**Context:** New API endpoint was added and needs test coverage.

**User prompt:**
> "We added a new endpoint `POST /api/v2/orders/bulk` that accepts an array of orders. Create test cases for: valid bulk create, validation errors, partial success, and rate limiting."

**Tool calls:**
```json
// Valid bulk create
{
  "title": "API - POST /api/v2/orders/bulk - successful bulk order creation",
  "priority": 2,
  "steps": [
    {"step": "Prepare array of 5 valid order objects", "expected_result": "Valid JSON array created"},
    {"step": "Send POST request to /api/v2/orders/bulk with valid auth", "expected_result": "Request accepted"},
    {"step": "Verify response status", "expected_result": "201 Created"},
    {"step": "Verify response body contains created order IDs", "expected_result": "Array of 5 order IDs returned"},
    {"step": "Query each order ID", "expected_result": "All 5 orders exist in database"}
  ]
}

// Validation errors
{
  "title": "API - POST /api/v2/orders/bulk - validation error handling",
  "priority": 1,
  "steps": [
    {"step": "Prepare array with one invalid order (missing required field)", "expected_result": "Array with invalid item"},
    {"step": "Send POST request", "expected_result": "Request processed"},
    {"step": "Verify response status", "expected_result": "400 Bad Request"},
    {"step": "Verify error response identifies invalid item index", "expected_result": "Error message includes 'orders[2].customerId is required'"}
  ]
}

// Partial success
{
  "title": "API - POST /api/v2/orders/bulk - partial success with mixed validity",
  "priority": 1,
  "steps": [
    {"step": "Prepare array of 5 orders, 2 with duplicate order numbers", "expected_result": "Mixed valid/invalid array"},
    {"step": "Send POST request", "expected_result": "Request processed"},
    {"step": "Verify response status", "expected_result": "207 Multi-Status"},
    {"step": "Verify response body shows success for 3, failure for 2", "expected_result": "results array with status per item"}
  ]
}

// Rate limiting
{
  "title": "API - POST /api/v2/orders/bulk - rate limiting enforced",
  "priority": 1,
  "steps": [
    {"step": "Send 10 bulk requests in rapid succession", "expected_result": "First requests succeed"},
    {"step": "Continue sending requests", "expected_result": "429 Too Many Requests after limit"},
    {"step": "Verify Retry-After header present", "expected_result": "Header indicates wait time"},
    {"step": "Wait for rate limit window to reset", "expected_result": "Subsequent requests succeed"}
  ]
}
```

---

### 11. Creating a Test Plan for a Sprint

**Context:** Sprint starts Monday and the QA lead needs a test plan with relevant cases assigned to the team.

**User prompt:**
> "Create a test plan called 'Sprint 14 Regression' with all high-priority test cases. Assign it round-robin to the QA team."

**What the AI does:**
1. Lists high-priority test cases to get their IDs
2. Creates a test plan with those cases and automatic assignment

**Tool calls:**
```json
// Step 1: Find high-priority cases
// list_test_cases with filter: priority = 2

// Step 2: Create the plan
{
  "title": "Sprint 14 Regression",
  "priority": 2,
  "start_date": "2026-02-23",
  "end_date": "2026-03-06",
  "test_cases": {
    "test_case_ids": [101, 102, 103, 104, 105]
  },
  "assignment": {
    "executor": "team",
    "assignment_criteria": "testCase",
    "assignment_method": "automatic",
    "user_ids": [27, 31, 45]
  }
}
```

---

### 12. Updating Test Plan Status After Execution

**Context:** QA finished running a test plan and wants to mark it as complete.

**User prompt:**
> "Mark the 'Sprint 13 Regression' test plan as finished and move it to the Archive folder."

**What the AI does:**
1. Finds the test plan by title
2. Updates its status and folder

**Tool call:**
```json
{
  "id": 812,
  "status": "finished",
  "test_plan_folder": "Archive",
  "archived": true
}
```

---

### 13. Organizing Suites for a New Module

**Context:** Developer is starting work on a new Payments module and needs a suite structure.

**User prompt:**
> "Create a suite hierarchy for the Payments module: parent suite 'Payments', with child suites 'Checkout Flow', 'Refunds', and 'Subscription Billing'."

**What the AI does:**
1. Creates the parent suite
2. Creates three child suites under it

**Tool calls:**
```json
// Step 1: Create parent
{ "title": "Payments" }
// Returns: { "id": 50 }

// Step 2: Create children
{ "title": "Checkout Flow", "parent_id": 50 }
{ "title": "Refunds", "parent_id": 50 }
{ "title": "Subscription Billing", "parent_id": 50 }
```

---

### 14. Reorganizing Suite Structure

**Context:** Team decides to restructure suites — moving a suite under a different parent and reordering.

**User prompt:**
> "Move the 'Email Notifications' suite under 'Settings', and reorder Settings children so 'Email Notifications' comes first."

**What the AI does:**
1. Moves the suite using `move_suite`
2. Reorders children using `reorder_suites`

**Tool calls:**
```json
// Step 1: Move suite
// move_suite: { "id": 34, "parent_id": 20 }

// Step 2: Reorder children of Settings (suite 20)
// reorder_suites: { "parent_id": 20, "suite_ids": [34, 21, 22, 23] }
```

---

## Filter Quick Reference

| Goal | Filter JSON |
|------|-------------|
| High priority | `{"priority": {"filterType": "number", "type": "equals", "filter": 2}}` |
| Normal priority | `{"priority": {"filterType": "number", "type": "equals", "filter": 1}}` |
| Low priority | `{"priority": {"filterType": "number", "type": "equals", "filter": 0}}` |
| Title contains "X" | `{"title": {"filterType": "text", "type": "contains", "filter": "X"}}` |
| High failure rate | `{"failure_rate": {"filterType": "number", "type": "greaterThan", "filter": 0.15}}` |
| Automated tests | `{"is_automated": {"filterType": "number", "type": "equals", "filter": 1}}` |
| Manual tests | `{"is_automated": {"filterType": "number", "type": "equals", "filter": 0}}` |
| Never run | `{"run_count": {"filterType": "number", "type": "equals", "filter": 0}}` |
| Updated after date | `{"updated_at": {"filterType": "date", "type": "greaterThan", "dateFrom": "2026-01-01"}}` |
| Failing tests | `{"last_run_status": {"filterType": "number", "type": "equals", "filter": 2}}` |

## Sort Quick Reference

| Goal | Sort JSON |
|------|-----------|
| Most recently updated | `[{"colId": "updated_at", "sort": "desc"}]` |
| Highest priority first | `[{"colId": "priority", "sort": "desc"}]` |
| Most runs first | `[{"colId": "run_count", "sort": "desc"}]` |
| Highest failure rate | `[{"colId": "failure_rate", "sort": "desc"}]` |
| Alphabetical by title | `[{"colId": "title", "sort": "asc"}]` |

## Priority Values

| Value | Meaning |
|-------|---------|
| 0 | Low |
| 1 | Normal |
| 2 | High |
