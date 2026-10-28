import type { Locator, Page } from "@playwright/test";
import { Effect } from "effect";
import type { AccountSection } from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import {
  openPage,
  readPageText,
  readPageUrl,
  waitForPageCondition,
  waitForPageText,
  waitForPageUrl,
  waitForReactFormSubmit,
  waitForReactHandler,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import { switchLocale } from "../cases/locale";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import { browserSessionFor, type Runner } from "../runtime";
import { selectAccountSectionInSession } from "./account-sections";

const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const signInCodeSelector = "#account-sign-in-code";
const signOutSelector = "#account-sign-out";

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
     * `browserSessionClose` is ignored; the lane runner's Scope still closes
     * a session that outlives the wait.
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
};

type AccountBrowserConfig = Pick<
  WorkspaceE2EConfig,
  "baseUrl" | "bypassSecret" | "timeouts"
>;

/** Whether the cowork form has the entry tier selected. */
export const isCoworkEntryTierSelected = (entryTier: string) => {
  const tier = document.querySelector('input[name="entryTier"]:checked');
  return tier instanceof HTMLInputElement && tier.value === entryTier;
};

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
  const click = (label: string, locate: (page: Page) => Locator) =>
    withSession((opened) =>
      opened.use(label, (page) =>
        locate(page)
          .filter({ visible: true })
          .click({ timeout: timeouts.browserAction })
      )
    );
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
      click("click browser element", (page) =>
        page
          .locator("a")
          .filter({ hasText: m.accountCallbackFailedAction({}, { locale }) })
      ),
    signOut: click("click browser element", (page) =>
      page.locator(signOutSelector)
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
        click("click browser element", (page) =>
          page.locator(signInSubmitSelector)
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
  };
};
