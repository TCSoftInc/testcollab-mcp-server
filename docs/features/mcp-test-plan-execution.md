# MCP test plan execution (TCV-7109)

An assistant can create a tagged test plan, read its cases, and record results
with small evidence files through MCP. This supports teams that allow an MCP
connection and do not provide a terminal for the TestCollab CLI.

## API flow and decisions

`src/tools/test-plans/` holds four tool handlers and their shared input schemas.
`src/tools/index.ts` registers them on both transports. The schemas used for
discovery also validate handler input, so documented limits match validation.

- `create.ts`: extend the existing creation flow with `test_cases.tag_id` or
  `test_cases.tag_name`. Resolve an exact project tag before creating a plan,
  bulk-add matching cases, then run the existing assignment flow. It preserves
  case IDs/selectors, optional configurations, user-name/"me" resolution,
  releases, folders and custom fields. Sends
  `override_existing_assignees: false` by default, as `tc createTestPlan` does.
  Bulk-add omits an explicit assignee unless overriding, so default assignees
  can be inherited first. A later setup failure reports the created plan ID.
- `cases.ts`: check plan and optional run scope, paginate plan cases and
  configurations, and fetch active status system names. A supplied run ID also
  fetches the token owner's assigned executions. Execution instructions use the
  revision snapshot; plan cases describe the current library cases.
- `report.ts`: validate active statuses, resolve executions, update results,
  add time in milliseconds, and attach files. Batch input is resolved before
  writes, including duplicate and ambiguous configuration checks. It targets
  caller assignments, merges custom fields while retaining the plan title, and
  reports API failures explicitly. Omitted assignments are skipped only after
  supplied results succeed. Individual skip writes keep the selected run and
  MCP provenance; the API's bulk skip action targets the latest run.
- `attachments.ts`: reject HTTP paths before filesystem access. Read regular
  local files within a 10 MB cap, or validate and decode at most 1 MB of standard
  padded base64. Maximum 10 files per execution. Uploads include the project's
  company, then `updateAttachments` links and merges the returned IDs.

`src/client/api-client.ts` makes direct API requests for these flows. This keeps
assignment options, custom fields, and execution provenance from being dropped
by the published SDK's serializers. It rejects HTTP errors and HTTP 200 failure
envelopes and redacts the API token from errors.

The existing API source vocabulary has no `mcp` value. Results therefore record
`execution_source: api` and `execution_context: {tool: "tc-mcp-server",
tool_version: "1.0.0"}`, consistent with CLI provenance. The API stamps
`executed_by` from the user's credential. There is no executor input.

## Permissions and operation

All operations use existing TestCollab endpoints and the caller's API token.
The API's existing project membership, role, execution, custom field, and upload
checks apply. No API endpoints, database models, permissions, feature flags, or
UI components were added. `src/http-server.ts` adds Streamable HTTP through the
same tool/resource registry as stdio. HTTP credentials remain request-scoped
through `src/context.ts`, tokens are required in headers, session credentials
are pinned, and body size is bounded for the permitted evidence payload.

Invalid inputs are checked before result writes, but a result and its time or
evidence updates are separate API operations. An error after a saved result says
which later operation failed. Batch output lists confirmed results and errors;
it must be checked before retrying. Time is additive, so blindly replaying a
partially completed request can add time twice.

## Verification

Use Node 20 or newer:

```bash
npm run build
npm run typecheck
npm test -- --run --pool=forks --maxWorkers=1 --minWorkers=1
```

Unit tests verify actual handler API payloads, tag ID/name selection, default
assignee preservation and override, pagination past 100 cases, revision steps,
custom statuses, comments, time, configuration matching, custom field retention,
failure envelopes, partial failures, provenance, token redaction, and file limits.
Existing plan and project-context tests run alongside the new execution tests.
Transport tests launch real stdio and HTTP MCP servers against a local API
fixture. They verify discovery, local multipart files, hosted base64 files, and
HTTP path refusal and required token headers. They check existing tools and
resources remain registered and close clients and servers.

For a live development check, use `http://localhost:1337` and the local Enterprise
account. Create two cases with a unique tag: one with a default assignee and one
without. Create a plan by tag name and verify inherited/fallback assignments.
Read its run and report one assigned execution with steps, a comment, time, and
a small base64 log. Check the persisted executor, status, time, MCP context, and
attachment. Refuse a `file_path` through HTTP. Create another plan by tag ID with
override enabled, report one case, and skip the omitted assignment.

For matrix coverage, create a plan with two configurations before assignment.
Assign both to the caller, read both execution IDs, reject a result lacking its
configuration, then report distinct statuses for each configuration. Include a
project custom status and a test-plan custom field; verify both values persisted
through the existing API. Never run this check against production.
