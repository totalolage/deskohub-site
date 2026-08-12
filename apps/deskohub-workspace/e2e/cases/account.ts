import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { customerAccountLinks } from "@/db/schema";
import { customerAccountIdSchema } from "@/features/account/contracts";
import {
  clickBrowserElement,
  evalBrowserScript,
  fillBrowserField,
  openBrowserPage,
  waitForBrowserCondition,
  waitForBrowserReactHydration,
  waitForBrowserTextContent,
  waitForBrowserUrl,
} from "../browser";
import { getWorkspaceE2EDateInterval } from "../capacity";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runRetrySafeDatabaseOperation } from "../integrations/database-operation";
import {
  cancelDotyposReservation,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import {
  type NeonAuthMagicLinkCapture,
  useNeonAuthMagicLinkCapture,
} from "../integrations/neon-auth";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import { executeZeroTotalCheckout } from "./checkout-zero-total";

type BrowserAuthSession = {
  readonly user: {
    readonly email: string;
    readonly id: string;
    readonly name: string;
  };
};

export const executeCustomerAccountLifecycle = ({
  config,
  data,
  datasourceConfig,
  discountCode,
  run,
  runStep,
  session,
  state,
  submitReservationScript,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly discountCode: string;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly submitReservationScript: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const neonAuth = datasourceConfig.neonAuth;
    assert(
      neonAuth,
      "Neon Auth configuration is required for customer account e2e"
    );
    yield* executeZeroTotalCheckout({
      config,
      data,
      datasourceConfig,
      discountCode,
      run,
      runStep,
      session,
      state,
      submitReservationScript,
    });

    yield* runStep({
      execute: assertProtectedAccountRedirect(config, run, session),
      id: "assert-account-requires-authentication",
      timeoutMs: config.timeouts.uiTransition,
    });

    yield* useNeonAuthMagicLinkCapture(neonAuth, data.email, (capture) =>
      executeAuthenticatedAccountLifecycle({
        capture,
        config,
        data,
        datasourceConfig,
        run,
        runStep,
        session,
        state,
      })
    );
    log("Customer account e2e lifecycle passed");
  }).pipe(
    Effect.mapError((cause) =>
      toWorkspaceE2EError("run customer account e2e lifecycle", cause)
    )
  );

const executeAuthenticatedAccountLifecycle = ({
  capture,
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
}: {
  readonly capture: NeonAuthMagicLinkCapture;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: signInWithMagicLink({
        capture,
        config,
        email: data.email,
        expectedPath: "/en-US/account",
        expectedText: "My Workspace",
        run,
        session,
        validateInvalidEmail: true,
      }),
      id: "sign-up-with-magic-link",
      timeoutMs: config.timeouts.authTransition,
    });

    const initialSession = yield* runStep({
      execute: requireBrowserAuthSession(run, session, data.email),
      id: "assert-new-account-session",
      timeoutMs: config.timeouts.uiTransition,
    });
    capture.rememberUserId(initialSession.user.id);

    yield* runStep({
      execute: assertCurrentReservation({
        accountId: initialSession.user.id,
        config,
        run,
        session,
        state,
      }),
      id: "assert-current-account-reservation",
      timeoutMs: config.timeouts.datasource,
    });

    const profileName = `${data.name} Account`;
    yield* runStep({
      execute: updateAndAssertProfile({
        config,
        email: data.email,
        name: profileName,
        run,
        session,
      }),
      id: "update-account-profile",
      timeoutMs: config.timeouts.authTransition,
    });

    yield* runStep({
      execute: signOutAndAssertProtection(config, run, session),
      id: "sign-out-customer-account",
      timeoutMs: config.timeouts.authTransition,
    });

    yield* runStep({
      execute: signInWithMagicLink({
        capture,
        config,
        email: data.email,
        expectedPath: "/en-US/account",
        expectedText: "My Workspace",
        run,
        session,
        validateInvalidEmail: false,
      }),
      id: "sign-in-existing-customer-account",
      timeoutMs: config.timeouts.authTransition,
    });
    const returningSession = yield* runStep({
      execute: requireBrowserAuthSession(run, session, data.email).pipe(
        Effect.tap((authSession) =>
          tryWorkspaceE2ESync("assert returning customer account", () => {
            assert(
              authSession.user.id === initialSession.user.id,
              "magic-link login created a different customer account"
            );
            assert(
              authSession.user.name === profileName,
              "saved customer profile name did not persist"
            );
          })
        )
      ),
      id: "assert-returning-account-session",
      timeoutMs: config.timeouts.uiTransition,
    });

    yield* runStep({
      execute: cancelOwnedReservationAndAssertPast({
        config,
        datasourceConfig,
        run,
        session,
        state,
      }),
      id: "move-account-reservation-to-past",
      timeoutMs: config.timeouts.datasource,
    });

    yield* runStep({
      execute: deleteAccountAndAssert({
        accountId: returningSession.user.id,
        config,
        run,
        session,
      }),
      id: "delete-customer-account",
      timeoutMs: config.timeouts.authTransition,
    });

    yield* runStep({
      execute: assertFreshSignupAfterDeletion({
        capture,
        config,
        deletedAccountId: returningSession.user.id,
        email: data.email,
        previousName: profileName,
        run,
        session,
      }),
      id: "assert-fresh-sign-up-after-account-deletion",
      timeoutMs: config.timeouts.authTransition,
    });
  });

const assertProtectedAccountRedirect = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string
) =>
  Effect.gen(function* () {
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/en-US/account`,
      {
        timeoutMs: config.timeouts.browserNavigation,
      }
    );
    yield* waitForBrowserUrl({
      description: "protected account sign-in redirect",
      matches: (value) => isProtectedAccountSignInUrl(value, config),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
  });

export const isProtectedAccountSignInUrl = (
  value: string,
  config: WorkspaceE2EConfig
) => {
  try {
    const url = new URL(value);
    return (
      url.origin === config.baseUrl &&
      url.pathname === "/en-US/auth/sign-in" &&
      url.searchParams.get("redirectTo") === "/en-US/account"
    );
  } catch {
    return false;
  }
};

const signInWithMagicLink = ({
  capture,
  config,
  email,
  expectedPath,
  expectedText,
  run,
  session,
  validateInvalidEmail,
}: {
  readonly capture: NeonAuthMagicLinkCapture;
  readonly config: WorkspaceE2EConfig;
  readonly email: string;
  readonly expectedPath: string;
  readonly expectedText?: string;
  readonly run: Runner;
  readonly session: string;
  readonly validateInvalidEmail: boolean;
}) =>
  Effect.gen(function* () {
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/en-US/auth/sign-in?redirectTo=${encodeURIComponent(expectedPath)}`,
      { timeoutMs: config.timeouts.browserNavigation }
    );
    yield* waitForBrowserReactHydration(run, session, "form", {
      timeoutMs: config.timeouts.uiTransition,
    });
    if (validateInvalidEmail) {
      yield* fillBrowserField(run, session, 'input[name="email"]', "invalid", {
        timeoutMs: config.timeouts.browserAction,
      });
      yield* clickBrowserElement(run, session, 'button[type="submit"]', {
        timeoutMs: config.timeouts.browserAction,
      });
      yield* waitForBrowserTextContent(run, session, "Email is invalid", {
        timeoutMs: config.timeouts.uiTransition,
      });
    }
    yield* fillBrowserField(run, session, 'input[name="email"]', email, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* clickBrowserElement(run, session, 'button[type="submit"]', {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserTextContent(
      run,
      session,
      "Check your inbox for your sign-in link.",
      { timeoutMs: config.timeouts.uiTransition }
    );
    const verificationUrl = yield* capture.nextVerificationUrl(
      config,
      expectedPath
    );
    yield* openBrowserPage(config, run, session, verificationUrl, {
      sensitive: true,
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserUrl({
      description: "authenticated customer account",
      matches: (value) => {
        const url = safeUrl(value);
        return url?.origin === config.baseUrl && url.pathname === expectedPath;
      },
      run,
      session,
      timeoutMs: config.timeouts.authTransition,
    });
    if (expectedText) {
      yield* waitForBrowserTextContent(run, session, expectedText, {
        timeoutMs: config.timeouts.uiTransition,
      });
    }
  });

const assertCurrentReservation = ({
  accountId,
  config,
  run,
  session,
  state,
}: {
  readonly accountId: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}) =>
  Effect.gen(function* () {
    yield* waitForBrowserCondition(
      run,
      session,
      "current customer reservation",
      sectionTextCondition("current", ["Basic Day Pass", "Confirmed"]),
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "empty past customer reservations",
      sectionTextCondition("past", ["You have no past reservations yet."]),
      { timeoutMs: config.timeouts.uiTransition }
    );
    const dotyposCustomerId = state.checkoutRow?.dotypos_customer_id;
    assert(
      dotyposCustomerId,
      "account checkout Dotypos customer ID is missing"
    );
    yield* waitForCustomerAccountLink(accountId, dotyposCustomerId, true);
  });

const updateAndAssertProfile = ({
  config,
  email,
  name,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly email: string;
  readonly name: string;
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.gen(function* () {
    yield* fillBrowserField(run, session, "#account-name", name, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* clickBrowserElement(run, session, "#account-profile-save", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserTextContent(run, session, "Profile updated.", {
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/en-US/account`,
      {
        timeoutMs: config.timeouts.browserNavigation,
      }
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "persisted account profile name",
      `document.querySelector('#account-name')?.value === ${JSON.stringify(name)}`,
      { timeoutMs: config.timeouts.uiTransition }
    );
    const authSession = yield* requireBrowserAuthSession(run, session, email);
    yield* tryWorkspaceE2ESync("assert updated account profile session", () =>
      assert(authSession.user.name === name, "profile name did not persist")
    );
  });

const signOutAndAssertProtection = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string
) =>
  Effect.gen(function* () {
    yield* clickBrowserElement(run, session, 'a[href="/en-US/auth/sign-out"]', {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserUrl({
      description: "signed-out account redirect",
      matches: (value) => isProtectedAccountSignInUrl(value, config),
      run,
      session,
      timeoutMs: config.timeouts.authTransition,
    });
    const authSession = yield* readBrowserAuthSession(run, session);
    yield* tryWorkspaceE2ESync("assert signed-out customer session", () =>
      assert(!authSession, "customer session remained after sign-out")
    );
    yield* assertProtectedAccountRedirect(config, run, session);
  });

const cancelOwnedReservationAndAssertPast = ({
  config,
  datasourceConfig,
  run,
  session,
  state,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}) =>
  Effect.gen(function* () {
    const reservationId = state.checkoutRow?.dotypos_reservation_id;
    assert(reservationId, "account checkout Dotypos reservation ID is missing");
    yield* cancelDotyposReservation(datasourceConfig, reservationId);
    yield* waitForCancelledDotyposReservations(
      datasourceConfig,
      [reservationId],
      getWorkspaceE2EDateInterval({
        fromDate: state.data.date,
        toDate: state.data.date,
      })
    );
    state.cleanupComplete = true;
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/en-US/account`,
      {
        timeoutMs: config.timeouts.browserNavigation,
      }
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "cancelled past customer reservation",
      sectionTextCondition("past", ["Basic Day Pass", "Cancelled"]),
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "empty current customer reservations",
      sectionTextCondition("current", [
        "You have no current or upcoming reservations.",
      ]),
      { timeoutMs: config.timeouts.uiTransition }
    );
  });

const deleteAccountAndAssert = ({
  accountId,
  config,
  run,
  session,
}: {
  readonly accountId: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.gen(function* () {
    yield* clickBrowserElement(run, session, "#delete-account-trigger", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserTextContent(
      run,
      session,
      "Permanently delete this account?",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "disabled account deletion confirmation",
      "document.querySelector('#delete-account-confirm')?.disabled === true",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* clickBrowserElement(run, session, "#confirm-account-deletion", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserCondition(
      run,
      session,
      "enabled account deletion confirmation",
      "document.querySelector('#delete-account-confirm')?.disabled === false",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* clickBrowserElement(run, session, "#delete-account-confirm", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserUrl({
      description: "post-deletion home page",
      matches: (value) => {
        const url = safeUrl(value);
        return url?.origin === config.baseUrl && url.pathname === "/en-US";
      },
      run,
      session,
      timeoutMs: config.timeouts.authTransition,
    });
    const authSession = yield* readBrowserAuthSession(run, session);
    yield* tryWorkspaceE2ESync("assert deleted customer session", () =>
      assert(!authSession, "customer session remained after account deletion")
    );
    yield* waitForCustomerAccountLink(accountId, undefined, false);
    yield* assertProtectedAccountRedirect(config, run, session);
  });

const assertFreshSignupAfterDeletion = ({
  capture,
  config,
  deletedAccountId,
  email,
  previousName,
  run,
  session,
}: {
  readonly capture: NeonAuthMagicLinkCapture;
  readonly config: WorkspaceE2EConfig;
  readonly deletedAccountId: string;
  readonly email: string;
  readonly previousName: string;
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.gen(function* () {
    yield* signInWithMagicLink({
      capture,
      config,
      email,
      expectedPath: "/en-US",
      run,
      session,
      validateInvalidEmail: false,
    });
    const freshSession = yield* requireBrowserAuthSession(run, session, email);
    capture.rememberUserId(freshSession.user.id);
    yield* tryWorkspaceE2ESync("assert fresh account after deletion", () => {
      assert(
        freshSession.user.id !== deletedAccountId,
        "deleted Neon Auth identity was resumed instead of recreated"
      );
      assert(
        freshSession.user.name !== previousName,
        "deleted customer profile was retained on fresh sign-up"
      );
    });
    yield* waitForCustomerAccountLink(deletedAccountId, undefined, false);
  });

const readBrowserAuthSession = (
  run: Runner,
  session: string
): Effect.Effect<BrowserAuthSession | undefined, WorkspaceE2EError> =>
  evalBrowserScript(
    "read authoritative Neon Auth browser session",
    run,
    session,
    `
(async () => {
  const response = await fetch('/api/auth/get-session?disableCookieCache=true', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('authoritative session request failed');
  return await response.json();
})()
`,
    { logOutput: false, timeoutMs: 30_000 }
  ).pipe(
    Effect.flatMap((result) =>
      tryWorkspaceE2ESync("parse authoritative Neon Auth browser session", () =>
        parseBrowserAuthSession(result.stdout)
      )
    )
  );

export const parseBrowserAuthSession = (
  value: string
): BrowserAuthSession | undefined => {
  const parsed: unknown = JSON.parse(value.trim());
  if (parsed === null) return undefined;
  assert(
    parsed && typeof parsed === "object",
    "browser Auth session is invalid"
  );
  const user = (parsed as { readonly user?: unknown }).user;
  assert(user && typeof user === "object", "browser Auth user is missing");
  const candidate = user as Record<string, unknown>;
  assert(typeof candidate.id === "string", "browser Auth user ID is invalid");
  assert(typeof candidate.email === "string", "browser Auth email is invalid");
  assert(typeof candidate.name === "string", "browser Auth name is invalid");
  return {
    user: {
      email: candidate.email,
      id: candidate.id,
      name: candidate.name,
    },
  };
};

const requireBrowserAuthSession = (
  run: Runner,
  session: string,
  email: string
) =>
  readBrowserAuthSession(run, session).pipe(
    Effect.flatMap((authSession) =>
      tryWorkspaceE2ESync("assert authenticated customer session", () => {
        assert(authSession, "authenticated customer session is missing");
        assert(
          authSession.user.email === email,
          "customer session email mismatch"
        );
        return authSession;
      })
    )
  );

const waitForCustomerAccountLink = (
  accountId: string,
  customerId: string | undefined,
  shouldExist: boolean
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const decodedAccountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
      accountId
    );
    yield* pollUntil(
      runRetrySafeDatabaseOperation(
        "read customer account link",
        db
          .select({ customerId: customerAccountLinks.dotyposCustomerId })
          .from(customerAccountLinks)
          .where(eq(customerAccountLinks.customerAccountId, decodedAccountId))
          .limit(1)
      ).pipe(
        Effect.map(([row]) => {
          if (!shouldExist) return row ? undefined : true;
          return row?.customerId === customerId ? true : undefined;
        })
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: shouldExist
          ? "customer account reservation link"
          : "deleted customer account reservation link",
        timeoutMs: 60_000,
      }
    );
  });

const sectionTextCondition = (
  group: "current" | "past",
  expected: readonly string[]
) => `(() => {
  const text = document.querySelector('[data-account-reservation-group="${group}"]')?.innerText ?? '';
  return ${JSON.stringify(expected)}.every((value) => text.includes(value));
})()`;

const safeUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};
