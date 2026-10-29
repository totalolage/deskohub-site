import { Effect } from "effect";
import type { AccountSection } from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import { localeCookieName } from "@/features/i18n/routing";
import {
  openPage,
  readPageText,
  readPageUrl,
  waitForPageCondition,
  waitForPageSnapshot,
  waitForPageText,
  waitForPageUrl,
  waitForReactFormSubmit,
  waitForReactHandler,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import { switchLocale } from "../cases/locale";
import type { WorkspaceE2EConfig } from "../config";
import { type WorkspaceE2EError, withoutWorkspaceE2ETimeout } from "../errors";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import { browserSessionFor, type Runner } from "../runtime";
import {
  accountSectionLandmarks,
  selectAccountSectionInSession,
} from "./account-sections";

const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const signInCodeSelector = "#account-sign-in-code";
const signOutSelector = "#account-sign-out";
const profileFormSelector = "#account-profile-form";
const profileSubmitSelector = `${profileFormSelector} button[type=submit]`;
const profileEmailSelector = "#account-profile-email";
const profileReferralCodeSelector = "#profile-referral-code";
const billingKindSelector = "#account-profile-billing-kind";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const languageTriggerSelector = '[data-slot="select-trigger"]';

/** The selectors of the account profile and billing fields the lane fills. */
export const accountProfileFieldSelectors = {
  billingCompanyName: "#account-profile-billing-company-name",
  firstName: "#account-profile-first-name",
  lastName: "#account-profile-last-name",
  phone: "#account-profile-phone",
} as const;

/** An account profile or billing field the lane fills. */
export type AccountProfileField = keyof typeof accountProfileFieldSelectors;

/** Each site language's option in the profile's language select. */
const languageOptionLabels: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Čeština",
  "en-US": "English (US)",
};

/** The page steps of one account browser, each on its active page. */
export type WorkspaceE2EAccountBrowser = {
  /** Loads the URL, priming preview access first when the run has a bypass. */
  readonly open: (url: string) => Effect.Effect<void, WorkspaceE2EError>;
  /** The active page's URL, or `undefined` when it can't be read. */
  readonly readUrl: Effect.Effect<string | undefined>;
  /**
   * Polls the URL until `matches` accepts it; a URL that never matches fails
   * the wait with the page diagnostics rather than timing it out.
   */
  readonly waitForUrl: (
    description: string,
    matches: (url: string) => boolean,
    timeoutMs: number
  ) => Effect.Effect<string, WorkspaceE2EError>;
  /** The page's visible text. */
  readonly readText: Effect.Effect<string, WorkspaceE2EError>;
  /** Polls the visible text until `matches` accepts it and returns it. */
  readonly waitForText: (
    description: string,
    matches: (text: string) => boolean,
    timeoutMs: number
  ) => Effect.Effect<string, WorkspaceE2EError>;
  /** Waits until the sign-in form takes a typed email and a native submit. */
  readonly waitForSignInForm: Effect.Effect<void, WorkspaceE2EError>;
  /** Types the email into the sign-in form and submits it natively. */
  readonly submitSignInEmail: (
    email: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the code input of a sign-in code step takes typed digits. */
  readonly waitForSignInCodeInput: Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until a cowork page has the entry tier selected. */
  readonly waitForCoworkSelection: (
    description: string,
    entryTier: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Follows the failed-callback card's link to request a new sign-in link. */
  readonly requestNewLinkAfterFailedCallback: (
    locale: Locale
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Clicks the account's sign-out button. */
  readonly signOut: Effect.Effect<void, WorkspaceE2EError>;
  /** Switches the locale through the header's locale switcher. */
  readonly switchLocale: (
    locale: Locale
  ) => Effect.Effect<void, WorkspaceE2EError>;
};

/**
 * The account lane's browser steps that drive its session directly, while
 * the rest of each case still reaches the same context through argv
 * commands.
 */
export type WorkspaceE2EAccountLaneBrowser = WorkspaceE2EAccountBrowser & {
  /**
   * The second browser of the cross-browser sign-in, the one a customer's
   * assistant books in: its own context, opened by its first step.
   */
  readonly assistant: WorkspaceE2EAccountBrowser & {
    /**
     * Closes the assistant's browser. A close that fails or outlasts
     * `browserSessionClose` is ignored; the lane runner's `close` at worker
     * teardown still closes a session that opens after the wait.
     */
    readonly close: Effect.Effect<void>;
  };
  /** Selects the section in the lane page's account navigation. */
  readonly selectSection: (
    section: AccountSection
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the lane browser remembers exactly this shared code. */
  readonly waitForRememberedReferralCode: (
    code: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the lane browser remembers no referral code. */
  readonly waitForNoRememberedReferralCode: Effect.Effect<
    void,
    WorkspaceE2EError
  >;
  /**
   * Whether the session the page's origin holds belongs to the email, read
   * through Better Auth's session endpoint. Only the match leaves the page.
   */
  readonly readSessionMatches: (
    email: string
  ) => Effect.Effect<boolean, WorkspaceE2EError>;
  /** Whether native validation blocks the sign-in form's email. */
  readonly readSignInEmailBlocked: Effect.Effect<boolean, WorkspaceE2EError>;
  /** Clicks the accepted step's button that starts another sign-in. */
  readonly restartSignIn: (
    buttonLabel: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Types a code into the sign-in code step. */
  readonly enterSignInCode: (
    code: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until a rejected code left the code input empty and enabled. */
  readonly waitForEmptiedSignInCode: Effect.Effect<void, WorkspaceE2EError>;
  /** The completion form's login email: read-only, and showing the email. */
  readonly readCompletionLoginEmail: (email: string) => Effect.Effect<
    {
      readonly matches: boolean;
      readonly readOnly: boolean;
    },
    WorkspaceE2EError
  >;
  /** Waits until the profile's referral field holds exactly `code`. */
  readonly waitForReferralFieldValue: (
    description: string,
    code: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Types the value into a profile or billing field. */
  readonly fillProfileField: (
    field: AccountProfileField,
    value: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Submits the profile form. */
  readonly saveProfile: Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Waits until the profile form is the linked edit view, whose submit
   * control carries `submitLabel`.
   */
  readonly waitForLinkedProfileForm: (
    submitLabel: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** The linked profile's login email display: editable, and its email. */
  readonly readLinkedLoginEmail: (email: string) => Effect.Effect<
    {
      readonly editable: boolean;
      readonly matches: boolean;
    },
    WorkspaceE2EError
  >;
  /** Picks the business billing kind with the keyboard and waits for it. */
  readonly chooseBusinessBilling: Effect.Effect<void, WorkspaceE2EError>;
  /** Whether the profile and billing fields still hold these drafts. */
  readonly readProfileDrafts: (
    drafts: Readonly<Record<AccountProfileField, string>>
  ) => Effect.Effect<
    {
      readonly billingPreserved: boolean;
      readonly profilePreserved: boolean;
    },
    WorkspaceE2EError
  >;
  /** Waits until the account's reservations panel is shown. */
  readonly waitForReservationsPanel: (
    description: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Polls the page's interactive aria snapshot until `matches` accepts it;
   * an unreadable page counts as an empty snapshot.
   */
  readonly waitForSnapshot: (
    description: string,
    matches: (snapshot: string) => boolean,
    timeoutMs: number
  ) => Effect.Effect<string, WorkspaceE2EError>;
  /**
   * Opens the deletion dialog from the danger section, ticks its
   * confirmation and confirms the deletion.
   */
  readonly confirmAccountDeletion: Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the deletion dialog asks for reauthentication. */
  readonly waitForReauthenticationDialog: Effect.Effect<
    void,
    WorkspaceE2EError
  >;
  /** Asks the reauthentication dialog to send its sign-in email. */
  readonly sendReauthenticationLink: Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the profile panel is shown and hydrated. */
  readonly waitForProfilePanel: (
    description: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Waits until the profile's language control is labelled `label`, read
   * through the control's `labels` so CSS text-transform can't hide it.
   */
  readonly waitForLanguageControlLabel: (
    description: string,
    label: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until a main heading reads `heading`. */
  readonly waitForPageHeading: (
    description: string,
    heading: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Saves the language through the profile's language select. */
  readonly chooseLanguage: (
    locale: Locale
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Opens the profile's language select. */
  readonly openLanguageList: Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the open language list has `locale`'s option selected. */
  readonly waitForSelectedLanguage: (
    description: string,
    locale: Locale
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Presses Escape and reports whether the language list closed; an Escape
   * can land before the list listens for it.
   */
  readonly dismissLanguageList: Effect.Effect<boolean, WorkspaceE2EError>;
  /** Overwrites the page's locale cookie through `document.cookie`. */
  readonly setLocaleCookie: (
    locale: Locale
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Whether the page's locale cookie holds `locale`. */
  readonly hasLocaleCookie: (
    locale: Locale
  ) => Effect.Effect<boolean, WorkspaceE2EError>;
};

type AccountBrowserConfig = Pick<
  WorkspaceE2EConfig,
  "baseUrl" | "bypassSecret" | "timeouts"
>;

/** Whether the cowork form has the entry tier selected. */
const isCoworkEntryTierSelected = (entryTier: string) => {
  const tier = document.querySelector('input[name="entryTier"]:checked');
  return tier instanceof HTMLInputElement && tier.value === entryTier;
};

/** Whether Better Auth's session for the page's origin is the email's. */
const isSessionOf = async (email: string) => {
  const response = await fetch("/api/auth/get-session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (response.ok ? await response.json() : null) as {
    readonly user?: { readonly email?: string };
  } | null;
  return body?.user?.email === email;
};

/** Whether native validation holds a message for the input. */
const isInputValidationBlocked = (selector: string) => {
  const input = document.querySelector(selector);
  return input instanceof HTMLInputElement && input.validationMessage !== "";
};

/** Whether the input is enabled and empty. */
const isInputEnabledAndEmpty = (selector: string) => {
  const input = document.querySelector(selector);
  return (
    input instanceof HTMLInputElement && !input.disabled && input.value === ""
  );
};

/** Whether the login email input is read-only and holds the email. */
const readLoginEmailInput = ({
  email,
  selector,
}: {
  readonly email: string;
  readonly selector: string;
}) => {
  const input = document.querySelector(selector);
  return {
    matches: input instanceof HTMLInputElement && input.value === email,
    readOnly: input instanceof HTMLInputElement && input.readOnly,
  };
};

/** Whether the profile's referral field holds exactly the value. */
const hasReferralFieldValue = ({
  selector,
  value,
}: {
  readonly selector: string;
  readonly value: string;
}) => {
  const input = document.querySelector(selector);
  return (
    input instanceof HTMLInputElement &&
    input.name === "referralCode" &&
    input.value === value
  );
};

/** Whether the form's submit button is labelled `label`. */
const hasSubmitLabel = ({
  label,
  selector,
}: {
  readonly label: string;
  readonly selector: string;
}) => {
  const button = document.querySelector(selector);
  return (
    button instanceof HTMLButtonElement &&
    button.type === "submit" &&
    button.textContent?.trim() === label
  );
};

/**
 * The profile fieldset that shows the email: whether it holds a form
 * control, and whether it shows the email. No fieldset reads as editable.
 */
const readLoginEmailDisplay = ({
  email,
  profileSelector,
}: {
  readonly email: string;
  readonly profileSelector: string;
}) => {
  const profile = document.querySelector(profileSelector);
  const emailField =
    profile instanceof HTMLElement
      ? Array.from(profile.querySelectorAll("fieldset")).find((field) =>
          field.textContent?.includes(email)
        )
      : undefined;
  return {
    editable: emailField?.querySelector("input, textarea, select") !== null,
    matches: emailField?.textContent?.includes(email) === true,
  };
};

/** Whether the billing kind control holds the business kind. */
const isBusinessBillingKind = (selector: string) =>
  document.querySelector<HTMLSelectElement>(selector)?.value === "business";

/** Whether each field still holds its draft, grouped by form section. */
const readFieldDrafts = ({
  billing,
  profile,
}: {
  readonly billing: readonly (readonly [string, string])[];
  readonly profile: readonly (readonly [string, string])[];
}) => {
  const holds = ([selector, value]: readonly [string, string]) => {
    const input = document.querySelector(selector);
    return input instanceof HTMLInputElement && input.value === value;
  };
  return {
    billingPreserved: billing.every(holds),
    profilePreserved: profile.every(holds),
  };
};

/** Whether the landmark is on the page outside any hidden panel. */
const isLandmarkShown = (selector: string) => {
  const landmark = document.querySelector(selector);
  return landmark !== null && landmark.closest("[hidden]") === null;
};

/** Whether the panel is shown and React has hydrated it. */
const isPanelHydrated = (selector: string) => {
  const panel = document.querySelector(selector);
  return (
    panel !== null &&
    panel.closest("[hidden]") === null &&
    Object.keys(panel).some((key) => key.startsWith("__reactProps$"))
  );
};

/** Whether a control matching the selector is labelled `label`. */
const hasControlLabel = ({
  label,
  selector,
}: {
  readonly label: string;
  readonly selector: string;
}) =>
  Array.from(document.querySelectorAll(selector)).some((control) =>
    Array.from((control as HTMLButtonElement).labels ?? []).some(
      (labelElement) => labelElement.textContent?.trim() === label
    )
  );

/** Whether a main heading reads `heading`. */
const hasMainHeading = (heading: string) =>
  Array.from(document.querySelectorAll("h1")).some(
    (element) => element.textContent?.trim() === heading
  );

/** Whether the selected listbox option names the label. */
const isOptionSelected = (label: string) => {
  const selected = document.querySelector(
    '[role="option"][aria-selected="true"]'
  );
  return selected !== null && selected.textContent?.includes(label) === true;
};

/** Whether a listbox is open. */
const isListboxOpen = () => document.querySelector('[role="listbox"]') !== null;

/** Whether an element matches the selector. */
const hasElement = (selector: string) =>
  document.querySelector(selector) !== null;

/** Writes the cookie through `document.cookie`. */
const writeDocumentCookie = (cookie: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: The case overwrites the cookie as page script would, outside the server's Set-Cookie.
  document.cookie = cookie;
};

/** Whether `document.cookie` holds the exact `name=value` pair. */
const hasDocumentCookie = (cookie: string) =>
  document.cookie.split("; ").includes(cookie);

/**
 * The page steps over the session behind `run`'s `session` id, reached on
 * every call so a failure to open it fails the calling step. Polls reach it
 * on every read, as their argv reads did.
 */
const makeAccountBrowser = (
  config: AccountBrowserConfig,
  run: Runner,
  session: string
): WorkspaceE2EAccountBrowser => {
  const { timeouts } = config;
  const browserSession = Effect.suspend(() => browserSessionFor(run, session));
  const withSession = <A>(
    drive: (opened: E2EBrowserSession) => Effect.Effect<A, WorkspaceE2EError>
  ) => Effect.flatMap(browserSession, drive);
  return {
    open: (url) =>
      withSession((opened) =>
        openPage(opened, config, url, { timeoutMs: timeouts.browserAction })
      ),
    readText: withSession(readPageText),
    readUrl: withSession(readPageUrl).pipe(
      Effect.orElseSucceed(() => undefined)
    ),
    requestNewLinkAfterFailedCallback: (locale) =>
      withSession((opened) =>
        opened.use("click browser element", (page) =>
          page
            .locator("a")
            .filter({ hasText: m.accountCallbackFailedAction({}, { locale }) })
            .filter({ visible: true })
            .click({ timeout: timeouts.browserAction })
        )
      ),
    signOut: withSession((opened) =>
      opened.use("click browser element", (page) =>
        page
          .locator(signOutSelector)
          .filter({ visible: true })
          .click({ timeout: timeouts.browserAction })
      )
    ),
    submitSignInEmail: (email) =>
      Effect.andThen(
        withSession((opened) =>
          opened.use("fill browser field", (page) =>
            page
              .locator(signInEmailSelector)
              .filter({ visible: true })
              .fill(email, { timeout: timeouts.browserAction })
          )
        ),
        withSession((opened) =>
          opened.use("click browser element", (page) =>
            page
              .locator(signInSubmitSelector)
              .filter({ visible: true })
              .click({ timeout: timeouts.browserAction })
          )
        )
      ),
    switchLocale: (locale) =>
      withSession((opened) => switchLocale(opened, locale, timeouts)),
    waitForCoworkSelection: (description, entryTier) =>
      withSession((opened) =>
        waitForPageCondition(
          opened,
          description,
          isCoworkEntryTierSelected,
          entryTier,
          { timeoutMs: timeouts.uiTransition }
        )
      ),
    waitForSignInCodeInput: withSession((opened) =>
      waitForReactHandler(opened, signInCodeSelector, "onChange", {
        timeoutMs: timeouts.browserAction,
      })
    ),
    waitForSignInForm: withSession((opened) =>
      waitForReactFormSubmit(
        opened,
        signInFormSelector,
        [signInEmailSelector],
        { timeoutMs: timeouts.browserAction }
      )
    ),
    waitForText: (description, matches, timeoutMs) =>
      waitForPageText({
        description,
        matches,
        session: browserSession,
        timeoutMs,
      }),
    waitForUrl: (description, matches, timeoutMs) =>
      waitForPageUrl({
        description,
        matches,
        session: browserSession,
        timeoutMs,
      }),
  };
};

/**
 * Builds the lane browser over the runner's `session` id and the assistant's
 * `<session>-assistant` id.
 */
export const makeWorkspaceE2EAccountLaneBrowser = ({
  config,
  run,
  session,
}: {
  readonly config: AccountBrowserConfig;
  readonly run: Runner;
  readonly session: string;
}): WorkspaceE2EAccountLaneBrowser => {
  const withLaneSession = <A>(
    drive: (
      laneSession: E2EBrowserSession
    ) => Effect.Effect<A, WorkspaceE2EError>
  ) =>
    Effect.flatMap(
      Effect.suspend(() => browserSessionFor(run, session)),
      drive
    );
  const { browserAction, uiTransition } = config.timeouts;
  // As the argv `press` command, a key press has no timeout of its own; the
  // calling step bounds it.
  const press = (key: string) =>
    withLaneSession((laneSession) =>
      laneSession.use("press browser key", (page) => page.keyboard.press(key))
    );
  // An evaluation that overruns its bound fails rather than timing out, as
  // the argv `eval` it replaces did.
  const evaluate = <A, Arg>(
    label: string,
    read: (arg: Arg) => A | Promise<A>,
    arg: Arg
  ) =>
    withLaneSession((laneSession) =>
      laneSession
        .evaluate(label, read, arg, { timeoutMs: browserAction })
        .pipe(withoutWorkspaceE2ETimeout(label))
    );
  const waitFor = <Arg>(
    description: string,
    condition: (arg: Arg) => unknown,
    arg: Arg,
    timeoutMs: number
  ) =>
    withLaneSession((laneSession) =>
      waitForPageCondition(laneSession, description, condition, arg, {
        timeoutMs,
      })
    );
  const scopedLanguageTrigger = `${accountSectionLandmarks.profile} ${languageTriggerSelector}`;
  const openLanguageList = withLaneSession((laneSession) =>
    laneSession.use("click browser element", (page) =>
      page
        .locator(languageTriggerSelector)
        .filter({ visible: true })
        .click({ timeout: browserAction })
    )
  );
  const assistantSession = `${session}-assistant`;
  return {
    ...makeAccountBrowser(config, run, session),
    assistant: {
      ...makeAccountBrowser(config, run, assistantSession),
      close: Effect.suspend(() =>
        browserSessionFor(run, assistantSession)
      ).pipe(
        Effect.flatMap((assistant) => assistant.close()),
        Effect.timeout(config.timeouts.browserSessionClose),
        Effect.ignore
      ),
    },
    selectSection: (section) =>
      withLaneSession((laneSession) =>
        selectAccountSectionInSession(laneSession, section)
      ),
    waitForNoRememberedReferralCode: withLaneSession((laneSession) =>
      waitForNoRememberedReferralCode({ config, session: laneSession })
    ),
    waitForRememberedReferralCode: (code) =>
      withLaneSession((laneSession) =>
        waitForRememberedReferralCode({ config, session: laneSession }, code)
      ),
    chooseBusinessBilling: Effect.gen(function* () {
      yield* withLaneSession((laneSession) =>
        laneSession.use("focus browser element", (page) =>
          page
            .locator(billingKindSelector)
            .filter({ visible: true })
            .focus({ timeout: browserAction })
        )
      );
      yield* press("End");
      yield* press("Tab");
      yield* waitFor(
        "business billing kind",
        isBusinessBillingKind,
        billingKindSelector,
        uiTransition
      );
    }),
    chooseLanguage: Effect.fn("chooseLanguage")(function* (locale: Locale) {
      yield* withLaneSession((laneSession) =>
        waitForReactHandler(
          laneSession,
          scopedLanguageTrigger,
          "onPointerDown",
          { timeoutMs: uiTransition }
        )
      );
      yield* openLanguageList;
      yield* withLaneSession((laneSession) =>
        laneSession.use("click browser element", (page) =>
          page
            .locator('[role="option"]')
            .filter({ hasText: languageOptionLabels[locale] })
            .filter({ visible: true })
            .click({ timeout: browserAction })
        )
      );
    }),
    confirmAccountDeletion: Effect.gen(function* () {
      yield* withLaneSession((laneSession) =>
        laneSession.use("click browser element", (page) =>
          page
            .locator(deleteTriggerSelector)
            .filter({ visible: true })
            .click({ timeout: browserAction })
        )
      );
      yield* waitFor(
        "deletion confirmation dialog",
        hasElement,
        deleteConfirmSelector,
        browserAction
      );
      yield* withLaneSession((laneSession) =>
        laneSession.use("click browser element", (page) =>
          page
            .locator(deleteConfirmCheckboxSelector)
            .filter({ visible: true })
            .click({ timeout: browserAction })
        )
      );
      yield* withLaneSession((laneSession) =>
        laneSession.use("click browser element", (page) =>
          page
            .locator(deleteConfirmSelector)
            .filter({ visible: true })
            .click({ timeout: browserAction })
        )
      );
    }),
    dismissLanguageList: Effect.gen(function* () {
      yield* press("Escape");
      const open = yield* evaluate(
        "check whether the language list is still open",
        isListboxOpen,
        undefined
      );
      return !open;
    }),
    enterSignInCode: (code) =>
      withLaneSession((laneSession) =>
        laneSession.use("fill browser field", (page) =>
          page
            .locator(signInCodeSelector)
            .filter({ visible: true })
            .fill(code, { timeout: browserAction })
        )
      ),
    fillProfileField: (field, value) =>
      withLaneSession((laneSession) =>
        laneSession.use("fill browser field", (page) =>
          page
            .locator(accountProfileFieldSelectors[field])
            .filter({ visible: true })
            .fill(value, { timeout: browserAction })
        )
      ),
    hasLocaleCookie: (locale) =>
      evaluate(
        "read the locale cookie",
        hasDocumentCookie,
        `${localeCookieName}=${locale}`
      ),
    openLanguageList,
    readCompletionLoginEmail: (email) =>
      evaluate(
        "assert the completion login email is read-only",
        readLoginEmailInput,
        { email, selector: profileEmailSelector }
      ),
    readLinkedLoginEmail: (email) =>
      evaluate(
        "assert the linked login email display is read-only",
        readLoginEmailDisplay,
        { email, profileSelector: accountSectionLandmarks.profile }
      ),
    readProfileDrafts: (drafts) =>
      evaluate(
        "assert profile and billing drafts survived section navigation",
        readFieldDrafts,
        {
          billing: [
            [
              accountProfileFieldSelectors.billingCompanyName,
              drafts.billingCompanyName,
            ],
          ],
          profile: (["firstName", "lastName", "phone"] as const).map(
            (field) =>
              [accountProfileFieldSelectors[field], drafts[field]] as const
          ),
        }
      ),
    readSessionMatches: (email) =>
      evaluate("read the browser session's account", isSessionOf, email),
    readSignInEmailBlocked: evaluate(
      "assert native validation blocked the invalid email",
      isInputValidationBlocked,
      signInEmailSelector
    ),
    restartSignIn: (buttonLabel) =>
      withLaneSession((laneSession) =>
        laneSession.use("click browser element", (page) =>
          page
            .locator("button")
            .filter({ hasText: buttonLabel })
            .filter({ visible: true })
            .click({ timeout: browserAction })
        )
      ),
    saveProfile: withLaneSession((laneSession) =>
      laneSession.use("click browser element", (page) =>
        page
          .locator(profileSubmitSelector)
          .filter({ visible: true })
          .click({ timeout: browserAction })
      )
    ),
    sendReauthenticationLink: withLaneSession((laneSession) =>
      laneSession.use("click browser element", (page) =>
        page
          .locator(deleteReauthSendSelector)
          .filter({ visible: true })
          .click({ timeout: browserAction })
      )
    ),
    setLocaleCookie: (locale) =>
      evaluate(
        `overwrite the locale cookie with ${locale}`,
        writeDocumentCookie,
        `${localeCookieName}=${locale}; path=/`
      ),
    waitForEmptiedSignInCode: waitFor(
      "emptied code input after a wrong code",
      isInputEnabledAndEmpty,
      signInCodeSelector,
      uiTransition
    ),
    waitForLanguageControlLabel: (description, label) =>
      waitFor(
        `${description} language control label`,
        hasControlLabel,
        { label, selector: scopedLanguageTrigger },
        uiTransition
      ),
    waitForLinkedProfileForm: (submitLabel) =>
      waitFor(
        "linked account edit form with its Save profile submit control",
        hasSubmitLabel,
        { label: submitLabel, selector: profileSubmitSelector },
        uiTransition
      ),
    waitForPageHeading: (description, heading) =>
      waitFor(`${description} heading`, hasMainHeading, heading, uiTransition),
    waitForProfilePanel: (description) =>
      waitFor(
        `${description} panel`,
        isPanelHydrated,
        accountSectionLandmarks.profile,
        uiTransition
      ),
    waitForReauthenticationDialog: waitFor(
      "reauthentication dialog",
      hasElement,
      deleteReauthSendSelector,
      browserAction
    ),
    waitForReferralFieldValue: (description, code) =>
      waitFor(
        description,
        hasReferralFieldValue,
        { selector: profileReferralCodeSelector, value: code },
        uiTransition
      ),
    waitForReservationsPanel: (description) =>
      waitFor(
        description,
        isLandmarkShown,
        accountSectionLandmarks.reservations,
        uiTransition
      ),
    waitForSelectedLanguage: (description, locale) =>
      waitFor(
        description,
        isOptionSelected,
        languageOptionLabels[locale],
        uiTransition
      ),
    waitForSnapshot: (description, matches, timeoutMs) =>
      waitForPageSnapshot({
        description,
        matches,
        session: Effect.suspend(() => browserSessionFor(run, session)),
        timeoutMs,
      }),
  };
};
