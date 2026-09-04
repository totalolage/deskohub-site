import {
  type DotyposCustomerId,
  type DotyposReservationId,
  normalizePhoneNumber,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  clickBrowserElement,
  evalBrowserScript,
  fillBrowserField,
  normalizeBrowserText,
  openBrowserPage,
  readBrowserText,
  readBrowserUrl,
  waitForBrowserCondition,
  waitForBrowserReactFormAction,
  waitForBrowserText,
} from "../browser";
import type { DatasourceConfig } from "../config";
import {
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { pollUntil } from "../polling";
import { assert, type Runner } from "../runtime";
import { workspaceE2EPollIntervalMs, workspaceE2ETimeouts } from "../timeouts";
import {
  assertNoAuthRows,
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
  setDeletionRequestedAt,
  setSessionCreatedAt,
} from "./auth-rows";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { WorkspaceE2EAccountConfig } from "./config";
import {
  makeWorkspaceE2EAccountRecipient,
  workspaceE2EAccountMainRecipientLabel,
} from "./config";
import {
  assertNoSyntheticCustomerProfile,
  cancelSyntheticReservation,
  createSyntheticCustomerProfile,
  createSyntheticReservation,
  expireSyntheticCustomerProfile,
  readSyntheticCustomerProfile,
} from "./fixtures";
import type { MagicLinkRateBudget } from "./rate-budget";
import {
  listSyntheticMessageIds,
  retrieveWorkspaceE2EMagicLink,
} from "./resend-retrieval";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountDeletionHandoff,
  WorkspaceE2EAccountJournalRef,
} from "./types";

const acceptedTitle = "Check your inbox";
const acceptedBody =
  "If the address can receive mail, a single-use link will arrive shortly. The link works once and expires in 10 minutes.";
const sendAnotherLinkLabel = "Send another link";
const callbackFailedTitle = "This link cannot be used";
const completionTitle = "Complete your profile";
const profileSaved = "Profile updated.";
const linkedEditSubmitLabel = "Save profile";
const linkedDeleteCardTitle = "Delete account";
const supportTitle = "We need to verify your profile";
const deletionPendingTitle = "Account deletion is pending";
const deletionReauthLinkSent =
  "If the address can receive mail, a new link is on its way.";
const deletedTitle = "Your account was deleted";
const currentReservationsTitle = "Current and upcoming";
const pastReservationsTitle = "Past reservations";
const cancelledStatus = "Cancelled";
const confirmedStatus = "Confirmed";

const signInSuffix = "/auth/sign-in";
const accountSuffix = "/account";
const callbackSuffix = "/auth/callback";

const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const profileFirstNameSelector = "#account-profile-first-name";
const profileLastNameSelector = "#account-profile-last-name";
const profilePhoneSelector = "#account-profile-phone";
const profileEmailSelector = "#account-profile-email";
const profileSubmitSelector = "#account-profile-form button[type=submit]";
const signOutSelector = "#account-sign-out";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";

/** Submitted as-is; the provider PATCH normalizes it to E.164. */
const profilePhoneFixture = "+420 555 000 111";

const browserTimeout = workspaceE2ETimeouts.browserAction;
const uiTransition = workspaceE2ETimeouts.uiTransition;
const providerTransition = workspaceE2ETimeouts.providerTransition;
const datasourceTimeout = workspaceE2ETimeouts.datasource;
const authDeliveryTimeout = workspaceE2ETimeouts.authDelivery;
const navigationTimeout = workspaceE2ETimeouts.browserNavigation;
const caseTimeout = workspaceE2ETimeouts.accountCase;

/**
 * One datasource-backed account page assertion after navigation: a full
 * browser command window plus a full datasource convergence window, since
 * server-rendered reservation content races a bare uiTransition budget.
 */
const accountPageLoadTimeout = browserTimeout + datasourceTimeout;

/**
 * The deployed deletion gate treats a session as stale after ten minutes;
 * back-dating by eleven makes the reauthentication branch deterministic.
 */
const staleSessionAgeMs = 11 * 60_000;

/**
 * A bounded settle after a submit that native validation must have blocked;
 * the accepted response must not appear within it.
 */
const invalidEmailSettleMs = 2_000;

export type WorkspaceE2EAccountCaseInputs = {
  readonly config: WorkspaceE2EAccountConfig;
  readonly datasourceConfig: DatasourceConfig;
  /**
   * The worker-scoped lane fixture owns this mutable handoff once; the case
   * factory is rebuilt for every Playwright test, so a factory-local object
   * could never carry the completed deletion between the two deletion cases.
   */
  readonly deletionHandoff: WorkspaceE2EAccountDeletionHandoff;
  readonly rateBudget: MagicLinkRateBudget;
  readonly run: Runner;
  readonly session: string;
};

/**
 * Builds the serial account lifecycle lane. The cases share one browser
 * session and one synthetic identity chain, ordered so each delivered link,
 * provider fixture, and deletion transition is exercised against the exact
 * protected preview and its matching migrated Neon branch.
 */
export const makeWorkspaceE2EAccountCases = ({
  config,
  datasourceConfig,
  deletionHandoff,
  rateBudget,
  run,
  session,
}: WorkspaceE2EAccountCaseInputs): readonly WorkspaceE2EAccountCase[] => {
  const recipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EAccountMainRecipientLabel
  );
  const acceptedRecipientOne = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-a"
  );
  const acceptedRecipientTwo = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-b"
  );
  const activeRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    "active-linking"
  );
  const expiredRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    "expired-linking"
  );
  const ambiguousRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    "support"
  );

  const localized = (suffix: string) =>
    `${config.baseUrl}/${config.locale}${suffix}`;

  const openPage = (url: string) =>
    openBrowserPage(config, run, session, url, { timeoutMs: browserTimeout });

  const waitText = (
    description: string,
    text: string,
    timeoutMs = uiTransition
  ) =>
    waitForBrowserText({
      description,
      matches: (pageText) => pageText.includes(text),
      run,
      session,
      timeoutMs,
    });

  const waitUrlContains = (description: string, expected: string) =>
    pollUntil(
      readBrowserUrl(run, session).pipe(
        Effect.map((url) => (url?.includes(expected) ? url : undefined))
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.browser,
        label: description,
        timeoutMs: uiTransition,
      }
    );

  const withoutTrailingSlash = (url: string) =>
    url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url;

  /**
   * Signs out on the current device and proves the session is gone. The
   * sign-out button resolves its server request before assigning the bare
   * locale root, so only an exact root URL proves the logout finished, and a
   * fresh protected-account visit must then redirect the anonymous browser to
   * the sign-in form. The account URL itself must never satisfy the landing
   * wait, which is why the comparison is exact rather than a substring.
   */
  const signOutAndRequireAnonymous = () =>
    Effect.gen(function* () {
      yield* clickBrowserElement(run, session, signOutSelector, {
        timeoutMs: browserTimeout,
      });
      yield* pollUntil(
        readBrowserUrl(run, session).pipe(
          Effect.map((url) =>
            url !== undefined && withoutTrailingSlash(url) === localized("")
              ? url
              : undefined
          )
        ),
        {
          intervalMs: workspaceE2EPollIntervalMs.browser,
          label: "sign-out landing on the bare locale root",
          timeoutMs: uiTransition,
        }
      );
      yield* openPage(localized(accountSuffix));
      yield* waitUrlContains(
        "anonymous account redirect after sign-out",
        signInSuffix
      );
      yield* waitSignInForm();
    });

  const readNormalizedText = () =>
    readBrowserText(run, session).pipe(Effect.map(normalizeBrowserText));

  const waitSignInForm = () =>
    waitForBrowserReactFormAction(run, session, signInFormSelector, {
      timeoutMs: browserTimeout,
    });

  const fillAndSubmitEmail = (email: string) =>
    Effect.gen(function* () {
      yield* fillBrowserField(run, session, signInEmailSelector, email, {
        timeoutMs: browserTimeout,
      });
      yield* clickBrowserElement(run, session, signInSubmitSelector, {
        timeoutMs: browserTimeout,
      });
    });

  /**
   * Submits the sign-in form for one synthetic recipient. The serial lane
   * reserves every magic-link operation at case level, so this step never
   * waits on the operation budget.
   */
  const requestSignInLink = (email: string) =>
    Effect.gen(function* () {
      yield* openPage(localized(signInSuffix));
      yield* waitSignInForm();
      yield* fillAndSubmitEmail(email);
      yield* waitText("generic accepted sign-in response", acceptedTitle);
      yield* waitText("generic accepted sign-in body", acceptedBody);
    });

  /**
   * Bounded Resend retrieval for one delivered link. The ids observed before
   * the request exclude every earlier message to the same recipient, so
   * repeated sign-ins never match a stale message.
   */
  const retrieveSignInLink = (
    email: string,
    observedMessageIds: readonly string[],
    startedAt: Date
  ) =>
    retrieveWorkspaceE2EMagicLink(config, {
      callbackPath: `/${config.locale}${callbackSuffix}`,
      excludeMessageIds: observedMessageIds,
      recipient: email,
      startedAt,
    });

  const observeDeliveredMessageIds = (email: string) =>
    listSyntheticMessageIds(config, email);

  const requireAuthUserId = (email: string) =>
    Effect.gen(function* () {
      const userId = yield* findAuthUserIdByEmail(email);
      assert(
        userId,
        "expected a synthetic Better Auth user for the verified recipient"
      );
      return userId;
    });

  const requireLinkedCustomerId = (userId: string) =>
    Effect.gen(function* () {
      const customerId = yield* findLinkedDotyposCustomerId(userId);
      assert(
        customerId,
        "expected a linked Dotypos customer for the synthetic account"
      );
      return customerId as DotyposCustomerId;
    });

  const recordFixtureIds = (
    journalRef: WorkspaceE2EAccountJournalRef,
    update: {
      readonly authUserIds?: readonly string[];
      readonly dotyposCustomerIds?: readonly string[];
      readonly dotyposReservationIds?: readonly string[];
    }
  ) =>
    Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("record workspace account e2e fixture", {
          cause,
          operation: "record workspace account e2e fixture",
        }),
      try: () =>
        journalRef.record({
          authUserIds: update.authUserIds ?? [],
          dotyposCustomerIds: update.dotyposCustomerIds ?? [],
          dotyposReservationIds: update.dotyposReservationIds ?? [],
        }),
    });

  const readProviderProfile = (customerId: string) =>
    readSyntheticCustomerProfile(
      datasourceConfig,
      customerId as DotyposCustomerId
    ).pipe(
      Effect.timeoutOrElse({
        duration: `${datasourceTimeout} millis`,
        orElse: () =>
          workspaceE2ETimeoutError("provider profile read timed out", {
            operation: "read provider profile",
          }),
      })
    );

  const makeCase = (
    id: WorkspaceE2EAccountCaseId,
    execute: WorkspaceE2EAccountCase["execute"]
  ): WorkspaceE2EAccountCase => ({ execute, id, timeoutMs: caseTimeout });

  const step = <A, R>(
    id: string,
    execute: Effect.Effect<A, WorkspaceE2EError, R>,
    timeoutMs = uiTransition
  ) => ({ execute, id, timeoutMs });

  return [
    makeCase("account-anonymous-redirect", ({ runStep }) =>
      runStep(
        step(
          "redirects an anonymous account visit to the sign-in page",
          Effect.gen(function* () {
            yield* openPage(localized(accountSuffix));
            yield* waitUrlContains(
              "anonymous account redirect to the sign-in page",
              signInSuffix
            );
            yield* waitSignInForm();
          })
        )
      )
    ),
    makeCase("account-sign-in-form", ({ runStep }) =>
      Effect.gen(function* () {
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("send");
        yield* runStep(
          step(
            "rejects an invalid email without requesting a link",
            Effect.gen(function* () {
              yield* openPage(localized(signInSuffix));
              yield* waitSignInForm();
              yield* fillAndSubmitEmail("not-an-email");
              const validation = yield* evalBrowserScript(
                "assert native validation blocked the invalid email",
                run,
                session,
                `(() => {
                    const input = document.querySelector(${JSON.stringify(signInEmailSelector)});
                    return JSON.stringify({
                      blocked: input instanceof HTMLInputElement && input.validationMessage !== "",
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(validation) as { blocked: boolean };
              assert(
                parsed.blocked,
                "the browser accepted an invalid email without native validation"
              );
              yield* Effect.sleep(invalidEmailSettleMs);
              const pageText = yield* readNormalizedText();
              assert(
                !pageText.includes(acceptedTitle),
                "an invalid email produced the accepted sign-in response"
              );
            })
          )
        );
        const firstAccepted = yield* runStep(
          step(
            "accepts a first unknown email generically",
            Effect.gen(function* () {
              yield* waitSignInForm();
              yield* fillAndSubmitEmail(acceptedRecipientOne);
              yield* waitText("first generic accepted response", acceptedTitle);
              return yield* readNormalizedText();
            })
          )
        );
        const secondAccepted = yield* runStep(
          step(
            "accepts a second unknown email with an identical response",
            Effect.gen(function* () {
              yield* clickBrowserElement(
                run,
                session,
                `button:has-text("${sendAnotherLinkLabel}")`,
                { timeoutMs: browserTimeout }
              );
              yield* waitSignInForm();
              yield* fillAndSubmitEmail(acceptedRecipientTwo);
              yield* waitText(
                "second generic accepted response",
                acceptedTitle
              );
              return yield* readNormalizedText();
            })
          )
        );
        yield* runStep(
          step(
            "renders both accepted responses identically",
            Effect.sync(() => {
              assert(
                firstAccepted === secondAccepted,
                "the accepted response differs between unknown emails"
              );
              assert(
                firstAccepted.includes(acceptedBody),
                "the accepted response lost its generic body"
              );
            })
          )
        );
      })
    ),
    makeCase("account-magic-link-delivery", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const startedAt = new Date();
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("verify");
        yield* runStep(
          step(
            "requests the synthetic magic link",
            requestSignInLink(recipient),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "leaves Dotypos untouched before verification",
            assertNoSyntheticCustomerProfile(datasourceConfig, recipient).pipe(
              Effect.timeoutOrElse({
                duration: `${datasourceTimeout} millis`,
                orElse: () =>
                  workspaceE2ETimeoutError(
                    "Dotypos pre-verification read timed out",
                    { operation: "Dotypos pre-verification read" }
                  ),
              })
            ),
            datasourceTimeout
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the delivered single-use link",
            retrieveSignInLink(recipient, [], startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "consumes the link into the completion state",
            Effect.gen(function* () {
              yield* openPage(link);
              yield* waitText(
                "completion state after verification",
                completionTitle
              );
              yield* waitUrlContains(
                "account URL after verification",
                accountSuffix
              );
              const userId = yield* requireAuthUserId(recipient);
              yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
            }),
            providerTransition
          )
        );
      })
    ),
    makeCase("account-profile-completion", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        yield* runStep(
          step(
            "completes the profile with a required first name",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              yield* fillBrowserField(
                run,
                session,
                profileFirstNameSelector,
                "E2E",
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, profileSubmitSelector, {
                timeoutMs: browserTimeout,
              });
              // The completion feedback is transient: the successful action
              // intentionally refreshes into the linked edit view, replacing
              // it. The durable contract is the edit form's submit control,
              // whose accessible name only the linked edit view renders.
              yield* waitForBrowserCondition(
                run,
                session,
                "linked account edit form with its Save profile submit control",
                `(() => {
                    const button = document.querySelector(${JSON.stringify(profileSubmitSelector)});
                    return button instanceof HTMLButtonElement &&
                      button.type === "submit" &&
                      button.textContent?.trim() === ${JSON.stringify(linkedEditSubmitLabel)};
                  })()`,
                { timeoutMs: uiTransition }
              );
            })
          )
        );
        const customerId = yield* runStep(
          step(
            "links the completed profile to the synthetic customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const linked = yield* requireLinkedCustomerId(userId);
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [linked],
              });
              return linked;
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "keeps the verified login email read-only",
            Effect.gen(function* () {
              const result = yield* evalBrowserScript(
                "assert the verified login email is read-only",
                run,
                session,
                `(() => {
                    const input = document.querySelector(${JSON.stringify(profileEmailSelector)});
                    return JSON.stringify({
                      readOnly: input instanceof HTMLInputElement && input.readOnly,
                      matches: input instanceof HTMLInputElement && input.value === ${JSON.stringify(recipient)},
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(result) as {
                matches: boolean;
                readOnly: boolean;
              };
              assert(parsed.readOnly, "the login email input is editable");
              assert(
                parsed.matches,
                "the login email input shows a different address"
              );
            })
          )
        );
        yield* runStep(
          step(
            "persists optional profile fields to the provider profile",
            Effect.gen(function* () {
              yield* fillBrowserField(
                run,
                session,
                profileLastNameSelector,
                "Lane",
                { timeoutMs: browserTimeout }
              );
              yield* fillBrowserField(
                run,
                session,
                profilePhoneSelector,
                profilePhoneFixture,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, profileSubmitSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitText("profile update saved", profileSaved);
              const customer = yield* readProviderProfile(customerId);
              assert(
                customer.lastName === "Lane",
                "the optional last name did not reach the provider profile"
              );
              assert(
                normalizePhoneNumber(customer.phone) ===
                  normalizePhoneNumber(profilePhoneFixture),
                "the optional phone did not reach the provider profile"
              );
            }),
            datasourceTimeout
          )
        );
      })
    ),
    makeCase("account-reservation-transitions", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const customerId = yield* runStep(
          step(
            "reads the linked synthetic customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              return yield* requireLinkedCustomerId(userId);
            }),
            datasourceTimeout
          )
        );
        const reservations = yield* runStep(
          step(
            "creates far-future synthetic provider reservations",
            Effect.gen(function* () {
              const first = yield* createSyntheticReservation(
                datasourceConfig,
                {
                  customerId,
                }
              );
              const second = yield* createSyntheticReservation(
                datasourceConfig,
                {
                  customerId,
                }
              );
              const reservationIds = [first.reservationId, second.reservationId]
                .filter((value) => value !== undefined)
                .map((value) => value as string);
              yield* recordFixtureIds(journalRef, {
                dotyposReservationIds: reservationIds,
              });
              return [first, second];
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "shows the confirmed reservations in the current group",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              // One combined condition bounds navigation and both content
              // assertions. The child window is the datasource budget; the
              // step budget adds the navigation command window on top so a
              // slow server render cannot exhaust the parent first.
              yield* waitForBrowserCondition(
                run,
                session,
                "current reservations group with a confirmed card",
                `(() => {
                    const text = document.body?.innerText ?? "";
                    return text.includes(${JSON.stringify(currentReservationsTitle)}) &&
                      text.includes(${JSON.stringify(confirmedStatus)});
                  })()`,
                { timeoutMs: datasourceTimeout }
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "cancels the second synthetic reservation",
            Effect.gen(function* () {
              const second = reservations[1]?.reservationId;
              assert(second, "second synthetic reservation id missing");
              yield* cancelSyntheticReservation(
                datasourceConfig,
                second as DotyposReservationId
              );
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "moves the cancelled reservation to the past group",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitForBrowserCondition(
                run,
                session,
                "past reservations group with a cancelled card",
                `(() => {
                    const text = document.body?.innerText ?? "";
                    return text.includes(${JSON.stringify(pastReservationsTitle)}) &&
                      text.includes(${JSON.stringify(cancelledStatus)});
                  })()`,
                { timeoutMs: datasourceTimeout }
              );
            }),
            accountPageLoadTimeout
          )
        );
      })
    ),
    makeCase("account-deletion-marker-reauth", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const userId = yield* runStep(
          step(
            "reads the synthetic account identity",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const linked = yield* requireLinkedCustomerId(userId);
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [linked],
              });
              return { linked, userId };
            }),
            datasourceTimeout
          )
        );
        // One verification covers the reauthentication consume; the second
        // covers replaying the already-consumed link after deletion.
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("verify");
        yield* rateBudget.reserve("verify");
        const startedAt = new Date();
        yield* runStep(
          step(
            "shows the durable deletion marker state",
            Effect.gen(function* () {
              yield* setDeletionRequestedAt(userId.userId, new Date());
              yield* setSessionCreatedAt(
                userId.userId,
                new Date(Date.now() - staleSessionAgeMs)
              );
              yield* openPage(localized(accountSuffix));
              yield* waitText("deletion pending state", deletionPendingTitle);
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "asks for reauthentication behind the stale-session gate",
            Effect.gen(function* () {
              yield* clickBrowserElement(run, session, deleteTriggerSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "deletion confirmation dialog",
                `(() => document.querySelector(${JSON.stringify(deleteConfirmSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(
                run,
                session,
                deleteConfirmCheckboxSelector,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, deleteConfirmSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "reauthentication dialog",
                `(() => document.querySelector(${JSON.stringify(deleteReauthSendSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
            })
          )
        );
        const observedMessageIds = yield* runStep(
          step(
            "records the delivered message baseline",
            observeDeliveredMessageIds(recipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "sends the reauthentication link",
            Effect.gen(function* () {
              yield* clickBrowserElement(
                run,
                session,
                deleteReauthSendSelector,
                { timeoutMs: browserTimeout }
              );
              yield* waitText(
                "reauthentication link accepted",
                deletionReauthLinkSent
              );
            })
          )
        );
        const reauthenticationLink = yield* runStep(
          step(
            "retrieves the delivered reauthentication link",
            retrieveSignInLink(recipient, observedMessageIds, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "keeps the deletion marker state after reauthentication",
            Effect.gen(function* () {
              yield* openPage(reauthenticationLink);
              yield* waitText(
                "deletion pending state after reauthentication",
                deletionPendingTitle
              );
              const linked = yield* findLinkedDotyposCustomerId(userId.userId);
              assert(
                linked === userId.linked,
                "the reauthentication session lost the durable Dotypos link"
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "completes the deletion on retry behind the destructive confirmation",
            Effect.gen(function* () {
              yield* clickBrowserElement(run, session, deleteTriggerSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "deletion confirmation dialog",
                `(() => document.querySelector(${JSON.stringify(deleteConfirmSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(
                run,
                session,
                deleteConfirmCheckboxSelector,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, deleteConfirmSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitText("deleted page", deletedTitle, providerTransition);
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "expires the provider profile first and removes every identity row",
            Effect.gen(function* () {
              const customer = yield* readProviderProfile(userId.linked);
              assert(
                customer.expireDate != null &&
                  new Date(customer.expireDate).getTime() <= Date.now(),
                "the provider profile was not expired by the deletion"
              );
              assert(
                customer.deleted !== true,
                "the provider profile was permanently deleted"
              );
              yield* assertNoAuthRows(userId.userId);
              const link = yield* findLinkedDotyposCustomerId(userId.userId);
              assert(
                link === undefined,
                "the customer account link survived identity removal"
              );
              deletionHandoff.deletedUserId = userId.userId;
              deletionHandoff.retainedCustomerId = userId.linked;
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "requires anonymous access after the completed deletion",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitUrlContains(
                "anonymous account redirect after deletion",
                signInSuffix
              );
              yield* waitSignInForm();
            })
          )
        );
        yield* runStep(
          step(
            "rejects the already-consumed reauthentication link",
            Effect.gen(function* () {
              yield* openPage(reauthenticationLink);
              const replayedUserId = yield* findAuthUserIdByEmail(recipient);
              if (replayedUserId) {
                yield* recordFixtureIds(journalRef, {
                  authUserIds: [replayedUserId],
                });
              }
              yield* waitText(
                "replayed reauthentication failure state",
                callbackFailedTitle
              );
            }),
            providerTransition
          )
        );
      })
    ),
    makeCase("account-deletion-and-reactivation", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const startedAt = new Date();
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("verify");
        yield* runStep(
          step(
            "requires the completed deletion handoff from the marker case",
            Effect.sync(() => {
              assert(
                deletionHandoff.deletedUserId != null &&
                  deletionHandoff.retainedCustomerId != null,
                "the deletion marker case did not complete the deletion handoff"
              );
            })
          )
        );
        const observedMessageIds = yield* runStep(
          step(
            "records the delivered message baseline",
            observeDeliveredMessageIds(recipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "requests the reactivation sign-in link",
            requestSignInLink(recipient),
            navigationTimeout
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the reactivation link",
            retrieveSignInLink(recipient, observedMessageIds, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "reactivates the retained profile under a new Better Auth identity",
            Effect.gen(function* () {
              yield* openPage(link);
              yield* waitText(
                "reactivated linked account",
                linkedDeleteCardTitle
              );
              const newUserId = yield* requireAuthUserId(recipient);
              assert(
                newUserId !== deletionHandoff.deletedUserId,
                "the reactivated identity reused the deleted Better Auth id"
              );
              const linked = yield* requireLinkedCustomerId(newUserId);
              assert(
                linked === deletionHandoff.retainedCustomerId,
                "the reactivated identity claimed a different Dotypos customer"
              );
              const customer = yield* readProviderProfile(linked);
              assert(
                customer.expireDate == null,
                "the retained Dotypos profile was not reactivated"
              );
              yield* recordFixtureIds(journalRef, {
                authUserIds: [newUserId],
              });
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "keeps the retained reservation history across reactivation",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitText(
                "retained past reservation group",
                pastReservationsTitle
              );
              yield* waitText(
                "retained cancelled reservation status",
                cancelledStatus
              );
            }),
            uiTransition
          )
        );
      })
    ),
    makeCase("account-session-lifecycle", ({ runStep }) =>
      Effect.gen(function* () {
        const startedAt = new Date();
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("verify");
        const customerId = yield* runStep(
          step(
            "reads the linked synthetic customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              return yield* requireLinkedCustomerId(userId);
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "signs out on the current device and blocks the account",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        const observedMessageIds = yield* runStep(
          step(
            "records the delivered message baseline",
            observeDeliveredMessageIds(recipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "requests the returning sign-in link",
            requestSignInLink(recipient),
            navigationTimeout
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the returning sign-in link",
            retrieveSignInLink(recipient, observedMessageIds, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "signs the same account back in",
            Effect.gen(function* () {
              yield* openPage(link);
              yield* waitText(
                "returning linked account",
                linkedDeleteCardTitle
              );
              const userId = yield* requireAuthUserId(recipient);
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === customerId,
                "the returning session linked a different Dotypos customer"
              );
            }),
            providerTransition
          )
        );
      })
    ),
    makeCase("account-linking-variants", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const startedAt = new Date();
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("send");
        yield* rateBudget.reserve("verify");
        yield* rateBudget.reserve("verify");
        yield* rateBudget.reserve("verify");
        yield* runStep(
          step(
            "signs out of the synthetic main identity",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        const activeCustomerId = yield* runStep(
          step(
            "creates the active provider profile fixture",
            Effect.gen(function* () {
              const customerId = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                { email: activeRecipient, firstName: "E2E Active" }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [customerId],
              });
              return customerId;
            }),
            datasourceTimeout
          )
        );
        const activeObserved = yield* runStep(
          step(
            "records the active-profile message baseline",
            observeDeliveredMessageIds(activeRecipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "requests the active-profile sign-in link",
            requestSignInLink(activeRecipient),
            navigationTimeout
          )
        );
        const activeLink = yield* runStep(
          step(
            "retrieves the active-profile sign-in link",
            retrieveSignInLink(activeRecipient, activeObserved, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "links the active provider profile without completion",
            Effect.gen(function* () {
              yield* openPage(activeLink);
              yield* waitText(
                "directly linked active profile",
                linkedDeleteCardTitle
              );
              const userId = yield* requireAuthUserId(activeRecipient);
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === activeCustomerId,
                "the active provider profile did not link to the verified account"
              );
              yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
            }),
            providerTransition
          )
        );
        const expiredCustomerId = yield* runStep(
          step(
            "creates and expires the expired provider profile fixture",
            Effect.gen(function* () {
              const customerId = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                { email: expiredRecipient, firstName: "E2E Expired" }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [customerId],
              });
              yield* expireSyntheticCustomerProfile(
                datasourceConfig,
                customerId
              ).pipe(
                Effect.timeoutOrElse({
                  duration: `${datasourceTimeout} millis`,
                  orElse: () =>
                    workspaceE2ETimeoutError(
                      "provider profile expiration timed out",
                      { operation: "expire provider profile" }
                    ),
                })
              );
              return customerId;
            }),
            datasourceTimeout
          )
        );
        const expiredObserved = yield* runStep(
          step(
            "records the expired-profile message baseline",
            observeDeliveredMessageIds(expiredRecipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "requests the expired-profile sign-in link",
            requestSignInLink(expiredRecipient),
            navigationTimeout
          )
        );
        const expiredLink = yield* runStep(
          step(
            "retrieves the expired-profile sign-in link",
            retrieveSignInLink(expiredRecipient, expiredObserved, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "reactivates the expired provider profile on linking",
            Effect.gen(function* () {
              yield* openPage(expiredLink);
              yield* waitText("linked expired profile", linkedDeleteCardTitle);
              const userId = yield* requireAuthUserId(expiredRecipient);
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === expiredCustomerId,
                "the expired provider profile did not link to the verified account"
              );
              const customer = yield* readProviderProfile(linked);
              assert(
                customer.expireDate == null,
                "the expired provider profile was not reactivated"
              );
              yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "creates the ambiguous provider profile fixtures",
            Effect.gen(function* () {
              const first = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                {
                  email: ambiguousRecipient,
                  firstName: "E2E Support One",
                }
              );
              const second = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                {
                  email: ambiguousRecipient,
                  firstName: "E2E Support Two",
                }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [first, second],
              });
            }),
            datasourceTimeout
          )
        );
        const supportObserved = yield* runStep(
          step(
            "records the support-state message baseline",
            observeDeliveredMessageIds(ambiguousRecipient),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "requests the support-state sign-in link",
            requestSignInLink(ambiguousRecipient),
            navigationTimeout
          )
        );
        const supportLink = yield* runStep(
          step(
            "retrieves the support-state sign-in link",
            retrieveSignInLink(ambiguousRecipient, supportObserved, startedAt),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "requires support for an ambiguous provider profile",
            Effect.gen(function* () {
              yield* openPage(supportLink);
              yield* waitText("support-required state", supportTitle);
              const userId = yield* requireAuthUserId(ambiguousRecipient);
              yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
              const claimed = yield* findLinkedDotyposCustomerId(userId);
              assert(
                claimed === undefined,
                "an ambiguous provider match claimed a link"
              );
            }),
            providerTransition
          )
        );
      })
    ),
  ];
};
