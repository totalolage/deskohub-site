import type {
  CampaignOperations,
  LedgerOperationName,
  OperationConflict,
  OperationDecodedInput,
  OperationInProgress,
  OperationOutput,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { Context, type Effect, Layer } from "effect";

type CampaignLedgerOperationName = LedgerOperationName<CampaignOperations>;

/** A ledger operation with its decoded input, which carries a `requestId`. */
export type OperationLedgerRequest = {
  readonly [Name in CampaignLedgerOperationName]: {
    readonly operation: Name;
    readonly input: OperationDecodedInput<CampaignOperations[Name]>;
  };
}[CampaignLedgerOperationName];

type OperationLedgerEntry<
  Name extends CampaignLedgerOperationName,
  E,
  R,
> = Extract<OperationLedgerRequest, { readonly operation: Name }> & {
  /** Writes only through the Workspace database; it joins the transaction. */
  readonly apply: Effect.Effect<
    OperationOutput<CampaignOperations[Name]>,
    E,
    R
  >;
};

interface IOperationRequestLedger {
  /**
   * Applies a creation at most once per caller and request ID, so a
   * retried request replays the first result instead of creating again.
   */
  readonly applyOnce: <Name extends CampaignLedgerOperationName, E, R>(
    entry: OperationLedgerEntry<Name, E, R>
  ) => Effect.Effect<
    OperationOutput<CampaignOperations[Name]>,
    E | OperationInProgress | OperationConflict | OperationUnavailable,
    R
  >;
}

/**
 * Where a campaign operation records its request ID. Each adapter provides
 * its own: the CLI keeps one per session, and the admin UI applies directly
 * because server actions aren't retried automatically.
 */
export class OperationRequestLedger extends Context.Service<
  OperationRequestLedger,
  IOperationRequestLedger
>()("@deskohub-workspace/email-campaigns/OperationRequestLedger") {
  /** Applies every request; the caller never retries one on its own. */
  static unscoped = Layer.succeed(this, {
    applyOnce: ({ apply }) => apply,
  });
}
