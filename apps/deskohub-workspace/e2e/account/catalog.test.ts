import { test } from "bun:test";
import { Effect } from "effect";
import {
  workspaceE2EAccountCaseIds,
  workspaceE2EAccountMagicLinkLedger,
} from "./catalog";
import {
  type MagicLinkOperation,
  makeMagicLinkRateBudget,
} from "./rate-budget";

const laneOperations: readonly MagicLinkOperation[] =
  workspaceE2EAccountCaseIds.flatMap(
    (caseId) => workspaceE2EAccountMagicLinkLedger[caseId]
  );

test("the real budget admits the whole account lane ledger without a quiet-window wait", async () => {
  // A frozen clock keeps every operation inside one rate window, so any
  // over-budget operation reaches the not-ready retry and fails the lane.
  const budget = makeMagicLinkRateBudget({
    now: () => 0,
    retryAfterNotReady: () =>
      Effect.die(new Error("the account lane would wait out a quiet window")),
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      for (const operation of laneOperations) {
        yield* budget.run(operation, Effect.void);
      }
    })
  );
});
