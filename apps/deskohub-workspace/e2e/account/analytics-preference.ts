import "../../shared/polyfills/temporal";

import type { Browser, BrowserContext, Page, Request } from "@playwright/test";
import { expect } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { accountAnalyticsConsentDecisions } from "@/db/schema/account-analytics-consent-decisions";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { m } from "@/features/i18n";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import {
  CONSENT_COOKIE_NAME,
  readConsentCookieChoice,
} from "@/shared/utils/consent-cookie";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { preparePublicLegalBrowser } from "../instant-navigation/public-account-legal-assertions";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import {
  dismissLegalCookieConsent,
  hasReactClickHandler,
} from "../legal-cookie-consent";
import { assert } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

const locale = "en-US" as const;
const accountLegalPath = `/${locale}/account/legal`;
const accountAuthCookieMarker = "better-auth.";
const accountSessionCookieSuffix = "session_token";
const accountPreferenceSwitchSelector = "#account-analytics-preference";

type AnalyticsPreferenceOperation =
  | "open analytics preference device"
  | "decline analytics preference device banner"
  | "sign in analytics preference device"
  | "assert initial analytics preference"
  | "grant account analytics preference"
  | "withdraw account analytics preference"
  | "read analytics preference device cookie"
  | "close analytics preference device";

type AnalyticsDecisionRow =
  typeof accountAnalyticsConsentDecisions.$inferSelect;

export type WorkspaceE2EAnalyticsPreferenceInput = {
  /** The signed-in synthetic account, which owns its ledger rows. */
  readonly accountId: CustomerAccountId;
  readonly baseUrl: string;
  readonly browser: Browser;
  /** The lane's authenticated page; only its cookies are read. */
  readonly page: Page;
};

const runBrowserOperation = <A>(
  operation: AnalyticsPreferenceOperation,
  execute: () => Promise<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.tryPromise({
    catch: () =>
      workspaceE2EError(
        `Account analytics preference verification failed during ${operation}`,
        { operation }
      ),
    try: execute,
  });

const readAnalyticsDecisions = Effect.fn("readAnalyticsDecisions")(function* (
  accountId: CustomerAccountId
) {
  const { db } = yield* E2EDatabase;
  return yield* runDatabaseOperation(
    "read account analytics consent decisions",
    db
      .select()
      .from(accountAnalyticsConsentDecisions)
      .where(eq(accountAnalyticsConsentDecisions.accountId, accountId))
      .orderBy(
        asc(accountAnalyticsConsentDecisions.decidedAt),
        asc(accountAnalyticsConsentDecisions.id)
      )
  );
});

const accountPreferenceSwitch = (page: Page) =>
  page.getByRole("switch", {
    exact: true,
    name: m.analyticsPreferenceTitle({}, { locale }),
  });

const deviceAnalyticsSwitch = (page: Page) =>
  page.getByRole("switch", {
    exact: true,
    name: m.cookieSettingsAnalyticsTitle({}, { locale }),
  });

const accountPreferenceRow = (page: Page) =>
  page.locator('[data-analytics-preference="available"]');

const checkedState = (checked: boolean) => (checked ? "true" : "false");

/**
 * Whether `request` calls the device consent recording Server Action for
 * `occasion`: the account consent mirror's request after a page hydrates
 * signed in, or after a banner save in the tab.
 */
const recordsDeviceConsent =
  (occasion: "hydration" | "banner_save") => (request: Request) =>
    request.method() === "POST" &&
    request.headers()["next-action"] !== undefined &&
    (request.postData() ?? "").includes(`"occasion":"${occasion}"`);

/**
 * Opens a second device for the lane's account: the lane's preview-access
 * cookies first, so the cookie banner is declined while signed out and no
 * banner decision reaches the account, then the lane's auth cookies. The
 * device runs as an ordinary browser so the consent vendor hydrates, which
 * it skips under `navigator.webdriver`; the lane's own page stays as it is.
 */
const openSignedInDevice = async (
  input: WorkspaceE2EAnalyticsPreferenceInput
): Promise<AnalyticsPreferenceDevice> => {
  const laneCookies = (await input.page.context().cookies()).filter(
    ({ name }) => name !== CONSENT_COOKIE_NAME
  );
  const authCookies = laneCookies.filter(({ name }) =>
    name.includes(accountAuthCookieMarker)
  );
  assert(
    authCookies.some(({ name }) => name.endsWith(accountSessionCookieSuffix)),
    "The account lane page holds no account session cookie"
  );

  const context = await input.browser.newContext({ baseURL: input.baseUrl });
  try {
    await preparePublicLegalBrowser(context);
    await context.addCookies(
      laneCookies.filter(({ name }) => !name.includes(accountAuthCookieMarker))
    );
    const page = await context.newPage();
    return { context, page };
  } catch (cause) {
    await context.close();
    throw cause;
  }
};

const declineBannerSignedOut = async (page: Page, baseUrl: string) => {
  await page.goto(new URL(accountLegalPath, baseUrl).toString(), {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  await dismissLegalCookieConsent(page, locale);
  await expect(accountPreferenceSwitch(page)).toHaveCount(0);
};

const signInDevice = async (
  context: BrowserContext,
  page: Page,
  input: WorkspaceE2EAnalyticsPreferenceInput
) => {
  const authCookies = (await input.page.context().cookies()).filter(
    ({ name }) => name.includes(accountAuthCookieMarker)
  );
  await context.addCookies(authCookies);
  // The mirror sends its hydration request once the session verified the
  // account, which the switch reads when a save is sent; waiting for it also
  // keeps the mirror's own write out of the toggles.
  await Promise.all([
    page.waitForResponse(
      (response) => recordsDeviceConsent("hydration")(response.request()),
      { timeout: workspaceE2ETimeouts.browserNavigation }
    ),
    page.reload({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    }),
  ]);
  await expect(accountPreferenceSwitch(page)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  await page.waitForFunction(
    hasReactClickHandler,
    accountPreferenceSwitchSelector,
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
};

const expectSwitchStates = async (
  page: Page,
  { account, device }: { readonly account: boolean; readonly device: boolean }
) => {
  await expect(accountPreferenceSwitch(page)).toHaveAttribute(
    "aria-checked",
    checkedState(account),
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  await expect(deviceAnalyticsSwitch(page)).toHaveAttribute(
    "aria-checked",
    checkedState(device),
    { timeout: workspaceE2ETimeouts.browserAction }
  );
};

/**
 * Turns the account preference to `granted` through a trusted click and
 * waits until the save settled: the switch holds the new value, is enabled
 * again, reports no error, and this device's analytics switch followed it,
 * which happens only after the server confirmed the save.
 */
const toggleAccountPreference = async (page: Page, granted: boolean) => {
  const preferenceSwitch = accountPreferenceSwitch(page);
  await expect(preferenceSwitch).toBeEnabled();
  await expect(preferenceSwitch).toHaveAttribute(
    "aria-checked",
    checkedState(!granted)
  );
  await preferenceSwitch.click({ timeout: workspaceE2ETimeouts.browserAction });
  await expectSwitchStates(page, { account: granted, device: granted });
  await expect(preferenceSwitch).toBeEnabled({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(accountPreferenceRow(page).getByRole("alert")).toBeEmpty();
  await page.waitForFunction(
    hasReactClickHandler,
    accountPreferenceSwitchSelector,
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
};

const readDeviceChoice = async (context: BrowserContext) => {
  const cookieHeader = (await context.cookies())
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  return readConsentCookieChoice(cookieHeader, {
    revision: getConsentBannerRevision(),
  });
};

const sameInstant = (left: Temporal.Instant, right: Temporal.Instant) =>
  left.epochNanoseconds === right.epochNanoseconds;

const deviceDecisionFailure = (message: string) =>
  workspaceE2EError(message, {
    operation: "assert analytics preference device decision",
  });

const ledgerDecisionFailure = (message: string) =>
  workspaceE2EError(message, {
    diagnosticCode: "postgres_account_fixture_assertion_failed",
    operation: "assert account analytics preference decision",
  });

/**
 * The device's saved choice after the account preference save recorded as
 * `decision`: analytics accepted exactly when granted, and dated at the
 * ledger row's instant truncated to the millisecond.
 */
const requireDeviceTookDecision = Effect.fn("requireDeviceTookDecision")(
  function* (context: BrowserContext, decision: AnalyticsDecisionRow) {
    const choice = yield* runBrowserOperation(
      "read analytics preference device cookie",
      () => readDeviceChoice(context)
    );
    if (Option.isNone(choice)) {
      return yield* deviceDecisionFailure(
        "The device holds no consent choice after the account preference save"
      );
    }
    if (
      choice.value.acceptedCategories.includes("analytics") !==
      (decision.decision === "grant")
    ) {
      return yield* deviceDecisionFailure(
        `The device's analytics choice does not match the account's ${decision.decision}`
      );
    }
    const decidedAt = decision.decidedAt.round({
      roundingMode: "trunc",
      smallestUnit: "millisecond",
    });
    if (
      Option.isNone(choice.value.lastConsentAt) ||
      !sameInstant(choice.value.lastConsentAt.value, decidedAt)
    ) {
      return yield* deviceDecisionFailure(
        `The device's consent is not dated at the account's ${decision.decision}`
      );
    }
  }
);

/**
 * The decisions the switch recorded since `knownIds`: exactly one new
 * `preference` row, carrying `decision`, and no new `banner` row. Returns
 * that row and every row now known, mirrors included.
 */
const requireRecordedPreference = Effect.fn("requireRecordedPreference")(
  function* (
    accountId: CustomerAccountId,
    knownIds: ReadonlySet<string>,
    decision: AnalyticsDecisionRow["decision"]
  ) {
    const rows = yield* readAnalyticsDecisions(accountId);
    const added = rows.filter(({ id }) => !knownIds.has(id));
    if (added.some(({ source }) => source === "banner")) {
      return yield* ledgerDecisionFailure(
        "The account analytics preference recorded a banner decision"
      );
    }
    const [recorded, ...extra] = added.filter(
      ({ source }) => source === "preference"
    );
    if (!recorded || extra.length > 0 || recorded.decision !== decision) {
      return yield* ledgerDecisionFailure(
        `The account analytics preference did not record one ${decision}`
      );
    }
    return {
      knownIds: new Set(rows.map(({ id }) => id)),
      recorded,
    };
  }
);

type AnalyticsPreferenceDevice = {
  readonly context: BrowserContext;
  readonly page: Page;
};

const exercisePreferenceOnDevice = Effect.fn("exercisePreferenceOnDevice")(
  function* (
    input: WorkspaceE2EAnalyticsPreferenceInput,
    { context, page }: AnalyticsPreferenceDevice
  ) {
    yield* runBrowserOperation(
      "decline analytics preference device banner",
      () => declineBannerSignedOut(page, input.baseUrl)
    );
    yield* runBrowserOperation("sign in analytics preference device", () =>
      signInDevice(context, page, input)
    );
    yield* runBrowserOperation("assert initial analytics preference", () =>
      expectSwitchStates(page, { account: false, device: false })
    );

    // A banner save announced while the switch applies its decision would
    // send this request before the device switch follows the decision.
    let bannerSaves = 0;
    const countBannerSave = (request: Request) => {
      if (recordsDeviceConsent("banner_save")(request)) bannerSaves += 1;
    };
    page.on("request", countBannerSave);

    let knownIds: ReadonlySet<string> = new Set(
      (yield* readAnalyticsDecisions(input.accountId)).map(({ id }) => id)
    );
    for (const granted of [true, false]) {
      yield* runBrowserOperation(
        granted
          ? "grant account analytics preference"
          : "withdraw account analytics preference",
        () => toggleAccountPreference(page, granted)
      );
      const recording = yield* requireRecordedPreference(
        input.accountId,
        knownIds,
        granted ? "grant" : "withdraw"
      );
      yield* requireDeviceTookDecision(context, recording.recorded);
      if (bannerSaves > 0) {
        return yield* deviceDecisionFailure(
          "The account analytics preference sent a banner save"
        );
      }
      knownIds = recording.knownIds;
    }
  }
);

/**
 * Verifies the account analytics preference on /account/legal through its
 * Server Action bridge: on a second device of the lane's signed-in account,
 * turning the switch on records a `preference` grant and accepts analytics on
 * the device, and turning it off records a `preference` withdrawal and
 * declines analytics, each dated on the device at the recorded decision. The
 * account ends withdrawn, as the declined banner left the device.
 */
export const verifyWorkspaceE2EAnalyticsPreference = Effect.fn(
  "verifyWorkspaceE2EAnalyticsPreference"
)(function* (input: WorkspaceE2EAnalyticsPreferenceInput) {
  yield* Effect.acquireUseRelease(
    runBrowserOperation("open analytics preference device", () =>
      openSignedInDevice(input)
    ),
    (device) => exercisePreferenceOnDevice(input, device),
    ({ context }) =>
      runBrowserOperation("close analytics preference device", () =>
        context.close()
      ).pipe(Effect.ignore)
  );
});
