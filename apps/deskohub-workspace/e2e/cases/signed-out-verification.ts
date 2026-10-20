import { normalizePhoneNumber } from "@deskohub/dotypos";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  getAccountSignInPath,
  getAuthCallbackPath,
  getAuthVerifyPath,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { splitCustomerName } from "@/features/checkout/backend/reservation/dotypos-customer-policy";
import { m } from "@/features/i18n";
import { checkoutContactQueryParam } from "@/features/reservation/reservation-checkout-contact";
import {
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
} from "../account/auth-rows";
import {
  makeWorkspaceE2ECaseIdentities,
  type WorkspaceE2ECaseIdentities,
} from "../account/case-identities";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipientForRunId,
  type WorkspaceE2EAccountConfig,
} from "../account/config";
import { readSyntheticCustomerProfile } from "../account/fixtures";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { resolveWorkspaceE2EPreviewLogs } from "../account/vercel-log-retrieval";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  activateHydratedBrowserElement,
  fillBrowserField,
  openBrowserPage,
  waitForBrowserCondition,
  waitForBrowserReactHandler,
  waitForBrowserText,
  waitForBrowserUrl,
} from "../browser";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
  withCheckoutContactEmail,
} from "../checkout/data";
import {
  continueToReservationContactStep,
  prepareReservationSelection,
  waitForReservationPayPage,
} from "../checkout/payment";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { waitForCheckoutRow } from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import { addRedaction, assert, parseUrl, type Runner } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";

export const signedOutVerificationCaseId = "checkout-signed-out-verification";

const accountRecipientLabel = "sov-account";

type RecipientLabel = typeof accountRecipientLabel;

/**
 * The case's own identity journal: the account the verification signs in
 * and the profile its checkout saves, derived from one run-scoped recipient.
 */
export const signedOutVerificationJournalOwner: WorkspaceE2EAccountJournalOwner =
  {
    ownerId: signedOutVerificationCaseId,
    recipientLabels: [accountRecipientLabel],
  };

const reservationSubmitSelector = "#reservation-submit";
const signInCodeSelector = "#account-sign-in-code";

/**
 * Plans the signed-out checkout on its own cowork date, after every other
 * case has planned its dates. The case pool binds the run-scoped recipient
 * before the case runs.
 */
export const planSignedOutVerificationCase = ({
  allocation,
  availableBasicDates,
  config,
  flowStates,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly flowStates: CheckoutFlowState[];
}): Effect.Effect<WorkspaceE2ECase, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(availableBasicDates, 1, {
      allocation,
      excludedDates: new Set(flowStates.map(({ data }) => data.date)),
      selectionLabel: "signed-out verification",
    });
    const state: CheckoutFlowState = {
      data: makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(dates, 0),
        signedOutVerificationCaseId
      ),
    };
    flowStates.push(state);
    return {
      checkoutStates: [state],
      execute: () =>
        Effect.fail(
          workspaceE2EError(
            `${signedOutVerificationCaseId} must be bound to its run-scoped recipient by the case pool`,
            { operation: "bind signed-out verification case" }
          )
        ),
      id: signedOutVerificationCaseId,
      // Checkout plus the wait for the emailed code or link.
      timeoutMs: config.timeouts.checkoutCase + config.timeouts.authDelivery,
    };
  });

/**
 * Binds the planned case to this run's synthetic recipient: a signed-out
 * visitor types the recipient at the contact step and verifies it before the
 * checkout continues.
 */
export const bindSignedOutVerificationCase: WorkspaceE2ECaseBinder = async ({
  environment,
  run,
  runId,
  testCase,
}) => {
  if (testCase.id !== signedOutVerificationCaseId) return testCase;
  const [state] = testCase.checkoutStates;
  if (!state || testCase.checkoutStates.length !== 1) {
    throw new Error("planned signed-out verification checkout is incomplete");
  }
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const accountConfig = getAccountE2EConfig(environment, runId);
  const boundState: CheckoutFlowState = {
    data: withCheckoutContactEmail(
      state.data,
      makeWorkspaceE2EAccountRecipientForRunId(runId, accountRecipientLabel)
    ),
  };
  const identities = makeWorkspaceE2ECaseIdentities<RecipientLabel>({
    baseUrl: config.baseUrl,
    datasourceConfig,
    displayName: () => boundState.data.name,
    journalOwnerId: signedOutVerificationCaseId,
    run,
    runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  return {
    ...testCase,
    checkoutStates: [boundState],
    execute: ({ runStep, session }) =>
      executeSignedOutVerification({
        accountConfig,
        config,
        datasourceConfig,
        identities,
        run,
        runStep,
        session,
        state: boundState,
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError((cause) =>
          toWorkspaceE2EError("run signed-out verification e2e case", cause)
        )
      ),
  };
};

/**
 * What the signed-out contact step shows besides the contact inputs: the
 * prompt that offers a returning customer the sign-in, and its link.
 */
export const getSignedOutContactPrompt = (locale: CheckoutData["locale"]) => {
  const message = m.reservationSignInPrompt({}, { locale });
  return {
    signInLabel: /<signIn>(.*)<\/signIn>/.exec(message)?.[1] ?? "",
    signInPathname: getAccountSignInPath(locale),
    text: message.replaceAll(/<\/?signIn>/g, ""),
  };
};

/**
 * The reservation page the verified sign-in lands back on: the same page,
 * still on the contact step, carrying the sealed contact.
 */
export const isVerifiedContactReturnUrl = (
  currentUrl: string,
  checkoutUrl: string
) => {
  const current = parseUrl(currentUrl);
  const planned = parseUrl(checkoutUrl);
  return (
    current !== undefined &&
    planned !== undefined &&
    current.origin === planned.origin &&
    current.pathname === planned.pathname &&
    current.searchParams.get("step") === "contact" &&
    Boolean(current.searchParams.get(checkoutContactQueryParam))
  );
};

/**
 * Registers the sealed contact a sign-in carries with the redactor, both on
 * the reservation page it returns to and encoded in the auth callback's
 * return target, before any URL that holds it can reach a log line.
 */
const redactSealedContact = (currentUrl: string) => {
  const url = parseUrl(currentUrl);
  if (!url) return;
  addRedaction(url.searchParams.get(checkoutContactQueryParam) ?? "", true);
  addRedaction(url.searchParams.get(signInCallbackReturnParam) ?? "", true);
};

const isPayPageUrl = (currentUrl: string) =>
  parseUrl(currentUrl)?.pathname.endsWith("/checkout/pay") === true;

type Identities = WorkspaceE2ECaseIdentities<RecipientLabel>;

type SignInConfirmation = "code" | "inbox";

const executeSignedOutVerification = Effect.fn("SignedOutVerification.execute")(
  function* ({
    accountConfig,
    config,
    datasourceConfig,
    identities,
    run,
    runStep,
    session,
    state,
  }: {
    readonly accountConfig: WorkspaceE2EAccountConfig;
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly identities: Identities;
    readonly run: Runner;
    readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
    readonly session: string;
    readonly state: CheckoutFlowState;
  }) {
    const database = yield* E2EDatabase;
    const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(accountConfig);
    const { data } = state;
    const { locale } = data;
    const recipient = data.email;
    const reservationScript = getSubmitCoworkReservationScript(data);
    state.startedAt = new Date();

    yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        yield* prepareReservationSelection({
          prepareScript: reservationScript,
          run,
          session,
          timeoutMs: config.timeouts.checkoutStart,
          timeouts: config.timeouts,
        });
        yield* continueToReservationContactStep({
          run,
          session,
          timeouts: config.timeouts,
        });
      }),
      id: "open-reservation-contact-step",
      timeoutMs: config.timeouts.checkoutStart,
    });
    yield* runStep({
      execute: assertSignedOutContactStep({ config, locale, run, session }),
      id: "assert-signed-out-contact-step",
      timeoutMs: config.timeouts.uiTransition,
    });
    // The same script fills the contact step's inputs from the planned contact.
    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: reservationScript,
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "fill-signed-out-contact",
      timeoutMs: config.timeouts.uiTransition,
    });

    // Submitting seals the contact and sends exactly one sign-in email. It
    // spends one Better Auth magic-link send from the per-IP window this lane
    // shares with the serial account lane, whose ledger already budgets four of
    // the five; with sign-in codes off, opening the link spends one magic-link
    // verify the same way. So the send is never retried, and a failed delivery
    // fails the case.
    const sentAt = yield* runStep({
      execute: Effect.gen(function* () {
        const startedAt = new Date();
        yield* activateHydratedBrowserElement(
          run,
          session,
          reservationSubmitSelector,
          { timeoutMs: config.timeouts.browserAction }
        );
        yield* waitForBrowserUrl({
          description: "sign-in verification modal",
          matches: (currentUrl) =>
            parseUrl(currentUrl)?.pathname === getAuthVerifyPath(locale),
          run,
          session,
          timeoutMs: config.timeouts.uiTransition,
        });
        return startedAt;
      }),
      id: "submit-contact-for-email-verification",
      timeoutMs: config.timeouts.uiTransition,
    });
    const confirmation = yield* runStep({
      execute: waitSignInAccepted({ config, locale, run, session }),
      id: "wait-sign-in-email-accepted",
      timeoutMs: config.timeouts.uiTransition,
    });

    const callbackPath = new URL(getAuthCallbackPath(locale), config.baseUrl)
      .pathname;
    // A verification that lands anywhere leaves its account (and possibly the
    // profile it saved) to suite cleanup, even when a later step fails.
    yield* Effect.gen(function* () {
      if (confirmation === "code") {
        const { code } = yield* runStep({
          execute: previewLogs.retrieveSignInEmail({
            callbackPath,
            excludeLogEntryIds: [],
            recipient,
            startedAt: sentAt,
          }),
          id: "retrieve-sign-in-code",
          timeoutMs: config.timeouts.authDelivery,
        });
        yield* runStep({
          // The code step submits by itself once the sixth digit is in.
          execute: fillBrowserField(run, session, signInCodeSelector, code, {
            timeoutMs: config.timeouts.browserAction,
          }),
          id: "enter-sign-in-code",
          timeoutMs: config.timeouts.browserAction,
        });
      } else {
        const link = yield* runStep({
          execute: previewLogs.retrieveMagicLink({
            callbackPath,
            excludeLogEntryIds: [],
            recipient,
            startedAt: sentAt,
          }),
          id: "retrieve-sign-in-link",
          timeoutMs: config.timeouts.authDelivery,
        });
        yield* runStep({
          execute: openBrowserPage(config, run, session, link, {
            timeoutMs: config.timeouts.browserNavigation,
          }).pipe(Effect.asVoid),
          id: "open-sign-in-link",
          timeoutMs: config.timeouts.browserNavigation,
        });
      }

      yield* runStep({
        // The page may already have continued to the pay page by the time it
        // is polled; reaching it means the return already happened.
        execute: waitForBrowserUrl({
          description: "verified return to the reservation contact step",
          matches: (currentUrl) => {
            redactSealedContact(currentUrl);
            return (
              isVerifiedContactReturnUrl(currentUrl, data.checkoutUrl) ||
              isPayPageUrl(currentUrl)
            );
          },
          run,
          session,
          timeoutMs: config.timeouts.providerTransition,
        }),
        id: "return-to-reservation-contact-step",
        timeoutMs: config.timeouts.providerTransition,
      });
      const accountId = yield* runStep({
        execute: Effect.gen(function* () {
          const foundUserId = yield* findAuthUserIdByEmail(recipient);
          const userId = yield* tryWorkspaceE2ESync(
            "assert verified account",
            () => {
              assert(
                foundUserId,
                "verification created no account for the recipient"
              );
              return foundUserId;
            }
          );
          yield* identities.record({ authUserIds: [userId] });
          return userId;
        }).pipe(Effect.provideService(E2EDatabase, database)),
        id: "journal-verified-account",
        timeoutMs: config.timeouts.datasource,
      });

      const orderId = yield* runStep({
        execute: waitForReservationPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          timeouts: config.timeouts,
        }),
        id: "continue-to-pay-page-after-verification",
        timeoutMs: config.timeouts.checkoutStart,
      });
      yield* runStep({
        execute: Effect.gen(function* () {
          const row = yield* waitForCheckoutRow(datasourceConfig, orderId);
          state.checkoutRow = row;
          const customerId = yield* tryWorkspaceE2ESync(
            "read booked customer",
            () => {
              assert(row.dotypos_customer_id, "booked customer missing");
              return row.dotypos_customer_id;
            }
          );
          yield* identities.journalCustomer(customerId);
          const linkedCustomerId =
            yield* findLinkedDotyposCustomerId(accountId);
          const profile = yield* readSyntheticCustomerProfile(
            datasourceConfig,
            customerId
          );
          yield* tryWorkspaceE2ESync("assert saved checkout profile", () =>
            assertSavedCheckoutProfile({
              contact: data,
              customerId,
              linkedCustomerId,
              profile,
            })
          );
        }).pipe(Effect.provideService(E2EDatabase, database)),
        id: "assert-account-linked-to-booked-profile",
        timeoutMs: config.timeouts.datasource,
      });
    }).pipe(
      Effect.ensuring(
        journalVerifiedIdentities(identities, recipient).pipe(
          Effect.provideService(E2EDatabase, database)
        )
      )
    );
  }
);

const assertSignedOutContactStep = ({
  config,
  locale,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly run: Runner;
  readonly session: string;
}) => {
  const prompt = getSignedOutContactPrompt(locale);
  return waitForBrowserCondition(
    run,
    session,
    "signed-out contact step with the sign-in prompt",
    `(() => {
      const form = document.querySelector(${JSON.stringify(reservationSubmitSelector)})?.closest('form');
      if (!(form instanceof HTMLFormElement)) return false;
      const editable = ['name', 'email', 'phone'].every((name) => {
        const field = form.querySelector('input[name="' + name + '"]');
        return field instanceof HTMLInputElement && !field.readOnly && !field.disabled;
      });
      const normalize = (text) => (text ?? '').replace(/\\s+/g, ' ').trim();
      const prompt = [...document.querySelectorAll('p')].find(
        (element) => normalize(element.textContent) === ${JSON.stringify(prompt.text)}
      );
      const link = prompt?.querySelector('a[href]');
      return editable &&
        link instanceof HTMLAnchorElement &&
        normalize(link.textContent) === ${JSON.stringify(prompt.signInLabel)} &&
        new URL(link.href).pathname === ${JSON.stringify(prompt.signInPathname)};
    })()`,
    { timeoutMs: config.timeouts.uiTransition }
  );
};

/**
 * Waits for the card the accepted sign-in email leaves in the verify modal
 * and reports which one it is: the code step while `login_email_code` is on,
 * the inbox notice otherwise.
 */
const waitSignInAccepted = Effect.fn(
  "SignedOutVerification.waitSignInAccepted"
)(function* ({
  config,
  locale,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly run: Runner;
  readonly session: string;
}) {
  const acceptedTitle = m.accountSignInAcceptedTitle({}, { locale });
  const codeTitle = m.accountSignInCodeTitle({}, { locale });
  const pageText = yield* waitForBrowserText({
    description: "accepted sign-in email",
    matches: (text) => text.includes(acceptedTitle) || text.includes(codeTitle),
    run,
    session,
    timeoutMs: config.timeouts.uiTransition,
  });
  if (!pageText.includes(codeTitle))
    return "inbox" satisfies SignInConfirmation;
  yield* waitForBrowserReactHandler(
    run,
    session,
    signInCodeSelector,
    "onChange",
    { timeoutMs: config.timeouts.browserAction }
  );
  return "code" satisfies SignInConfirmation;
});

/**
 * Journals whatever the verification created for the recipient: its account
 * and the profile linked to it. Best effort, so it never masks the case's
 * own failure; the happy path journals both in its steps.
 */
const journalVerifiedIdentities = Effect.fn(
  "SignedOutVerification.journalVerifiedIdentities"
)(
  function* (identities: Identities, recipient: string) {
    const accountId = yield* findAuthUserIdByEmail(recipient);
    if (!accountId) return;
    yield* identities.record({ authUserIds: [accountId] });
    const customerId = yield* findLinkedDotyposCustomerId(accountId);
    if (customerId) {
      yield* identities.record({ dotyposCustomerIds: [customerId] });
    }
  },
  (effect) => effect.pipe(Effect.ignore)
);

/**
 * The verified account books as the profile its checkout saved: the booked
 * customer is the one linked to the account, carrying the typed name split
 * into first and last name, the typed phone, and the verified email.
 */
export const assertSavedCheckoutProfile = ({
  contact,
  customerId,
  linkedCustomerId,
  profile,
}: {
  readonly contact: Pick<CheckoutData, "email" | "name" | "phone">;
  readonly customerId: string;
  readonly linkedCustomerId: string | undefined;
  readonly profile: {
    readonly email?: string | null;
    readonly firstName?: string | null;
    readonly lastName?: string | null;
    readonly phone?: string | null;
  };
}) => {
  assert(
    linkedCustomerId === customerId,
    "verified account is not linked to the booked customer"
  );
  const name = splitCustomerName(contact.name);
  assert(
    profile.firstName === name.firstName &&
      (profile.lastName ?? undefined) === name.lastName,
    "saved profile name does not match the typed contact"
  );
  assert(
    normalizePhoneNumber(profile.phone) === normalizePhoneNumber(contact.phone),
    "saved profile phone does not match the typed contact"
  );
  assert(
    profile.email?.toLowerCase() === contact.email.toLowerCase(),
    "saved profile email is not the verified email"
  );
};
