# MCP test case review feedback (TCV-7191)

An assistant can read the review feedback on test cases through MCP: the review status,
the author, the reviewer or reviewer group, the review comments and a link to each case.
It can read one case or list a project, with the latest review by default, optional
history, a filter for cases with comments, and pagination. The tool is read-only.

Audience and job: a tester or QA engineer keeps test cases and fixes the cases that a
reviewer sent back; a QA lead checks what reviewers said across a project.

## How it works

`src/tools/test-cases/reviews.ts` holds the `get_test_case_reviews` schema and handler.
`src/tools/index.ts` registers it. It uses two existing endpoints and the caller's token:

- **Project list** (`test_case_id` omitted): `POST /testcases/aggrid`, the query of the
  Test Cases page, sorted by `updated_at desc, id desc`, in windows of at most 100 cases.
  A current revision with a review supplies its review data directly. Otherwise, read
  that case's newest revision with `review_status > 0`, using the same one-case query
  below. Never filter the grid by current review status: that would exclude rejected
  edits after restoration. Archived and trashed cases are left out, as on the Test Cases
  page. Historical lookups run at most five at a time and stop once the result limit is met.
- **One case** (`test_case_id`): `GET /testcaserevisions` with `testcase`,
  `review_status_gt=0` and `_sort=id:DESC`. The newest revision with a review status is
  the latest review. If the case has no review, `GET /testcases/:id` confirms the case and
  its project, and the response has `latestReview: null`.
- **History** (`include_history`): `GET /testcaserevisions` with
  `filter={"testcase_in":[...]}` and `review_status_gt=0` for the cases of the response,
  read in pages of 100. History holds the review rounds older than the latest review.
- **Comment authors**: a comment stores only a user ID. Names come from the users on the
  revision (author, reviewer, creator). Other IDs, such as an admin who changed the
  reviewer, are read once from `GET /projectusers`.

Review status codes are the ones in tc-api: 1 `review_pending`, 2 `approved`,
3 `update_requested`, 4 `rejected`.

## Decisions and trade-offs

- **The latest review is not always the current revision.** When a reviewer rejects an
  edit of an existing case, tc-api restores the earlier version as a new current revision
  without a review, and the rejection and its comments stay on the revision of the edit.
  A one-case read therefore reads the revisions and returns that rejection with
  `isCurrentRevision: false`.
- **The project list also includes historical reviews.** A rejected edit and its comments
  remain discoverable without knowing the case ID first. The grid provides a bounded
  page of visible case IDs; each missing review is looked up by case ID with `_limit=1`.
  This avoids a project-wide revision query, which can copy large revision records into
  a temporary table before applying the limit. Current review data needs no extra lookup;
  historical lookups and optional history queries always filter by case ID.
- **Pagination uses `offset` and `nextOffset`**, like `list_test_cases`. With
  or without `only_with_comments`, one call checks at most 100 visible cases and the
  tool filters out cases without a review. `only_with_comments` checks the latest review's
  comments, including a historical rejection. `nextOffset` points after the last case
  checked, so a page can be empty or hold fewer than `limit` cases while more pages remain.
  Continue until `nextOffset` is null. `totalCases` counts all visible cases, not matching
  reviews; an exact reviewed-case total would require scanning the whole project.
- **Comments are plain text.** tc-api stores author and system comments as `escape()`d
  editor HTML and reviewer decisions as plain text; the review panel shows
  `unescape(comment)` as HTML. The tool applies `unescape`, turns paragraph ends and line
  breaks into new lines, writes a link as `text (url)`, removes the other tags and decodes
  HTML entities.
- **Links are built in the MCP server.** No endpoint returns the app URL. The tool removes
  the `api.` or `api-<region>.` label from the `TC_API_URL` host
  (`https://api.testcollab.io` and `https://api-eu.testcollab.io` give
  `https://testcollab.io`; one app serves both regions) and maps `http://localhost:1337` to
  `http://localhost:8080`. For any other host the link is null, because a wrong link is
  worse than none. Links use `/project/:projectId/manage/test_cases/:id`, the in-app route
  of the test case list.

No API endpoints, database models, permissions, feature flags or UI components change.
The API applies its existing project and role checks to the token.

## QA

Automated: `npm run typecheck` and
`npm test -- --run --pool=forks --maxWorkers=1 --minWorkers=1`.
`tests/unit/test-case-reviews.test.ts` covers the link mapping, comment text, a rejected
edit with history, a case without reviews, a case from another project, the grid request
and pagination, `only_with_comments`, history in a project list and input validation.
Regressions cover rejected edits in project results with and without history, continuing
after an empty page, filtering the latest review's comments and bounded concurrency.
The stdio tests in `tests/integration/test-plan-transports.test.ts` discover the tool and
read both a single review and a project containing a rejected edit through a real MCP client.

Manual check against a local stack (`http://localhost:1337`, never production):

1. In a project with review turned on, create a case as one user with a reviewer and an
   author comment. As the reviewer, request changes with a comment. As the author, edit the
   case with a comment. As the reviewer, approve it.
2. Edit the same case again as the author and send it for review. As the reviewer, reject
   it with a comment. The case returns to the approved version.
3. Create a second case for review without a comment, a third that a reviewer group
   reviews, and a fourth whose reviewer an admin changes.
4. Call `get_test_case_reviews` with the first case's `test_case_id` and
   `include_history: true`. Expect `latestReview.status: "rejected"`,
   `isCurrentRevision: false`, both comments as plain text, and the approved round with
   four comments in `history`.
5. Call it without `test_case_id`. Expect all four cases, including the first case's
   rejection, the group name, and the admin's "Reviewer changed to ..." comment with
   the admin's name. `totalCases` counts all visible cases, including any never reviewed.
   Call it with `limit: 1`, then pass each `nextOffset` back as `offset` until it is null,
   even if an intermediate page is empty. With `only_with_comments: true`, expect the
   case without comments to be left out and the rejected edit's comments to remain.
6. Open each `url`; it opens the case in the Test Cases page.
