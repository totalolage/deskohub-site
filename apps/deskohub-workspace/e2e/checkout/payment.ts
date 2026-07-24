import { Cause, Effect, Exit } from "effect";
import {
  findFirstTextFieldRef,
  findSnapshotRef,
  focusBrowserElement,
  getSnapshotRef,
  openBrowserPage,
  pressBrowserKey,
  readBrowserUrl,
  readInteractiveSnapshot,
  requireEnabledSnapshotRef,
  requireSnapshotRef,
  summarizeHostedPaymentSnapshot,
  switchToMainFrame,
  validateProtectedBrowserNavigation,
  waitForBrowserReactHydration,
  waitForBrowserUrl,
} from "../browser";
import {
  browserDiagnosticsScript,
  payPageOrderIdScript,
  payPageReadyScript,
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
  getWorkspaceE2ETimeoutMs,
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
const hostedPaymentFieldFillAttemptCount = 3;

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
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, data.checkoutUrl, {
      timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
    });
    yield* submitReservationForPayPage({
      config,
      locale: data.locale,
      onOrderId,
      run,
      session,
      submitReservationScript,
    });
    yield* submitPaymentAndWaitForHostedPage({ run, session });
    yield* completeNexiHostedPayment({ data, run, session });
    yield* waitForBrowserUrl({
      description: "checkout status page",
      matches: (url) => isExpectedCheckoutStatusUrl(url, config.expectedHost),
      run,
      session,
      timeoutMs: getWorkspaceE2ETimeoutMs("providerTransition"),
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
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, data.checkoutUrl, {
      timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
    });
    const orderId = yield* submitReservationForPayPage({
      config,
      locale: data.locale,
      onOrderId,
      run,
      session,
      submitReservationScript,
    });
    yield* submitPaymentAndWaitForHostedPage({ run, session });
    log(`Started hosted payment attempt for order ${orderId}`);
    return orderId;
  });

export const submitReservationForPayPage = ({
  config,
  locale,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  locale: CheckoutData["locale"];
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const payPageUrl = yield* submitReservationAndWaitForPayPage({
      config,
      locale,
      onOrderId,
      run,
      session,
      submitReservationScript,
    });
    const orderId =
      getSearchOrderId(payPageUrl) ?? (yield* readPayPageOrderId(run, session));
    yield* Effect.sync(() => onOrderId?.(orderId));
    return orderId;
  });

const readPayPageOrderId = (
  run: Runner,
  session: string
): Effect.Effect<string, WorkspaceE2EError> =>
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
      return orderId;
    });
  });

const submitReservationAndWaitForPayPage = ({
  config,
  locale,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  locale: CheckoutData["locale"];
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const timeoutMs = getWorkspaceE2ETimeoutMs("checkoutStart");
    const submitAttempt = (
      attempt: number
    ): Effect.Effect<ReservationStartResult, WorkspaceE2EError> =>
      Effect.gen(function* () {
        yield* runBrowserCommand(
          "submit checkout reservation",
          run,
          session,
          ["eval", "--stdin"],
          {
            input: submitReservationScript,
            logOutput: false,
          }
        );

        const result = yield* waitForReservationStart(
          config,
          locale,
          run,
          session,
          timeoutMs
        );
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

    const orderId = getSearchOrderId(result.url);
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
  config: WorkspaceE2EConfig,
  locale: CheckoutData["locale"],
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
          const parsedUrl = parseUrl(url ?? "");
          if (parsedUrl?.pathname === `/${locale}/checkout/pay`) {
            yield* validateProtectedBrowserNavigation(
              config,
              url as string,
              `/${locale}/checkout/pay`
            );
            if (yield* isPayPageReady(run, session)) {
              return { status: "ready" as const, url: url as string };
            }
            return undefined;
          }

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

const isPayPageReady = (
  run: Runner,
  session: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  runBrowserCommand(
    "check checkout pay page readiness",
    run,
    session,
    ["eval", "--stdin"],
    {
      allowFailure: true,
      input: payPageReadyScript,
      logOutput: false,
      timeoutMs: 30_000,
    }
  ).pipe(
    Effect.map(
      (result) =>
        result.exitCode === 0 && result.stdout.trim().toLowerCase() === "true"
    )
  );

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
  parseUrl(url ?? "")?.pathname.includes("/checkout/status/") ?? false;

const submitPaymentAndWaitForHostedPage = ({
  run,
  session,
}: {
  run: Runner;
  session: string;
}) =>
  Effect.gen(function* () {
    yield* clickCheckoutPayConsent(run, session);
    yield* activateCheckoutPayButton(run, session);

    return yield* waitForBrowserUrl({
      description: "Nexi hosted payment page",
      matches: (url) =>
        url.includes("nexigroup.com") || url.includes("/hpp/nexi/"),
      run,
      session,
      timeoutMs: getWorkspaceE2ETimeoutMs("providerTransition"),
    });
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

export const completeNexiHostedPayment = ({
  data,
  run,
  session,
}: {
  data: CheckoutData;
  run: Runner;
  session: string;
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
      NEXI_TEST_CARD_NUMBER
    );
    yield* fillHostedPaymentField(
      run,
      session,
      ["Expiration date", "Scadenza", "Data scadenza"],
      ["EXPIRATION_DATE"],
      NEXI_TEST_EXPIRY
    );
    yield* fillHostedPaymentField(
      run,
      session,
      ["CVV", "CVC", "Codice sicurezza"],
      ["SECURITY_CODE"],
      NEXI_TEST_CVV
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
      { optional: true, timeoutMs: 15_000 }
    );
    yield* clickHostedPaymentTarget(run, session, "pay", [
      { value: "PAY" },
      { value: "Pay" },
      { value: "PAGA" },
    ]);
    yield* clickHostedPaymentTarget(run, session, "3DS success", [
      { value: "AUTENTICAZIONE RIUSCITA" },
      { value: "Authentication successful" },
    ]);
    if (isCheckoutStatusUrl(yield* readBrowserUrl(run, session))) {
      log(
        "Nexi back-to-shop action skipped; checkout status page already loaded"
      );
      return;
    }

    const backToShopExit = yield* Effect.exit(
      clickHostedPaymentTarget(run, session, "back to shop", [
        { value: "BACK TO THE SHOP" },
        { value: "Back to the shop" },
        { value: "TORNA AL NEGOZIO" },
      ])
    );

    if (Exit.isSuccess(backToShopExit)) return;
    if (isCheckoutStatusUrl(yield* readBrowserUrl(run, session))) {
      log(
        "Nexi back-to-shop action skipped; checkout status page already loaded"
      );
      return;
    }

    return yield* toWorkspaceE2EError(
      "click Nexi back to shop",
      Cause.squash(backToShopExit.cause)
    );
  });

const fillHostedPaymentField = (
  run: Runner,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  value: string
) =>
  Effect.gen(function* () {
    const target = yield* requireHostedPaymentRef(
      run,
      session,
      labels,
      frameLabels
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
  timeoutMs = getWorkspaceE2ETimeoutMs("providerTransition")
): Effect.Effect<HostedPaymentRef, WorkspaceE2EError> =>
  pollUntil(findHostedPaymentRef(run, session, labels, frameLabels), {
    intervalMs: workspaceE2EPollIntervalMs.browser,
    label: `Nexi target ${labels.join(" / ")}`,
    timeoutMs,
  }).pipe(
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
      frameLabels
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
  frameLabels: readonly string[]
): Effect.Effect<HostedPaymentRef | undefined, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const snapshot = yield* readInteractiveSnapshot(run, session);
    const directRef = findSnapshotRef(snapshot, labels);
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
        const frameFieldRef =
          findSnapshotRef(frameSnapshot, labels) ??
          (frame.exact ? findFirstTextFieldRef(frameSnapshot) : undefined);
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

  return [...frames.values()].sort((left, right) =>
    left.exact === right.exact ? 0 : left.exact ? -1 : 1
  );
};

type HostedPaymentClickTarget = {
  readonly value: string;
};

const clickHostedPaymentTarget = (
  run: Runner,
  session: string,
  label: string,
  targets: readonly HostedPaymentClickTarget[],
  options: { readonly optional?: boolean; readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const labels = targets.map((target) => target.value);
    const timeoutMs =
      options.timeoutMs ?? getWorkspaceE2ETimeoutMs("providerTransition");
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
  return match[1];
};

const getSearchOrderId = (value: string | undefined) => {
  if (!value) return undefined;
  const url = parseUrl(value);
  return url?.searchParams.get("orderId") ?? undefined;
};
