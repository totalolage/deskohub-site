import { Cause, Effect, Exit, Schema } from "effect";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  activateHydratedBrowserElement,
  findEnabledSnapshotRef,
  findFirstEnabledTextFieldRef,
  findFirstTextFieldRef,
  findSnapshotRef,
  focusBrowserElement,
  getSnapshotRef,
  openBrowserPage,
  pressBrowserKey,
  readActiveBrowserTabId,
  readBrowserTabs,
  readBrowserUrl,
  readInteractiveSnapshot,
  requireEnabledSnapshotRef,
  requireSnapshotRef,
  summarizeHostedPaymentSnapshot,
  switchToBrowserTab,
  switchToMainFrame,
  waitForBrowserReactHydration,
  waitForBrowserUrl,
} from "../browser";
import {
  browserDiagnosticsScript,
  payPageOrderIdScript,
} from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { addRedaction, assert, log, parseUrl } from "../runtime";
import {
  type WorkspaceE2ETimeouts,
  workspaceE2EPollIntervalMs,
} from "../timeouts";
import type { CheckoutData } from "../types";
import { isExpectedCheckoutStatusUrl } from "../urls";

const NEXI_TEST_CARD_NUMBER = "4509034543615006";
const NEXI_TEST_CVV = "298";
const NEXI_TEST_EXPIRY = "1028";
const reservationStartRetryableErrorMessages = [
  "Checkout could not be started.",
  "Platbu se nepodařilo spustit.",
] as const;
const reservationSubmitAttemptCount = 2;
const reservationSubmitSelector = "#reservation-submit";
const reservationPreparationStateKey = "__deskohubWorkspaceE2EPreparation";
const hostedPaymentFieldFillAttemptCount = 3;
const decodeWorkspaceReservationId = Schema.decodeUnknownSync(
  workspaceReservationIdSchema
);

const runBrowserCommand = (
  operation: string,
  run: Runner,
  session: string,
  args: string[],
  options?: Parameters<Runner>[2]
) =>
  tryWorkspaceE2EPromise(operation, (signal) =>
    run("agent-browser", ["--session", session, ...args], {
      ...options,
      signal,
    })
  );

export const completeCheckout = ({
  config,
  data,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  onOrderId?: (orderId: WorkspaceReservationId) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, data.checkoutUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* submitReservationForPayPage({
      onOrderId,
      run,
      session,
      submitReservationScript,
      timeouts: config.timeouts,
    });
    const hostedPaymentPage = yield* submitPaymentAndWaitForHostedPage({
      run,
      session,
      timeouts: config.timeouts,
    });
    yield* completeNexiHostedPayment({
      data,
      hostedPaymentPage,
      run,
      session,
      timeouts: config.timeouts,
    });
    yield* waitForBrowserUrl({
      description: "checkout status page",
      matches: (url) => isExpectedCheckoutStatusUrl(url, config.expectedHost),
      run,
      session,
      timeoutMs: config.timeouts.providerTransition,
    });

    const url = yield* runBrowserCommand(
      "read checkout status URL",
      run,
      session,
      ["get", "url"]
    );
    const orderId = yield* tryWorkspaceE2ESync(
      "extract checkout status order id",
      () => extractOrderId(url.stdout)
    );
    log(`Reached checkout status for order ${orderId}`);
    return orderId;
  });

export const startCheckoutPaymentAttempt = ({
  config,
  data,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  onOrderId?: (orderId: WorkspaceReservationId) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const orderId = yield* prepareCheckoutPaymentAttempt({
      config,
      data,
      onOrderId,
      run,
      session,
      submitReservationScript,
    });
    yield* submitPaymentAndWaitForHostedPage({
      run,
      session,
      timeouts: config.timeouts,
    });
    log(`Started hosted payment attempt for order ${orderId}`);
    return orderId;
  });

export const prepareCheckoutPaymentAttempt = ({
  config,
  data,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  onOrderId?: (orderId: WorkspaceReservationId) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, data.checkoutUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    return yield* submitReservationForPayPage({
      onOrderId,
      run,
      session,
      submitReservationScript,
      timeouts: config.timeouts,
    });
  });

export const submitReservationForPayPage = ({
  onOrderId,
  run,
  session,
  submitReservationScript,
  timeouts,
}: {
  onOrderId?: (orderId: WorkspaceReservationId) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const payPageUrl = yield* submitReservationAndWaitForPayPage({
      onOrderId,
      run,
      session,
      submitReservationScript,
      timeouts,
    });
    const searchOrderId = yield* tryWorkspaceE2ESync(
      "decode checkout pay page order id",
      () => {
        const value = getSearchOrderId(payPageUrl);
        return value ? decodeWorkspaceReservationId(value) : undefined;
      }
    );
    const orderId = searchOrderId ?? (yield* readPayPageOrderId(run, session));
    yield* Effect.sync(() => onOrderId?.(orderId));
    return orderId;
  });

const readPayPageOrderId = (
  run: Runner,
  session: string
): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* runBrowserCommand(
      "read pay page order id",
      run,
      session,
      ["eval", "--stdin"],
      {
        input: payPageOrderIdScript,
        logOutput: false,
        timeoutMs: 30_000,
      }
    );
    return yield* tryWorkspaceE2ESync("assert pay page order id", () => {
      const orderId = result.stdout.trim();
      assert(orderId, "checkout pay page order id missing");
      return decodeWorkspaceReservationId(orderId);
    });
  });

const submitReservationAndWaitForPayPage = ({
  onOrderId,
  run,
  session,
  submitReservationScript,
  timeouts,
}: {
  onOrderId?: (orderId: WorkspaceReservationId) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const timeoutMs = timeouts.checkoutStart;
    const submitAttempt = (
      attempt: number
    ): Effect.Effect<ReservationStartResult, WorkspaceE2EError> =>
      Effect.gen(function* () {
        yield* startReservationPreparation(
          run,
          session,
          submitReservationScript,
          timeouts.browserAction
        );
        yield* waitForReservationPreparation(run, session, timeoutMs);
        yield* activateHydratedBrowserElement(
          run,
          session,
          reservationSubmitSelector,
          { timeoutMs: timeouts.browserAction }
        );

        const result = yield* waitForReservationStart(run, session, timeoutMs);
        if (
          result.status !== "retryable_error" ||
          attempt >= reservationSubmitAttemptCount
        ) {
          return result;
        }

        log(
          "Checkout reservation preparation returned a transient error; retrying once with the same checkout attempt"
        );
        return yield* submitAttempt(attempt + 1);
      });

    const result = yield* submitAttempt(1);
    if (result.status === "ready") return result.url;

    const orderId = yield* tryWorkspaceE2ESync(
      "decode failed checkout reservation order id",
      () => {
        const value = getSearchOrderId(result.url);
        return value ? decodeWorkspaceReservationId(value) : undefined;
      }
    );
    if (orderId) yield* Effect.sync(() => onOrderId?.(orderId));

    return yield* tryWorkspaceE2ESync(
      "assert checkout pay page reached",
      () => {
        throw new Error(
          [
            result.status === "retryable_error"
              ? "Checkout reservation preparation failed after one retry"
              : "Timed out waiting for checkout pay page",
            result.diagnostics
              ? `Browser diagnostics:\n${result.diagnostics}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    );
  });

type ReservationPreparationState =
  | { readonly status: "pending" | "ready" }
  | { readonly error: string; readonly status: "failed" };

const startReservationPreparation = (
  run: Runner,
  session: string,
  script: string,
  timeoutMs: number
): Effect.Effect<void, WorkspaceE2EError> => {
  const stateKey = JSON.stringify(reservationPreparationStateKey);
  const kickoffScript = `
(() => {
  const state = { status: 'pending' };
  globalThis[${stateKey}] = state;
  Promise.resolve()
    .then(() => (${script.trim()}))
    .then(
      () => { state.status = 'ready'; },
      (error) => {
        state.status = 'failed';
        state.error = String(error instanceof Error ? error.message : error).slice(0, 500);
      }
    );
  return true;
})()
`;

  return runBrowserCommand(
    "start checkout reservation preparation",
    run,
    session,
    ["eval", "--stdin"],
    {
      input: kickoffScript,
      logOutput: false,
      timeoutMs,
    }
  ).pipe(Effect.asVoid);
};

const waitForReservationPreparation = (
  run: Runner,
  session: string,
  timeoutMs: number
): Effect.Effect<void, WorkspaceE2EError> =>
  pollUntil(
    readReservationPreparationState(run, session).pipe(
      Effect.flatMap((state) =>
        state.status === "failed"
          ? Effect.fail(
              toWorkspaceE2EError(
                "prepare checkout reservation",
                new Error(state.error)
              )
            )
          : Effect.succeed(state.status === "ready" ? true : undefined)
      )
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: "checkout reservation preparation",
      timeoutMs,
    }
  ).pipe(Effect.asVoid);

const readReservationPreparationState = (
  run: Runner,
  session: string
): Effect.Effect<ReservationPreparationState, WorkspaceE2EError> => {
  const stateKey = JSON.stringify(reservationPreparationStateKey);
  const stateScript = `
(() => globalThis[${stateKey}] ?? { status: 'pending' })()
`;

  return Effect.gen(function* () {
    const result = yield* runBrowserCommand(
      "read checkout reservation preparation state",
      run,
      session,
      ["eval", "--stdin"],
      {
        input: stateScript,
        logOutput: false,
        timeoutMs: 30_000,
      }
    );
    return yield* tryWorkspaceE2ESync(
      "parse checkout reservation preparation state",
      () => {
        const state = JSON.parse(
          result.stdout.trim()
        ) as Partial<ReservationPreparationState>;
        assert(
          state.status === "pending" ||
            state.status === "ready" ||
            (state.status === "failed" && typeof state.error === "string"),
          "checkout reservation preparation state invalid"
        );
        return state as ReservationPreparationState;
      }
    );
  });
};

type ReservationStartResult =
  | {
      readonly status: "ready";
      readonly url: string;
    }
  | {
      readonly diagnostics: string | undefined;
      readonly status: "not_ready" | "retryable_error";
      readonly url: string | undefined;
    };

const waitForReservationStart = (
  run: Runner,
  session: string,
  timeoutMs: number
): Effect.Effect<ReservationStartResult, WorkspaceE2EError> =>
  Effect.gen(function* () {
    let latest: ReservationStartDiagnostics | undefined;

    const reservationStartExit = yield* Effect.exit(
      pollUntil(
        Effect.gen(function* () {
          const url = yield* readBrowserUrl(run, session);
          if (url?.includes("/checkout/pay"))
            return { status: "ready" as const, url };

          latest = yield* readReservationStartDiagnostics(run, session);
          if (isRetryableReservationStartError(latest)) {
            return {
              diagnostics: formatReservationStartDiagnostics(latest),
              status: "retryable_error" as const,
              url: latest?.url,
            };
          }
          return undefined;
        }),
        {
          intervalMs: workspaceE2EPollIntervalMs.browser,
          label: "checkout pay page",
          timeoutMs,
        }
      )
    );

    if (Exit.isSuccess(reservationStartExit)) return reservationStartExit.value;

    latest = addReservationStartTimeout(
      latest,
      Cause.squash(reservationStartExit.cause)
    );
    latest ??= yield* readReservationStartDiagnostics(run, session);
    return {
      diagnostics: formatReservationStartDiagnostics(latest),
      status: "not_ready",
      url: latest?.url,
    };
  });

type ReservationStartDiagnostics = {
  readonly body?: string;
  readonly submitDisabled?: boolean | null;
  readonly submitText?: string | null;
  readonly timeoutError?: string;
  readonly title?: string;
  readonly url?: string;
};

const isRetryableReservationStartError = (
  diagnostics: ReservationStartDiagnostics | undefined
) =>
  reservationStartRetryableErrorMessages.some((message) =>
    diagnostics?.body?.includes(message)
  );

const readReservationStartDiagnostics = (
  run: Runner,
  session: string
): Effect.Effect<ReservationStartDiagnostics | undefined, WorkspaceE2EError> =>
  runBrowserCommand(
    "read reservation start diagnostics",
    run,
    session,
    ["eval", "--stdin"],
    {
      allowFailure: true,
      input: browserDiagnosticsScript,
      logOutput: false,
      timeoutMs: 30_000,
    }
  ).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) return undefined;

      try {
        const parsed = JSON.parse(result.stdout.trim()) as unknown;
        return parsed && typeof parsed === "object"
          ? (parsed as ReservationStartDiagnostics)
          : undefined;
      } catch {
        return {
          body: result.stdout,
        };
      }
    })
  );

const addReservationStartTimeout = (
  diagnostics: ReservationStartDiagnostics | undefined,
  error: unknown
): ReservationStartDiagnostics => ({
  ...diagnostics,
  timeoutError: error instanceof Error ? error.message : String(error),
});

const formatReservationStartDiagnostics = (
  diagnostics: ReservationStartDiagnostics | undefined
) => {
  if (!diagnostics) return undefined;

  return JSON.stringify(
    {
      body: diagnostics.body?.slice(0, 1200),
      submitDisabled: diagnostics.submitDisabled,
      submitText: diagnostics.submitText,
      timeoutError: diagnostics.timeoutError,
      title: diagnostics.title,
      url: diagnostics.url,
    },
    null,
    2
  );
};

const isCheckoutStatusUrl = (url: string | undefined) =>
  parseUrl(url ?? "")?.pathname.includes("/reservation/status/") ?? false;

export type HostedPaymentPage = {
  readonly checkoutTabId: string;
  readonly hostedPaymentTabId: string;
  readonly url: string;
};

export const submitPaymentAndWaitForHostedPage = ({
  run,
  session,
  timeouts,
}: {
  run: Runner;
  session: string;
  timeouts: WorkspaceE2ETimeouts;
}) =>
  Effect.gen(function* () {
    const checkoutTabId = yield* submitCheckoutPayment(run, session);

    const hostedPaymentUrl = yield* waitForBrowserUrl({
      description: "Nexi hosted payment page",
      matches: (url) =>
        url.includes("nexigroup.com") || url.includes("/hpp/nexi/"),
      run,
      session,
      timeoutMs: timeouts.providerTransition,
    });
    const hostedPaymentTabId = yield* readActiveBrowserTabId(run, session);
    yield* switchToBrowserTab(run, session, checkoutTabId);
    yield* waitForBrowserUrl({
      description: "checkout status page in original tab",
      matches: isCheckoutStatusUrl,
      run,
      session,
      timeoutMs: timeouts.providerTransition,
    });
    yield* switchToBrowserTab(run, session, hostedPaymentTabId);
    return {
      checkoutTabId,
      hostedPaymentTabId,
      url: hostedPaymentUrl,
    } satisfies HostedPaymentPage;
  });

export const submitCheckoutPayment = (run: Runner, session: string) =>
  Effect.gen(function* () {
    const checkoutTabId = yield* readActiveBrowserTabId(run, session);
    yield* clickCheckoutPayConsent(run, session);
    yield* clickCheckoutEarlyPerformanceConsentIfPresent(run, session);
    yield* activateCheckoutPayButton(run, session);
    return checkoutTabId;
  });

const clickCheckoutPayConsent = (run: Runner, session: string) =>
  Effect.gen(function* () {
    yield* waitForBrowserReactHydration(
      run,
      session,
      "#checkout-pay-legal-consent"
    );
    const ref = yield* requireSnapshotRef({
      description: "payment legal consent",
      labels: ["I agree to the", "Souhlasím"],
      role: "checkbox",
      run,
      session,
    });
    yield* focusBrowserElement(run, session, ref, { timeoutMs: 30_000 });
    yield* pressBrowserKey(run, session, "Space", { timeoutMs: 30_000 });
  });

const clickCheckoutEarlyPerformanceConsentIfPresent = (
  run: Runner,
  session: string
) =>
  Effect.gen(function* () {
    const labels = ["I expressly request", "Výslovně žádám"];
    const snapshot = yield* readInteractiveSnapshot(run, session);
    const ref = findSnapshotRef(snapshot, labels, "checkbox");
    if (!ref) return;

    yield* waitForBrowserReactHydration(
      run,
      session,
      "#checkout-pay-early-performance-consent"
    );
    yield* focusBrowserElement(run, session, ref, { timeoutMs: 30_000 });
    yield* pressBrowserKey(run, session, "Space", { timeoutMs: 30_000 });
  });

const activateCheckoutPayButton = (run: Runner, session: string) =>
  Effect.gen(function* () {
    const ref = yield* requireEnabledSnapshotRef({
      description: "enabled payment submit button",
      labels: ["ORDER AND PAY", "Order and pay"],
      run,
      session,
    });
    yield* focusBrowserElement(run, session, ref, { timeoutMs: 30_000 });
    yield* pressBrowserKey(run, session, "Enter", { timeoutMs: 30_000 });
  });

export const completeNexiHostedPayment = ({
  data,
  hostedPaymentPage,
  run,
  session,
  timeouts,
}: {
  data: CheckoutData;
  hostedPaymentPage?: HostedPaymentPage;
  run: Runner;
  session: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    addRedaction(NEXI_TEST_CARD_NUMBER);
    addRedaction(NEXI_TEST_CVV, true);
    addRedaction(NEXI_TEST_EXPIRY, true);

    yield* fillHostedPaymentField(
      run,
      session,
      ["Card number", "Numero carta", "Numero della carta"],
      ["CARD_NUMBER"],
      NEXI_TEST_CARD_NUMBER,
      timeouts
    );
    yield* fillHostedPaymentField(
      run,
      session,
      ["Expiration date", "Scadenza", "Data scadenza"],
      ["EXPIRATION_DATE"],
      NEXI_TEST_EXPIRY,
      timeouts
    );
    yield* fillHostedPaymentField(
      run,
      session,
      ["CVV", "CVC", "Codice sicurezza"],
      ["SECURITY_CODE"],
      NEXI_TEST_CVV,
      timeouts
    );
    yield* tryFillHostedPaymentField(
      run,
      session,
      ["First Name", "Nome", "Titolare"],
      ["CARDHOLDER_NAME"],
      data.name
    );
    yield* tryFillHostedPaymentField(
      run,
      session,
      ["Email", "E-mail"],
      ["CARDHOLDER_EMAIL"],
      data.email
    );

    yield* clickHostedPaymentTarget(
      run,
      session,
      "continue",
      [{ value: "CONTINUE" }, { value: "Continue" }, { value: "CONTINUA" }],
      timeouts,
      { optional: true, timeoutMs: 15_000 }
    );
    yield* clickHostedPaymentTarget(
      run,
      session,
      "pay",
      [{ value: "PAY" }, { value: "Pay" }, { value: "PAGA" }],
      timeouts
    );
    yield* clickHostedPaymentTarget(
      run,
      session,
      "3DS success",
      [
        { value: "AUTENTICAZIONE RIUSCITA" },
        { value: "Authentication successful" },
      ],
      timeouts
    );
    if (isCheckoutStatusUrl(yield* readBrowserUrl(run, session))) {
      log(
        "Nexi back-to-shop action skipped; checkout status page already loaded"
      );
    } else {
      const backToShopExit = yield* Effect.exit(
        clickHostedPaymentTarget(
          run,
          session,
          "back to shop",
          [
            { value: "BACK TO THE SHOP" },
            { value: "Back to the shop" },
            { value: "TORNA AL NEGOZIO" },
          ],
          timeouts
        )
      );

      if (
        Exit.isFailure(backToShopExit) &&
        !isCheckoutStatusUrl(yield* readBrowserUrl(run, session))
      ) {
        return yield* toWorkspaceE2EError(
          "click Nexi back to shop",
          Cause.squash(backToShopExit.cause)
        );
      }
    }

    if (hostedPaymentPage) {
      yield* waitForReturnedPaymentTabToClose({
        hostedPaymentPage,
        run,
        session,
        timeoutMs: timeouts.providerTransition,
      });
    }
  });

const waitForReturnedPaymentTabToClose = ({
  hostedPaymentPage,
  run,
  session,
  timeoutMs,
}: {
  readonly hostedPaymentPage: HostedPaymentPage;
  readonly run: Runner;
  readonly session: string;
  readonly timeoutMs: number;
}) =>
  Effect.gen(function* () {
    yield* pollUntil(
      readBrowserTabs(run, session).pipe(
        Effect.map((tabs) =>
          tabs.length === 1 &&
          tabs[0]?.tabId === hostedPaymentPage.checkoutTabId
            ? tabs[0]
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.browser,
        label: "returned payment tab to close",
        timeoutMs,
      }
    );
    yield* switchToBrowserTab(run, session, hostedPaymentPage.checkoutTabId);
  });

const fillHostedPaymentField = (
  run: Runner,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  value: string,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    const target = yield* requireHostedPaymentRef(
      run,
      session,
      labels,
      frameLabels,
      timeouts.providerTransition
    );
    yield* Effect.gen(function* () {
      for (
        let attempt = 1;
        attempt <= hostedPaymentFieldFillAttemptCount;
        attempt += 1
      ) {
        const fillResult = yield* runBrowserCommand(
          "fill hosted payment field",
          run,
          session,
          ["fill", target.ref, value],
          {
            allowFailure: true,
            logCommand: false,
            logOutput: false,
            timeoutMs: 60_000,
          }
        );
        if (fillResult.exitCode !== 0) continue;

        const valueResult = yield* runBrowserCommand(
          "verify hosted payment field",
          run,
          session,
          ["get", "value", target.ref],
          {
            allowFailure: true,
            logCommand: false,
            logOutput: false,
            timeoutMs: 30_000,
          }
        );
        if (valueResult.exitCode === 0 && valueResult.stdout.trim()) return;

        const typeResult = yield* runBrowserCommand(
          "type hosted payment field",
          run,
          session,
          ["type", target.ref, value],
          {
            allowFailure: true,
            logCommand: false,
            logOutput: false,
            timeoutMs: 60_000,
          }
        );
        if (typeResult.exitCode !== 0) continue;

        const typedValueResult = yield* runBrowserCommand(
          "verify typed hosted payment field",
          run,
          session,
          ["get", "value", target.ref],
          {
            allowFailure: true,
            logCommand: false,
            logOutput: false,
            timeoutMs: 30_000,
          }
        );
        if (typedValueResult.exitCode === 0 && typedValueResult.stdout.trim())
          return;
      }

      return yield* toWorkspaceE2EError(
        `fill Nexi field ${labels.join(" / ")}`,
        new Error(
          `field value remained empty after ${hostedPaymentFieldFillAttemptCount} attempts`
        )
      );
    }).pipe(
      Effect.ensuring(
        target.framed
          ? switchToMainFrame(run, session).pipe(Effect.ignore)
          : Effect.void
      )
    );
  });

const requireHostedPaymentRef = (
  run: Runner,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  timeoutMs: number
): Effect.Effect<HostedPaymentRef, WorkspaceE2EError> =>
  pollUntil(
    findHostedPaymentRef(run, session, labels, frameLabels, {
      enabledOnly: true,
    }),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: `Nexi target ${labels.join(" / ")}`,
      timeoutMs,
    }
  ).pipe(
    Effect.catch((error) =>
      readInteractiveSnapshot(run, session).pipe(
        Effect.flatMap((snapshot) =>
          Effect.fail(
            toWorkspaceE2EError(
              `find Nexi target ${labels.join(" / ")}`,
              new Error(
                `${error.message}\n${summarizeHostedPaymentSnapshot(snapshot)}`
              )
            )
          )
        )
      )
    )
  );

const tryFillHostedPaymentField = (
  run: Runner,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  value: string
) =>
  Effect.gen(function* () {
    const target = yield* findHostedPaymentRef(
      run,
      session,
      labels,
      frameLabels,
      {
        enabledOnly: true,
      }
    );
    if (!target) return;

    yield* runBrowserCommand(
      "try fill hosted payment field",
      run,
      session,
      ["fill", target.ref, value],
      {
        allowFailure: true,
        logCommand: false,
        timeoutMs: 30_000,
      }
    ).pipe(
      Effect.ensuring(
        target.framed
          ? switchToMainFrame(run, session).pipe(Effect.ignore)
          : Effect.void
      )
    );
  });

type HostedPaymentRef = {
  readonly framed: boolean;
  readonly ref: string;
};

const findHostedPaymentRef = (
  run: Runner,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  options: { readonly enabledOnly?: boolean } = {}
): Effect.Effect<HostedPaymentRef | undefined, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const snapshot = yield* readInteractiveSnapshot(run, session);
    const directRef = options.enabledOnly
      ? findEnabledSnapshotRef(snapshot, labels)
      : findSnapshotRef(snapshot, labels);
    if (directRef) return { framed: false, ref: directRef };

    for (const frame of findHostedPaymentFrames(snapshot, frameLabels)) {
      const switched = yield* runBrowserCommand(
        "switch hosted payment frame",
        run,
        session,
        ["frame", frame.ref],
        { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
      );
      if (switched.exitCode !== 0) continue;

      let shouldRestoreMainFrame = true;
      const frameResult = yield* Effect.gen(function* () {
        const frameSnapshot = yield* readInteractiveSnapshot(run, session);
        const frameFieldRef = options.enabledOnly
          ? (findEnabledSnapshotRef(frameSnapshot, labels) ??
            (frame.exact
              ? findFirstEnabledTextFieldRef(frameSnapshot)
              : undefined))
          : (findSnapshotRef(frameSnapshot, labels) ??
            (frame.exact ? findFirstTextFieldRef(frameSnapshot) : undefined));
        if (!frameFieldRef) return undefined;

        shouldRestoreMainFrame = false;
        return { framed: true, ref: frameFieldRef };
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() =>
            shouldRestoreMainFrame
              ? switchToMainFrame(run, session).pipe(Effect.ignore)
              : Effect.void
          )
        )
      );

      if (frameResult) return frameResult;
    }
  });

type HostedPaymentFrame = {
  readonly exact: boolean;
  readonly ref: string;
};

const findHostedPaymentFrames = (
  snapshot: string,
  frameLabels: readonly string[]
) => {
  const frames = new Map<string, HostedPaymentFrame>();
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref || !/\b(?:frame|iframe)\b/i.test(line)) continue;

    const exact = frameLabels.some((label) =>
      line.toLowerCase().includes(label.toLowerCase())
    );
    frames.set(ref, { exact, ref });
  }

  return [...frames.values()].sort((left, right) => {
    if (left.exact === right.exact) return 0;
    return left.exact ? -1 : 1;
  });
};

type HostedPaymentClickTarget = {
  readonly value: string;
};

const clickHostedPaymentTarget = (
  run: Runner,
  session: string,
  label: string,
  targets: readonly HostedPaymentClickTarget[],
  timeouts: WorkspaceE2ETimeouts,
  options: { readonly optional?: boolean; readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const labels = targets.map((target) => target.value);
    const timeoutMs = options.timeoutMs ?? timeouts.providerTransition;
    const target = yield* options.optional
      ? waitForHostedPaymentClickTarget(run, session, labels, timeoutMs).pipe(
          Effect.orElseSucceed(() => undefined)
        )
      : waitForHostedPaymentClickTarget(run, session, labels, timeoutMs);

    if (!target) return;

    yield* Effect.gen(function* () {
      yield* focusBrowserElement(run, session, target.ref, {
        timeoutMs: 30_000,
      });
      yield* pressBrowserKey(run, session, "Enter", { timeoutMs: 30_000 });
    }).pipe(
      Effect.ensuring(
        target.framed
          ? switchToMainFrame(run, session).pipe(Effect.ignore)
          : Effect.void
      )
    );

    yield* waitForHostedPaymentTargetToChange(
      run,
      session,
      label,
      labels,
      timeoutMs
    );
  }).pipe(
    Effect.catch((error) => {
      if (options.optional) return Effect.void;

      return readInteractiveSnapshot(run, session, true).pipe(
        Effect.flatMap((snapshot) =>
          Effect.fail(
            toWorkspaceE2EError(
              `click Nexi ${label}`,
              new Error(
                `${error.message}\n${summarizeHostedPaymentSnapshot(snapshot)}`
              )
            )
          )
        )
      );
    })
  );

const waitForHostedPaymentClickTarget = (
  run: Runner,
  session: string,
  labels: readonly string[],
  timeoutMs: number
) =>
  pollUntil(findHostedPaymentRef(run, session, labels, []), {
    intervalMs: workspaceE2EPollIntervalMs.browser,
    label: `Nexi target ${labels.join(" / ")}`,
    timeoutMs,
  });

const waitForHostedPaymentTargetToChange = (
  run: Runner,
  session: string,
  label: string,
  labels: readonly string[],
  timeoutMs: number
) =>
  pollUntil(
    Effect.gen(function* () {
      const stillPresent = yield* findHostedPaymentRef(
        run,
        session,
        labels,
        []
      );
      if (stillPresent?.framed) yield* switchToMainFrame(run, session);
      return stillPresent ? undefined : true;
    }),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: `Nexi ${label} completion`,
      timeoutMs,
    }
  );

const extractOrderId = (stdout: string) => {
  const match = stdout.match(/\/checkout\/status\/([^\s/?#]+)/);
  assert(match?.[1], "could not extract checkout status order id");
  return decodeWorkspaceReservationId(match[1]);
};

const getSearchOrderId = (value: string | undefined) => {
  if (!value) return undefined;
  const url = parseUrl(value);
  return url?.searchParams.get("orderId") ?? undefined;
};
