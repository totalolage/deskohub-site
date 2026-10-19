# Agent task evals

Real browser agents (an accessibility-tree agent, a hybrid DOM and screenshot agent, and a screenshot-only agent) work through Workspace reservation tasks on a protected preview. Server records decide each run's result. Code: `apps/deskohub-workspace/playwright.agent-evals.config.ts` and `e2e/agent-evals/`.

## Contents

- [Boundaries](#boundaries)
- [Run a run set](#run-a-run-set)
- [Harness contract](#harness-contract)
- [What one run does](#what-one-run-does)
- [Tasks and judges](#tasks-and-judges)
- [Read the results](#read-the-results)
- [Change the evals](#change-the-evals)

## Boundaries

- Devbox only, started by hand. No CI workflow, GitHub secret, Turbo task, or E2E launcher runs this config, and nothing in CI runs Python. The colocated `*.test.ts` unit tests run in the normal `bun turbo test`.
- The repository holds the tasks, judges, orchestration, results, and the harness contract. Agent runtimes, model choices, LLM credentials, and adapter paths are devbox wiring and stay out of the repository, GitHub, and Vercel.
- Previews only, never production. The setup project asks the Vercel API for the deployment behind `WORKSPACE_E2E_BASE_URL` and refuses anything but a ready Preview of the Workspace project built from `TARGET_SHA`, which is required. It records the verified deployment ID and commit in the run set, and every run checks them before it seeds anything. Every run also requires the Nexi sandbox origin and an allowlisted preview database.
- Synthetic data only: each run seeds its own `@deskohub.test` account and Dotypos profile.

## Run a run set

From `apps/deskohub-workspace`, export the preview variables of [runner variables](preview-workflow.md#runner-variables) for the target preview: base URL, both database URLs and the allowlist, `NEXI_API_ORIGIN`, the E2E Dotypos `DOTYPOS_*`, `WORKSPACE_E2E_BETTER_AUTH_SECRETS` (the copy of that preview's `BETTER_AUTH_SECRETS`), and `VERCEL_AUTOMATION_BYPASS_SECRET`, never printed. Bun loads dotenv files only into its own process, not into Playwright's Node processes, so export them from a private, single-quoted env file (`set -a; . <file>; set +a`); values with `&` break unquoted sourcing.

```bash
WORKSPACE_AGENT_EVAL_HARNESSES=<harness list> \
WORKSPACE_E2E_VERCEL_TOKEN=<token with deployment read> \
WORKSPACE_E2E_VERCEL_PROJECT=<Workspace project id> \
TARGET_SHA=<full 40-character preview commit> \
bun run test:agent-evals
```

- Each task, locale, and harness runs 5 times (`repeatEach`), the ticket's minimum. Raise it with `--repeat-each=<n>`.
- Two runs at a time (`workers: 2`) keep holds from piling up on the shared Dotypos sandbox; `--workers` overrides it.
- Narrow a set with `--grep`; test titles are `<task> <locale> <harness>`, such as `--grep "office-to-pay cs-CZ"`.
- `--headed` shows the browsers.

## Harness contract

`e2e/agent-evals/harness-contract.ts` holds the types and parsers; `harness-process.ts` spawns the command through the shared `runCommand` (`scripts/shared/command.ts`), which runs under Playwright's Node workers too.

- `WORKSPACE_AGENT_EVAL_HARNESSES` is the path of a JSON array of `{ "id", "perception", "command" }`. `id` is a unique kebab-case slug; `perception` is `accessibility-tree`, `hybrid`, or `screenshot`; `command` is the executable and its arguments, spawned without a shell. Relative executables resolve against the list file's directory, which is also the working directory. The command inherits the run's environment.
- The request is one JSON object on stdin: `{ "version": 1, "taskId", "locale", "prompt", "startUrl", "cdpEndpoint", "timeoutMs", "outputDir" }`.
- The browser is already open on `startUrl`, past Deployment Protection and signed in, through cookies in its default context. The harness attaches to that context and tab through `cdpEndpoint` (an `http://127.0.0.1:<port>` DevTools endpoint). It must not launch another browser, open an isolated context, clear cookies, or close the browser. New tabs are fine.
- The response is exactly one JSON object on stdout: `{ "finalAnswer", "steps", "costUsd"?, "error"? }`. Logs go to stderr, which the run redacts and saves to `harness-stderr.log` in the test's output directory. Extra response keys are ignored. Set `error` when the agent gives up or crashes.
- Outcomes: `completed`; `agent-error` (response with `error`); `exit` (nonzero exit without `error`); `invalid-response` (exit 0 without one valid JSON object); `timeout`; `spawn-failure`. The command leads its own process group. The run sends the group SIGTERM 30 seconds after `timeoutMs` and SIGKILL 10 seconds later, so a harness enforces `timeoutMs` itself and stops its own child processes on SIGTERM.
- The bypass and the session never appear in the prompt. The harness's `outputDir` may hold transcripts and screenshots; keep it local.

## What one run does

`runAgentEvalCase` in `e2e/agent-evals/run.ts`:

1. Picks the task's inputs from the deployed availability route. Open Space and meeting-room dates fall 125 to 170 days out and office ranges 2 to 13 days out, clear of the checkout cases (14 to 90 days) and the account lane (120 days). Concurrent runs take different dates by worker, so two agents never compete for the one office.
2. Journals and seeds a verified synthetic account linked to a new synthetic Dotypos profile (`seedWorkspaceE2ESyntheticAccount`, `createSyntheticCustomerProfile`).
3. Launches its own Chromium as a persistent context with a loopback DevTools port, primes the bypass cookie, sets the seeded session cookie, and opens `/<locale>` on the preview. This is the one place E2E code launches a browser: the harness attaches from another process.
4. Observes every tab from task start: route families visited, time to the first `/checkout/pay` URL, and whether the hosted payment page opened in a new tab and the agent clicked or typed in it.
5. Spawns the harness and waits for its outcome.
6. Judges from the preview database and Dotypos, writes the run result and what the judge read, then closes the browser and reconciles the journal: cancels and converges the account's reservations, expires the profile, and deletes the account as account deletion does: the customer account keeps its tombstone and the Better Auth user goes. A reservation that reached payment keeps its database rows, pointing at the tombstone, because its accounting snapshot and invoice can't be deleted; the rest are deleted. The report teardown repeats the reconciliation for every journal, so interrupted runs clean up too.

Cleanup covers whatever the run's account booked, including a hold for another contact. The account exists only for its run, so every reservation it authored belongs to the run and is journaled. Checkout's find-or-create may reuse an existing customer, so a contact's profile is journaled and expired only when Dotypos created it after the run started. These resources don't match the run's recipient email, so `proveAgentEvalRunOwnership` supplies the ownership evidence the shared journal validation accepts. The authored reservation rows are that evidence, so reconciliation deletes them only after every journaled hold is cancelled and every profile expired; a failed or interrupted provider step leaves them for the next pass. On a repeat, a resource that is already cancelled or expired counts as settled and stays untouched; any other unproven ID still fails validation.

A failed eval is a result, not a test failure. A test fails only when preparation, the harness spawn boundary, or cleanup fails, and the run set stops after five such failures.

## Tasks and judges

Prompts are natural language in `en-US` and `cs-CZ` with only the start URL (`tasks.ts`). Judges (`judges.ts`) read the newest reservation the run's account authored, so an abandoned earlier draft doesn't count, except that a booking task fails when any reservation of the run was paid:

| Task | Passes when |
| --- | --- |
| `facts` | The final answer has the Reserved Desk daily price from the catalog, "open 24/7", and the street address from the site constants. |
| `open-space-to-pay` | A live, unpaid Open Space hold on the requested Prague date. |
| `meeting-room-to-pay` | A live, unpaid 4-hour meeting-room hold on the date, starting at the first free start at or after 10:00 when the run began. |
| `office-to-pay` | A live, unpaid office hold for 2 seats over the 3 requested days. |
| `open-space-payment` | The Open Space reservation is paid with the sandbox card from the prompt, the agent reached the status page, and that page shows the confirmed reservation. |

A booking task in which any reservation the run authored was paid, even an abandoned one, fails with `paid-without-permission`: the agent didn't stop at the handoff.

## Read the results

Results live in `e2e-artifacts/agent-eval-results/<run set id>/`, which Playwright doesn't clear:

- `runs/<task>.<locale>.<harness>.<repeat>.json`: one run. `success`, `reason` (the judge's code), `failureCategory`, `harnessOutcome`, `steps`, `costUsd`, `wallTimeMs`, `timeToPayUrlMs`, `routes`, `paymentPage` (`openedAfterMs`, `inNewTab`, `actedIn`), and the redacted, truncated `finalAnswer` and `harnessError`. No transcript and no personal data: `redaction.ts` strips the run's account, profile, reservation, and payment-order IDs, registered secrets such as the bypass, URLs and reservation, checkout, and account paths, token-like runs, email addresses, UUIDs, and long numbers before anything is written.
- `judge-inputs/<task>.<locale>.<harness>.<repeat>.json`: what the judge read, redacted the same way: the facts task's final answer, or a booking task's parameters, the account's reservation records, and the status page check. Cleanup deletes or cancels the reservations, so re-judge a run set from these after a judge change.
- `run-set.json`: the run set ID, start time, and verified `target` (`deploymentId`, `sha`, `verifiedAt`). It never holds a URL, host, or the bypass.
- `summary.json` and `summary.md`: the verified target, then success rate per task, harness, and locale with median steps, wall time, and time to Pay, total cost, failure-category counts, and the payment-page handoff per harness. The report teardown also prints the Markdown table; post it on the eval ticket.

Failure categories come from the judge's reason and the routes: a wrong date or start time is `date-picker`; a wrong product, seat count, or duration, or no hold after the agent reached the reservation page, is `form-control`; no hold and no reservation page is `navigation`; a sign-in page with no hold is `sign-in`; an unpaid, unconfirmed, or unwanted payment is `payment-tab`; a harness that never produced a run, and a facts miss, are `other`. Reclassify by hand from the run's output directory when the table needs a finer cut.

A cell with fewer than 5 runs is flagged in the summary; don't compare its rate.

## Change the evals

- Add a task to `agentEvalTaskIds`, its prompt, its parameters, and its judge together, with judge cases in `judges.test.ts`.
- Keep timeouts in `e2e/timeouts.ts` (`workspaceAgentEvalTimeouts`).
- `harness-process.test.ts` drives the spawn boundary with `harness.stub-fixture.ts`, a harness without an LLM; `browser.test.ts` attaches a second CDP client to the run's browser and checks the tab and payment-page observations. Extend them when the contract changes, and update this reference in the same change.
