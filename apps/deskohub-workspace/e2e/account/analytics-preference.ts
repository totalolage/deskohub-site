import "../../shared/polyfills/temporal";

import type { Page, Request, Response } from "@playwright/test";
import { expect } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { Data, Duration, Effect, Option, Schedule } from "effect";
import { accountAnalyticsConsentDecisions } from "@/db/schema/account-analytics-consent-decisions";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { m } from "@/features/i18n";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { readConsentCookieChoice } from "@/shared/utils/consent-cookie";
import { openPage } from "../browser";
import type {
  E2EBrowserSession,
  OpenE2EBrowserSession,
} from "../browser-session";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { preparePublicLegalBrowser } from "../instant-navigation/public-account-legal-assertions";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import {
  cookieBannerNecessaryOnlyButton,
  hasReactClickHandler,
} from "../legal-cookie-consent";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  signInWorkspaceE2ESyntheticAccount,
  type WorkspaceE2ESessionSigningSecret,
} from "./seeded-session";

const locale = "en-US" as const;
const accountLegalPath = `/${locale}/account/legal`;
const accountPreferenceSwitchSelector = "#account-analytics-preference";

type AnalyticsPreferenceOperation =
  | "open analytics preference device"
  | "decline analytics preference device banner"
  | "sign in analytics preference device"
  | "assert initial analytics preference"
  | "grant account analytics preference"
  | "withdraw account analytics preference"
  | "count analytics preference banner saves"
  | "read analytics preference device cookie";

type AnalyticsDecisionRow =
  typeof accountAnalyticsConsentDecisions.$inferSelect;

export type WorkspaceE2EAnalyticsPreferenceInput = {
  /** The signed-in synthetic account, which owns its ledger rows. */
  readonly accountId: CustomerAccountId;
  readonly baseUrl: string;
  readonly bypassSecret: string | undefined;
  /** Opens the second device's own browser session, in its own context. */
  readonly openDevice: OpenE2EBrowserSession;
  /** Signs the second device's seeded session for the account. */
  readonly sessionSecret: WorkspaceE2ESessionSigningSecret;
};

const driveDevice = <A>(
  device: E2EBrowserSession,
  operation: AnalyticsPreferenceOperation,
  drive: (page: Page) => Promise<A>,
  deadline?: Parameters<E2EBrowserSession["use"]>[2]
) => device.use(operation, drive, deadline);

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
 * Prepares the second device's context before its first page load: it runs
 * as an ordinary browser so the consent vendor hydrates, which it skips under
 * `navigator.webdriver`. The device starts signed out with its own session.
 */
const prepareDevice = (device: E2EBrowserSession) =>
  driveDevice(device, "open analytics preference device", (page) =>
    preparePublicLegalBrowser(page.context())
  );

/**
 * Declines the cookie banner while the device is signed out, so no banner
 * decision reaches the account. It waits for the banner itself: the page's
 * own analytics switch hydrates before the banner opens, and a device left
 * without a saved choice never sends the signed-in hydration mirror.
 */
const declineBannerSignedOut = (
  device: E2EBrowserSession,
  input: WorkspaceE2EAnalyticsPreferenceInput
) =>
  openPage(device, input, new URL(accountLegalPath, input.baseUrl).toString(), {
    timeoutMs: workspaceE2ETimeouts.browserNavigation,
  }).pipe(
    Effect.andThen(
      driveDevice(
        device,
        "decline analytics preference device banner",
        async (page) => {
          const necessaryOnly = cookieBannerNecessaryOnlyButton(page, locale);
          await necessaryOnly.click({
            timeout: workspaceE2ETimeouts.uiTransition,
          });
          await expect(necessaryOnly).toBeHidden({
            timeout: workspaceE2ETimeouts.browserAction,
          });
          await expect(accountPreferenceSwitch(page)).toHaveCount(0);
        }
      )
    ),
    Effect.andThen(requireDeviceDeclinedAnalytics(device))
  );

/**
 * A signed-in reload whose client session read Better Auth answered with 429.
 * Its per-IP limit counts every case sharing the runner's address, and a page
 * whose read fails never verifies the account, so its mirror stays silent.
 * The page reads the session again only on a later load, or on a focus,
 * online or visibility change, none of which happens here.
 */
class SessionReadRateLimited extends Data.TaggedError(
  "SessionReadRateLimited"
)<{
  readonly retryAfter: Duration.Duration;
}> {}

/** Better Auth's default rate limit window, for a 429 without its delay. */
const sessionReadRateLimitWindow = Duration.seconds(10);

const isRateLimitedSessionRead = (response: Response) =>
  response.status() === 429 &&
  new URL(response.url()).pathname === "/api/auth/get-session";

/** The delay Better Auth's `X-Retry-After` header asks for, in seconds. */
const retryAfterOf = (response: Response) => {
  const seconds = Number(response.headers()["x-retry-after"]);
  return Number.isFinite(seconds) && seconds >= 0
    ? Duration.seconds(seconds)
    : sessionReadRateLimitWindow;
};

/**
 * Reloads the device after its seeded session cookie was set and waits for
 * the mirror's hydration request, which it sends once the session verified
 * the account; the switch reads that account when a save is sent, and
 * waiting also keeps the mirror's own write out of the toggles. Returns the
 * retry delay instead when the page's session read was rate limited and no
 * other read let the mirror send its request. The wait for an already sent
 * mirror request has no Playwright timeout of its own, so the caller bounds
 * the whole callback through the session deadline.
 */
const reloadUntilMirrored = async (page: Page) => {
  const timeout = workspaceE2ETimeouts.browserNavigation;
  let mirror: Request | undefined;
  const noteMirror = (request: Request) => {
    if (recordsDeviceConsent("hydration")(request)) mirror ??= request;
  };
  page.on("request", noteMirror);
  try {
    const [settled] = await Promise.all([
      page.waitForResponse(
        (response) =>
          recordsDeviceConsent("hydration")(response.request()) ||
          isRateLimitedSessionRead(response),
        { timeout }
      ),
      page.reload({ timeout, waitUntil: "load" }),
    ]);
    if (!isRateLimitedSessionRead(settled)) return Option.none();
    if (mirror === undefined) return Option.some(retryAfterOf(settled));
    await mirror.response();
    return Option.none();
  } finally {
    page.off("request", noteMirror);
  }
};

/** Waits until the account preference is visible and interactive. */
const waitForAccountPreference = async (page: Page) => {
  await expect(accountPreferenceSwitch(page)).toBeVisible({
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  await page.waitForFunction(
    hasReactClickHandler,
    accountPreferenceSwitchSelector,
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
};

/**
 * Reloads the device until the mirror's hydration request is sent. A
 * rate-limited session read is retried after the delay Better Auth asks for,
 * at most twice; each reload, including the wait for a mirror request already
 * sent, is bounded by one navigation. Exported for its colocated test.
 */
export const reloadDeviceUntilMirrored = (device: E2EBrowserSession) =>
  driveDevice(
    device,
    "sign in analytics preference device",
    (page) => reloadUntilMirrored(page),
    { timeoutMs: workspaceE2ETimeouts.browserNavigation }
  ).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (retryAfter) =>
          Effect.fail(new SessionReadRateLimited({ retryAfter })),
      })
    ),
    Effect.retry({
      schedule: Schedule.recurs(2).pipe(
        Schedule.setInputType<SessionReadRateLimited | WorkspaceE2EError>(),
        Schedule.passthrough,
        Schedule.modifyDelay((failure) =>
          Effect.succeed(
            failure._tag === "SessionReadRateLimited"
              ? failure.retryAfter
              : Duration.zero
          )
        )
      ),
      while: (failure) => failure._tag === "SessionReadRateLimited",
    }),
    Effect.catchTag("SessionReadRateLimited", () =>
      Effect.fail(
        workspaceE2EError(
          "The device's session read stayed rate limited after signing in",
          { operation: "sign in analytics preference device" }
        )
      )
    )
  );

/**
 * Signs the device's page in by reloading it until the mirror's hydration
 * request is sent, then waits until the account preference is visible and
 * interactive.
 */
const reloadSignedIn = (device: E2EBrowserSession) =>
  reloadDeviceUntilMirrored(device).pipe(
    Effect.andThen(
      driveDevice(
        device,
        "sign in analytics preference device",
        waitForAccountPreference
      )
    )
  );

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
 * which happens only after the server confirmed the save. The readiness
 * check, the click and the settle wait are separate session uses, so a step
 * deadline that interrupts the check starts no click.
 */
const toggleAccountPreference = (
  device: E2EBrowserSession,
  granted: boolean
) => {
  const operation = granted
    ? "grant account analytics preference"
    : "withdraw account analytics preference";
  return driveDevice(device, operation, async (page) => {
    const preferenceSwitch = accountPreferenceSwitch(page);
    await expect(preferenceSwitch).toBeEnabled();
    await expect(preferenceSwitch).toHaveAttribute(
      "aria-checked",
      checkedState(!granted)
    );
  }).pipe(
    Effect.andThen(
      driveDevice(device, operation, (page) =>
        accountPreferenceSwitch(page)
          .filter({ visible: true })
          .click({ timeout: workspaceE2ETimeouts.browserAction })
      )
    ),
    Effect.andThen(
      driveDevice(device, operation, async (page) => {
        await expectSwitchStates(page, { account: granted, device: granted });
        await expect(accountPreferenceSwitch(page)).toBeEnabled({
          timeout: workspaceE2ETimeouts.browserAction,
        });
        await expect(accountPreferenceRow(page).getByRole("alert")).toBeEmpty();
        await page.waitForFunction(
          hasReactClickHandler,
          accountPreferenceSwitchSelector,
          { timeout: workspaceE2ETimeouts.uiTransition }
        );
      })
    )
  );
};

/** The device's saved consent choice, read from the page's own cookies. */
const readDeviceChoice = (device: E2EBrowserSession) =>
  device
    .evaluate(
      "read analytics preference device cookie",
      () => document.cookie,
      undefined
    )
    .pipe(
      Effect.map((cookieHeader) =>
        readConsentCookieChoice(cookieHeader, {
          revision: getConsentBannerRevision(),
        })
      )
    );

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

/** Fails unless the device saved a choice that declines analytics. */
const requireDeviceDeclinedAnalytics = Effect.fn(
  "requireDeviceDeclinedAnalytics"
)(function* (device: E2EBrowserSession) {
  const choice = yield* readDeviceChoice(device);
  if (
    Option.isNone(choice) ||
    choice.value.acceptedCategories.includes("analytics")
  ) {
    return yield* deviceDecisionFailure(
      "The device saved no choice declining analytics before signing in"
    );
  }
});

/**
 * The device's saved choice after the account preference save recorded as
 * `decision`: analytics accepted exactly when granted, and dated at the
 * ledger row's instant truncated to the millisecond.
 */
const requireDeviceTookDecision = Effect.fn("requireDeviceTookDecision")(
  function* (device: E2EBrowserSession, decision: AnalyticsDecisionRow) {
    const choice = yield* readDeviceChoice(device);
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

const exercisePreferenceOnDevice = Effect.fn("exercisePreferenceOnDevice")(
  function* (
    input: WorkspaceE2EAnalyticsPreferenceInput,
    device: E2EBrowserSession
  ) {
    yield* prepareDevice(device);
    yield* declineBannerSignedOut(device, input);
    yield* signInWorkspaceE2ESyntheticAccount({
      accountId: input.accountId,
      baseUrl: input.baseUrl,
      secret: input.sessionSecret,
      session: device,
    });
    yield* reloadSignedIn(device);
    yield* driveDevice(device, "assert initial analytics preference", (page) =>
      expectSwitchStates(page, { account: false, device: false })
    );

    // A banner save announced while the switch applies its decision would
    // send this request before the device switch follows the decision.
    let bannerSaves = 0;
    const countBannerSave = (request: Request) => {
      if (recordsDeviceConsent("banner_save")(request)) bannerSaves += 1;
    };
    yield* driveDevice(
      device,
      "count analytics preference banner saves",
      async (page) => {
        page.on("request", countBannerSave);
      }
    );

    let knownIds: ReadonlySet<string> = new Set(
      (yield* readAnalyticsDecisions(input.accountId)).map(({ id }) => id)
    );
    for (const granted of [true, false]) {
      yield* toggleAccountPreference(device, granted);
      const recording = yield* requireRecordedPreference(
        input.accountId,
        knownIds,
        granted ? "grant" : "withdraw"
      );
      yield* requireDeviceTookDecision(device, recording.recorded);
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
 * Server Action bridge: on a second device, signed in to the lane's account
 * through its own seeded session, turning the switch on records a
 * `preference` grant and accepts analytics on the device, and turning it off
 * records a `preference` withdrawal and declines analytics, each dated on the
 * device at the recorded decision. The
 * account ends withdrawn, as the declined banner left the device.
 */
export const verifyWorkspaceE2EAnalyticsPreference = Effect.fn(
  "verifyWorkspaceE2EAnalyticsPreference"
)(function* (input: WorkspaceE2EAnalyticsPreferenceInput) {
  yield* Effect.scoped(
    Effect.acquireRelease(
      input.openDevice,
      (device) =>
        device
          .close()
          .pipe(
            Effect.timeout(workspaceE2ETimeouts.browserSessionClose),
            Effect.ignore
          ),
      { interruptible: true }
    ).pipe(
      Effect.flatMap((device) => exercisePreferenceOnDevice(input, device))
    )
  );
});
