import { Cause, Effect, Exit, Schema } from "effect";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  activateHydratedBrowserElement,
  evalBrowserScript,
  focusBrowserElement,
  openBrowserPage,
  pressBrowserKey,
  readActiveBrowserTabId,
  readBrowserUrl,
  requireEnabledSnapshotRef,
  requireSnapshotRef,
  runBrowserCommand,
  switchToBrowserTab,
  waitForBrowserReactHydration,
  waitForBrowserUrl,
} from "../browser";
import {
  browserDiagnosticsScript,
  payPageOrderIdScript,
} from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  failWorkspaceE2E,
  toWorkspaceE2EError,
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
import { isCheckoutStatusUrl } from "../urls";
import type { HostedPaymentPage } from "./nexi-hosted-payment";

const reservationStartRetryableErrorMessages = [
  "Checkout could not be started.",
  "Platbu se nepodařilo spustit.",
] as const;
const reservationSubmitAttemptCount = 2;
const reservationContinueSelector = "#reservation-continue";
const reservationSubmitSelector = "#reservation-submit";
// The form's one action button: Continue on the selection step, submit on
// the contact step.
const reservationActionSelector = `${reservationContinueSelector}, ${reservationSubmitSelector}`;
const reservationPreparationStateKey = "__deskohubWorkspaceE2EPreparation";
const decodeWorkspaceReservationId = Schema.decodeUnknownSync(
  workspaceReservationIdSchema
);

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
    return yield* readPayPageOrderIdFrom({
      onOrderId,
      payPageUrl,
      run,
      session,
    });
  });

/**
 * Waits for a reservation page that continues to the checkout pay page on
 * its own, without a submit from the runner, and reads the started order id.
 * The reservation a signed-out customer verified the email for does this
 * once the sign-in lands back on it.
 */
export const waitForReservationPayPage = ({
  onOrderId,
  run,
  session,
  timeouts,
}: {
  readonly onOrderId?: (orderId: WorkspaceReservationId) => void;
  readonly run: Runner;
  readonly session: string;
  readonly timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* waitForReservationStart(
      run,
      session,
      timeouts.checkoutStart
    );
    const payPageUrl = yield* requireReservationPayPage(result, {
      onOrderId,
      retryableErrorMessage: "Checkout reservation preparation failed",
    });
    return yield* readPayPageOrderIdFrom({
      onOrderId,
      payPageUrl,
      run,
      session,
    });
  });

const readPayPageOrderIdFrom = ({
  onOrderId,
  payPageUrl,
  run,
  session,
}: {
  readonly onOrderId?: (orderId: WorkspaceReservationId) => void;
  readonly payPageUrl: string;
  readonly run: Runner;
  readonly session: string;
}): Effect.Effect<WorkspaceReservationId, WorkspaceE2EError> =>
  Effect.gen(function* () {
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
        yield* prepareReservationSelection({
          prepareScript: submitReservationScript,
          run,
          session,
          timeoutMs,
          timeouts,
        });
        // The same script fills the contact step once Continue opens it.
        if (yield* isReservationSelectionStep(run, session, timeouts)) {
          yield* continueToReservationContactStep({ run, session, timeouts });
          yield* prepareReservationSelection({
            prepareScript: submitReservationScript,
            run,
            session,
            timeoutMs,
            timeouts,
          });
        }
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
    return yield* requireReservationPayPage(result, {
      onOrderId,
      retryableErrorMessage:
        "Checkout reservation preparation failed after one retry",
    });
  });

/**
 * The pay page URL a reservation start reached. A start that did not reach
 * it still reports any order id its URL carries, so cleanup releases the
 * hold, and fails with the browser diagnostics.
 */
const requireReservationPayPage = (
  result: ReservationStartResult,
  {
    onOrderId,
    retryableErrorMessage,
  }: {
    readonly onOrderId?: (orderId: WorkspaceReservationId) => void;
    readonly retryableErrorMessage: string;
  }
): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
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
              ? retryableErrorMessage
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

const isReservationSelectionStep = (
  run: Runner,
  session: string,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<boolean, WorkspaceE2EError> =>
  evalBrowserScript(
    "read reservation checkout step",
    run,
    session,
    `document.querySelector(${JSON.stringify(reservationContinueSelector)}) !== null`,
    { logOutput: false, timeoutMs: timeouts.browserAction }
  ).pipe(Effect.map((result) => result.stdout.trim() === "true"));

/**
 * Activates the selection step's Continue natively and waits for the
 * hydrated contact step. Continue changes only the URL's `step`, so the
 * page keeps its selection and nothing is submitted.
 */
export const continueToReservationContactStep = ({
  run,
  session,
  timeouts,
}: {
  readonly run: Runner;
  readonly session: string;
  readonly timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* activateHydratedBrowserElement(
      run,
      session,
      reservationContinueSelector,
      { timeoutMs: timeouts.browserAction }
    );
    yield* waitForBrowserReactHydration(
      run,
      session,
      reservationSubmitSelector,
      { timeoutMs: timeouts.browserAction }
    );
  });

/**
 * Runs a side-effect-free reservation preparation script on the hydrated
 * form: a short evaluation starts it and keeps its status in the page, and
 * the runner polls that status within `timeoutMs`. Nothing is submitted.
 */
export const prepareReservationSelection = ({
  prepareScript,
  run,
  session,
  timeoutMs,
  timeouts,
}: {
  readonly prepareScript: string;
  readonly run: Runner;
  readonly session: string;
  readonly timeoutMs: number;
  readonly timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* waitForBrowserReactHydration(
      run,
      session,
      reservationActionSelector,
      { timeoutMs: timeouts.browserAction }
    );
    yield* startReservationPreparation(
      run,
      session,
      prepareScript,
      timeouts.browserAction
    );
    yield* waitForReservationPreparation(run, session, timeoutMs);
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
    const checkoutPageUrl = yield* readBrowserUrl(run, session);
    if (!checkoutPageUrl) {
      return yield* failWorkspaceE2E("checkout pay page URL is unavailable", {
        operation: "read checkout pay page URL",
      });
    }
    // A sandbox restart reopens this URL; keep its sealed pay state out of logs.
    addRedaction(
      parseUrl(checkoutPageUrl)?.searchParams.get("payState") ?? undefined
    );
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
    if (hostedPaymentTabId !== checkoutTabId) {
      yield* switchToBrowserTab(run, session, checkoutTabId);
      yield* waitForBrowserUrl({
        description: "checkout status page in original tab",
        matches: isCheckoutStatusUrl,
        run,
        session,
        timeoutMs: timeouts.providerTransition,
      });
      yield* switchToBrowserTab(run, session, hostedPaymentTabId);
    }
    return {
      checkoutPageUrl,
      checkoutTabId,
      hostedPaymentTabId,
      url: hostedPaymentUrl,
    } satisfies HostedPaymentPage;
  });

export const submitCheckoutPayment = (run: Runner, session: string) =>
  Effect.gen(function* () {
    const checkoutTabId = yield* readActiveBrowserTabId(run, session);
    yield* clickCheckoutPayConsent(run, session);
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

const getSearchOrderId = (value: string | undefined) => {
  if (!value) return undefined;
  const url = parseUrl(value);
  return url?.searchParams.get("orderId") ?? undefined;
};
