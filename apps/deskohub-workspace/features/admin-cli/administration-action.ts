import { Context, type Effect } from "effect";

/**
 * How an administration request ended. It describes the request, not
 * whether state changed: a request that failed or was interrupted may still
 * have changed something before it ended.
 *
 * - `started`: still running, or it ended without a recorded outcome.
 * - `succeeded`: the operation returned its result.
 * - `replayed`: the administration mutation ledger returned the stored
 *   result of an earlier request with the same request ID.
 * - `failed`: the operation failed with a declared error.
 * - `defect` and `interrupted`: it died or was interrupted.
 */
export const administrationActionOutcomes = [
  "started",
  "succeeded",
  "replayed",
  "failed",
  "defect",
  "interrupted",
] as const;
export type AdministrationActionOutcome =
  (typeof administrationActionOutcomes)[number];

/**
 * The administration action the current request records. The mutation
 * ledger reports through it that the request replayed a stored result.
 */
export class CurrentAdministrationAction extends Context.Service<
  CurrentAdministrationAction,
  { readonly markReplayed: Effect.Effect<void> }
>()("@deskohub-workspace/admin-cli/CurrentAdministrationAction") {}
