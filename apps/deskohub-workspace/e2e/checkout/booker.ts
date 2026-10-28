import { createHash } from "node:crypto";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { makeWorkspaceE2ECaseIdentities } from "../account/case-identities";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { executeCheckoutFlow } from "../cases/checkout";
import { getConfig, getDatasourceConfig } from "../config";
import { toWorkspaceE2EError } from "../errors";
import {
  isWorkspaceE2EReferralCaseId,
  type WorkspaceE2ECaseId,
  workspaceE2ECaseIds,
} from "../playwright-checkout/case-catalog";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import { bindCheckoutContact } from "../referrals/checkout";
import type { CheckoutFlowState, WorkspaceE2ECaseContext } from "../types";
import { checkoutFlows } from "./data";

/**
 * Checkout needs a signed-in account with a verified email, so every case
 * that submits a reservation signs its own session in as a seeded synthetic
 * booker: a verified account linked to its own synthetic profile, seeded
 * without a magic link. Bookers book for someone else, the case's own planned
 * contact, so each order keeps its unique customer, except the plain
 * checkout flows, which book as the account.
 *
 * Cases that never submit a reservation stay signed out, and referral cases,
 * the someone-else referral payment, the signed-out verification case, and
 * the agent booking own their identities.
 */
const signedOutCaseIds = [
  "contact-form",
  "locale-switch",
  "reservation-url-state-cowork",
  "reservation-url-state-meeting-room",
  "reservation-url-state-office",
  "reservation-url-state-office-starts-on-link",
] as const satisfies readonly WorkspaceE2ECaseId[];

const ownIdentityCaseIds = [
  "checkout-agent-booking",
  "checkout-referral-someone-else",
  "checkout-signed-out-verification",
] as const satisfies readonly WorkspaceE2ECaseId[];

export const workspaceE2ECheckoutBookerCaseIds: readonly WorkspaceE2ECaseId[] =
  workspaceE2ECaseIds.filter(
    (caseId) =>
      !isWorkspaceE2EReferralCaseId(caseId) &&
      !(signedOutCaseIds as readonly string[]).includes(caseId) &&
      !(ownIdentityCaseIds as readonly string[]).includes(caseId)
  );

const isCheckoutBookerCaseId = (caseId: string) =>
  (workspaceE2ECheckoutBookerCaseIds as readonly string[]).includes(caseId);

/**
 * The booker's closed recipient label. Case ids are too long for an email
 * local part and some carry uppercase locales, so the label is a short,
 * stable digest of the id.
 */
export const workspaceE2ECheckoutBookerLabel = (caseId: string) =>
  `bk-${createHash("sha256").update(caseId).digest("hex").slice(0, 10)}`;

const checkoutBookerJournalOwnerId = (caseId: string) =>
  `booker-${workspaceE2ECheckoutBookerLabel(caseId)}`;

export const workspaceE2ECheckoutBookerJournalOwners: readonly WorkspaceE2EAccountJournalOwner[] =
  workspaceE2ECheckoutBookerCaseIds.map((caseId) => ({
    ownerId: checkoutBookerJournalOwnerId(caseId),
    recipientLabels: [workspaceE2ECheckoutBookerLabel(caseId)],
  }));

const accountBookingFlows = new Map(
  checkoutFlows.map((flow) => [`checkout-${flow.id}`, flow])
);

/** Signs the planned case in as its own seeded booker before it runs. */
export const bindWorkspaceE2ECheckoutBooker: WorkspaceE2ECaseBinder = async ({
  environment,
  runId,
  testCase,
}) => {
  if (!isCheckoutBookerCaseId(testCase.id)) return testCase;
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const label = workspaceE2ECheckoutBookerLabel(testCase.id);
  const identities = makeWorkspaceE2ECaseIdentities<string>({
    baseUrl: config.baseUrl,
    datasourceConfig,
    displayName: () => "Workspace E2E Booker",
    journalOwnerId: checkoutBookerJournalOwnerId(testCase.id),
    runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  const signIn = Effect.fn("CheckoutBooker.signIn")(function* ({
    run,
    runStep,
    session,
  }: WorkspaceE2ECaseContext) {
    const booker = yield* runStep({
      execute: identities.seedLinkedAccount(label),
      id: "seed-checkout-booker",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: identities.signIn(booker, { run, session }),
      id: "sign-in-checkout-booker",
      timeoutMs: config.timeouts.datasource,
    });
  });

  const flow = accountBookingFlows.get(testCase.id);
  if (!flow) {
    return {
      ...testCase,
      execute: Effect.fn("CheckoutBooker.execute")(function* (
        context: WorkspaceE2ECaseContext
      ) {
        yield* signIn(context);
        yield* testCase.execute(context);
      }),
    };
  }

  // The plain checkout books as the account: its planned order carries the
  // booker's contact before the journal records it.
  const [state] = testCase.checkoutStates;
  if (!state || testCase.checkoutStates.length !== 1) {
    throw new Error(`planned ${testCase.id} checkout is incomplete`);
  }
  const boundState: CheckoutFlowState = {
    data: bindCheckoutContact(state.data, identities.describe(label)),
  };
  return {
    ...testCase,
    checkoutStates: [boundState],
    execute: Effect.fn("CheckoutBooker.executeAccountBooking")(function* (
      context: WorkspaceE2ECaseContext
    ) {
      yield* signIn(context);
      yield* executeCheckoutFlow({
        config,
        data: boundState.data,
        datasourceConfig,
        flow,
        run: context.run,
        runStep: context.runStep,
        session: context.session,
        state: boundState,
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError((cause) =>
          toWorkspaceE2EError(`run ${flow.id} checkout e2e case`, cause)
        )
      );
    }),
  };
};
