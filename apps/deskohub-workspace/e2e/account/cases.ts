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
  focusBrowserElement,
  normalizeBrowserText,
  openBrowserPage,
  pressBrowserKey,
  readBrowserText,
  readBrowserUrl,
  waitForBrowserCondition,
  waitForBrowserReactFormAction,
  waitForBrowserText,
  waitForInteractiveSnapshot,
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
  accountSectionLandmarks,
  selectAccountSectionInRunner,
} from "./account-sections";
import {
  assertNoAuthRows,
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
  removeSyntheticAccountLink,
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
  WorkspaceE2EAccountJournalRef,
  WorkspaceE2EAccountLifecycleHandoff,
} from "./types";

const acceptedTitle = "Check your inbox";
const acceptedBody =
  "If the address can receive mail, a single-use link will arrive shortly. The link works once and expires in 10 minutes.";
const sendAnotherLinkLabel = "Send another link";
const callbackFailedTitle = "This link cannot be used";
const completionTitle = "Complete your profile";
const profileSaved = "Profile updated.";
const linkedEditSubmitLabel = "Save profile";
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
const billingKindSelector = "#account-profile-billing-kind";
const billingCompanyNameSelector = "#account-profile-billing-company-name";
const signOutSelector = "#account-sign-out";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";

/** Submitted as-is; the provider PATCH normalizes it to E.164. */
const profilePhoneFixture = "+420 555 000 111";
const billingCompanyFixture = "E2E Draft Company";

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
   * could never carry the completed lifecycle between the account cases.
   */
  readonly lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff;
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
  lifecycleHandoff,
  rateBudget,
  run,
  session,
}: WorkspaceE2EAccountCaseInputs): readonly WorkspaceE2EAccountCase[] => {
  const recipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EAccountMainRecipientLabel
  );
  const acceptedRecipientTwo = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-b"
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

  const waitDefaultReservations = (description: string) =>
    waitForBrowserCondition(
      run,
      session,
      description,
      `(() => {
        const landmark = document.querySelector(${JSON.stringify(accountSectionLandmarks.reservations)});
        return landmark !== null && landmark.closest("[hidden]") === null;
      })()`,
      { timeoutMs: uiTransition }
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
        const firstAccepted = yield* rateBudget.run(
          "send",
          runStep(
            step(
              "accepts a first unknown email generically",
              Effect.gen(function* () {
                yield* waitSignInForm();
                const startedAt = new Date();
                lifecycleHandoff.firstAcceptedRequestedAt = startedAt;
                yield* fillAndSubmitEmail(recipient);
                yield* waitText(
                  "first generic accepted response",
                  acceptedTitle
                );
                return yield* readNormalizedText();
              })
            )
          )
        );
        const secondAccepted = yield* rateBudget.run(
          "send",
          runStep(
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
        const startedAt = yield* runStep(
          step(
            "requires the first accepted main request handoff",
            Effect.sync(() => {
              const requestedAt = lifecycleHandoff.firstAcceptedRequestedAt;
              assert(
                requestedAt,
                "the sign-in form did not record the first main request"
              );
              return requestedAt;
            })
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
        yield* rateBudget.run(
          "verify",
          runStep(
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
          )
        );
      })
    ),
    makeCase("account-profile-completion", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        yield* runStep(
          step(
            "keeps the completion login email input read-only",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              const result = yield* evalBrowserScript(
                "assert the completion login email is read-only",
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
              assert(
                parsed.readOnly,
                "the completion login email input is editable"
              );
              assert(
                parsed.matches,
                "the completion login email input shows a different address"
              );
            })
          )
        );
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
            "keeps the linked login email display read-only",
            Effect.gen(function* () {
              yield* selectAccountSectionInRunner(run, session, "profile");
              const result = yield* evalBrowserScript(
                "assert the linked login email display is read-only",
                run,
                session,
                `(() => {
                    const profile = document.querySelector(${JSON.stringify(accountSectionLandmarks.profile)});
                    const emailField = profile instanceof HTMLElement
                      ? Array.from(profile.querySelectorAll("fieldset")).find((field) =>
                          field.textContent?.includes(${JSON.stringify(recipient)})
                        )
                      : undefined;
                    return JSON.stringify({
                      editable: emailField?.querySelector("input, textarea, select") !== null,
                      matches: emailField?.textContent?.includes(${JSON.stringify(recipient)}) === true,
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(result) as {
                editable: boolean;
                matches: boolean;
              };
              assert(
                parsed.matches,
                "the linked login email display shows a different address"
              );
              assert(
                !parsed.editable,
                "the linked login email display exposes an editable control"
              );
            })
          )
        );
        yield* runStep(
          step(
            "persists optional profile and billing fields to the provider profile",
            Effect.gen(function* () {
              yield* selectAccountSectionInRunner(run, session, "profile");
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
              yield* selectAccountSectionInRunner(run, session, "billing");
              yield* focusBrowserElement(run, session, billingKindSelector, {
                timeoutMs: browserTimeout,
              });
              yield* pressBrowserKey(run, session, "End", {
                timeoutMs: browserTimeout,
              });
              yield* pressBrowserKey(run, session, "Tab", {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "business billing kind",
                `(() => document.querySelector(${JSON.stringify(billingKindSelector)})?.value === "business")()`,
                { timeoutMs: uiTransition }
              );
              yield* fillBrowserField(
                run,
                session,
                billingCompanyNameSelector,
                billingCompanyFixture,
                { timeoutMs: browserTimeout }
              );
              yield* selectAccountSectionInRunner(run, session, "profile");
              const drafts = yield* evalBrowserScript(
                "assert profile and billing drafts survived section navigation",
                run,
                session,
                `(() => {
                    const firstName = document.querySelector(${JSON.stringify(profileFirstNameSelector)});
                    const lastName = document.querySelector(${JSON.stringify(profileLastNameSelector)});
                    const phone = document.querySelector(${JSON.stringify(profilePhoneSelector)});
                    const companyName = document.querySelector(${JSON.stringify(billingCompanyNameSelector)});
                    return JSON.stringify({
                      profilePreserved:
                        firstName instanceof HTMLInputElement &&
                        lastName instanceof HTMLInputElement &&
                        phone instanceof HTMLInputElement &&
                        firstName.value === "E2E" &&
                        lastName.value === "Lane" &&
                        phone.value === ${JSON.stringify(profilePhoneFixture)},
                      billingPreserved:
                        companyName instanceof HTMLInputElement &&
                        companyName.value === ${JSON.stringify(billingCompanyFixture)},
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsedDrafts = JSON.parse(drafts) as {
                billingPreserved: boolean;
                profilePreserved: boolean;
              };
              assert(
                parsedDrafts.profilePreserved,
                "profile drafts changed across section navigation"
              );
              assert(
                parsedDrafts.billingPreserved,
                "billing drafts changed across section navigation"
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
              assert(
                customer.companyName === billingCompanyFixture,
                "the billing draft did not reach the provider profile"
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
              // One aria-snapshot poll samples the interactive tree for both
              // assertions; body innerText missed content the sanitized
              // snapshot already showed in the hosted context.
              yield* waitForInteractiveSnapshot({
                description: "current reservations group with a confirmed card",
                matches: (snapshot) =>
                  snapshot.includes(currentReservationsTitle) &&
                  snapshot.includes(confirmedStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
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
              yield* waitForInteractiveSnapshot({
                description: "past reservations group with a cancelled card",
                matches: (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
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
        const startedAt = new Date();
        yield* runStep(
          step(
            "shows the durable deletion marker state",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* selectAccountSectionInRunner(run, session, "danger");
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
        yield* rateBudget.run(
          "send",
          runStep(
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
          )
        );
        const reauthenticationLink = yield* runStep(
          step(
            "retrieves the delivered reauthentication link",
            retrieveSignInLink(recipient, observedMessageIds, startedAt),
            authDeliveryTimeout
          )
        );
        lifecycleHandoff.reauthentication = {
          link: reauthenticationLink,
          userId: userId.userId,
          linkedCustomerId: userId.linked,
        };
      })
    ),
    makeCase("account-session-lifecycle", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const reauthentication = yield* runStep(
          step(
            "requires the reauthentication handoff from the marker case",
            Effect.sync(() => {
              const handoff = lifecycleHandoff.reauthentication;
              assert(
                handoff,
                "the deletion marker case did not complete the reauthentication handoff"
              );
              return handoff;
            })
          )
        );
        yield* runStep(
          step(
            "opens the pending account before signing out",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitText(
                "deletion pending state before sign-out",
                deletionPendingTitle
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "signs out on the current device before consuming reauthentication",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "signs the same account back in",
              Effect.gen(function* () {
                yield* openPage(reauthentication.link);
                yield* waitText(
                  "deletion pending state after reauthentication",
                  deletionPendingTitle
                );
                const userId = yield* requireAuthUserId(recipient);
                assert(
                  userId === reauthentication.userId,
                  "the reauthentication session used a different Better Auth id"
                );
                const linked = yield* requireLinkedCustomerId(userId);
                assert(
                  linked === reauthentication.linkedCustomerId,
                  "the reauthentication session lost the durable Dotypos link"
                );
              }),
              providerTransition
            )
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
              const customer = yield* readProviderProfile(
                reauthentication.linkedCustomerId
              );
              assert(
                customer.expireDate != null &&
                  new Date(customer.expireDate).getTime() <= Date.now(),
                "the provider profile was not expired by the deletion"
              );
              assert(
                customer.deleted !== true,
                "the provider profile was permanently deleted"
              );
              yield* assertNoAuthRows(reauthentication.userId);
              const link = yield* findLinkedDotyposCustomerId(
                reauthentication.userId
              );
              assert(
                link === undefined,
                "the customer account link survived identity removal"
              );
              lifecycleHandoff.deletedUserId = reauthentication.userId;
              lifecycleHandoff.retainedCustomerId =
                reauthentication.linkedCustomerId;
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
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "rejects the already-consumed reauthentication link",
              Effect.gen(function* () {
                yield* openPage(reauthentication.link);
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
          )
        );
      })
    ),
    makeCase("account-deletion-and-reactivation", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        yield* runStep(
          step(
            "requires the completed deletion handoff from the marker case",
            Effect.sync(() => {
              assert(
                lifecycleHandoff.deletedUserId != null &&
                  lifecycleHandoff.retainedCustomerId != null,
                "the account session case did not complete the deletion handoff"
              );
            })
          )
        );
        const startedAt = new Date();
        const observedMessageIds = yield* runStep(
          step(
            "records the delivered message baseline",
            observeDeliveredMessageIds(recipient),
            providerTransition
          )
        );
        yield* rateBudget.run(
          "send",
          runStep(
            step(
              "requests the reactivation sign-in link",
              requestSignInLink(recipient),
              navigationTimeout
            )
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the reactivation link",
            retrieveSignInLink(recipient, observedMessageIds, startedAt),
            authDeliveryTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "reactivates the retained profile under a new Better Auth identity",
              Effect.gen(function* () {
                yield* openPage(link);
                yield* waitDefaultReservations(
                  "reactivated linked account reservations"
                );
                const newUserId = yield* requireAuthUserId(recipient);
                assert(
                  newUserId !== lifecycleHandoff.deletedUserId,
                  "the reactivated identity reused the deleted Better Auth id"
                );
                const linked = yield* requireLinkedCustomerId(newUserId);
                assert(
                  linked === lifecycleHandoff.retainedCustomerId,
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
          )
        );
        yield* runStep(
          step(
            "keeps the retained reservation history across reactivation",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitForInteractiveSnapshot({
                description:
                  "retained past reservations group with a cancelled card",
                matches: (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
            }),
            accountPageLoadTimeout
          )
        );
      })
    ),
    makeCase("account-linking-variants", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const mainIdentity = yield* runStep(
          step(
            "reads the reactivated main identity",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const customerId = yield* requireLinkedCustomerId(userId);
              assert(
                userId !== lifecycleHandoff.deletedUserId,
                "the linking variants reused the deleted Better Auth id"
              );
              assert(
                customerId === lifecycleHandoff.retainedCustomerId,
                "the linking variants lost the retained Dotypos customer"
              );
              assert(
                journalRef.journal.authUserIds.includes(userId),
                "the reactivated main Better Auth user was not journaled"
              );
              assert(
                journalRef.journal.dotyposCustomerIds.includes(customerId),
                "the retained Dotypos customer was not journaled"
              );
              const customer = yield* readProviderProfile(customerId);
              assert(
                customer.expireDate == null && customer.deleted !== true,
                "the retained Dotypos profile is not active"
              );
              return { customerId, userId };
            }),
            datasourceTimeout
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the active unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the active main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "links the active provider profile without completion",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitDefaultReservations(
                "directly linked account reservations"
              );
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the active resolver changed the Better Auth id"
              );
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === mainIdentity.customerId,
                "the active provider profile did not link to the main account"
              );
            }),
            providerTransition
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the expired unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the expired main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "expires the retained provider profile after unlinking",
            expireSyntheticCustomerProfile(
              datasourceConfig,
              mainIdentity.customerId
            ).pipe(
              Effect.timeoutOrElse({
                duration: `${datasourceTimeout} millis`,
                orElse: () =>
                  workspaceE2ETimeoutError(
                    "provider profile expiration timed out",
                    { operation: "expire provider profile" }
                  ),
              })
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "reactivates the expired provider profile on linking",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitDefaultReservations(
                "linked expired account reservations"
              );
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the expired resolver changed the Better Auth id"
              );
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === mainIdentity.customerId,
                "the expired provider profile did not link to the main account"
              );
              const customer = yield* readProviderProfile(linked);
              assert(
                customer.expireDate == null,
                "the expired provider profile was not reactivated"
              );
            }),
            providerTransition
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the ambiguous unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the ambiguous main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "creates one additional ambiguous provider profile",
            Effect.gen(function* () {
              const duplicateCustomerId = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                {
                  email: recipient,
                  firstName: "E2E Support Duplicate",
                }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [duplicateCustomerId],
              });
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "requires support for an ambiguous provider profile",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitText("support-required state", supportTitle);
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the ambiguous resolver changed the Better Auth id"
              );
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
