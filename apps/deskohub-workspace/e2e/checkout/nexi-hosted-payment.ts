import { Effect, Exit } from "effect";
import {
  clickBrowserElement,
  focusBrowserElement,
  pressBrowserKey,
  readBrowserNetworkLog,
  readBrowserTabs,
  readBrowserUrl,
  readInteractiveSnapshot,
  requireMainFrame,
  runBrowserCommand,
  summarizeHostedPaymentSnapshot,
  switchToBrowserTab,
  switchToMainFrame,
} from "../browser";
import {
  type NexiHostedPaymentStep,
  toNexiHostedPaymentDiagnosticCode,
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { addRedaction, log } from "../runtime";
import {
  type WorkspaceE2ETimeouts,
  workspaceE2EPollIntervalMs,
} from "../timeouts";
import type { CheckoutData } from "../types";
import { isCheckoutStatusUrl } from "../urls";
import { parseNexiBuildResponses } from "./nexi-build-api";
import {
  classifyNexiHostedPage,
  countNexiCardDataRejections,
  describeNexiHostedPageState,
  findNexiCardField,
  findNexiControl,
  formatNexiBuildFailures,
  isTerminalNexiHostedPageState,
  type NexiCardField,
  type NexiCardFieldTarget,
  type NexiControlTarget,
  type NexiHostedControl,
  type NexiHostedPageObservation,
  type NexiHostedPageState,
  parseNexiSnapshot,
  toNexiHostedPageStateCode,
} from "./nexi-hosted-page";

const NEXI_TEST_CARD_NUMBER = "4509034543615006";
const NEXI_TEST_CVV = "298";
const NEXI_TEST_EXPIRY = "1028";
const cardFieldFillAttemptCount = 3;
const optionalCardFieldTimeoutMs = 10_000;
const continueAbsentAfterMs = 15_000;

export type HostedPaymentPage = {
  // The checkout pay page that started this hosted payment.
  readonly checkoutPageUrl: string;
  readonly checkoutTabId: string;
  readonly hostedPaymentTabId: string;
  readonly url: string;
};

type NexiHostedPaymentSession = {
  // Card-data rejections already in the session log before this payment.
  readonly cardDataRejectionBaseline: number;
  readonly run: Runner;
  readonly session: string;
};

type ObservedNexiHostedPage = {
  readonly observation: NexiHostedPageObservation;
  readonly state: NexiHostedPageState;
};

export const completeNexiHostedPayment = ({
  data,
  hostedPaymentPage,
  onPaymentAuthorizationRequested,
  run,
  session,
  timeouts,
}: {
  data: CheckoutData;
  hostedPaymentPage?: HostedPaymentPage;
  // Called just before the Pay activation, which is the only step that asks
  // Nexi to authorize the payment.
  onPaymentAuthorizationRequested?: () => void;
  run: Runner;
  session: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    addRedaction(NEXI_TEST_CARD_NUMBER);
    addRedaction(NEXI_TEST_CVV, true);
    addRedaction(NEXI_TEST_EXPIRY, true);

    yield* requireMainFrame(run, session);
    const page: NexiHostedPaymentSession = {
      cardDataRejectionBaseline: countNexiCardDataRejections(
        parseNexiBuildResponses(yield* readBrowserNetworkLog(run, session))
      ),
      run,
      session,
    };
    const required = { required: true, timeoutMs: timeouts.providerTransition };
    const optional = { required: false, timeoutMs: optionalCardFieldTimeoutMs };

    yield* fillNexiCardField(
      page,
      "card_number",
      NEXI_TEST_CARD_NUMBER,
      required
    );
    yield* fillNexiCardField(
      page,
      "expiration_date",
      NEXI_TEST_EXPIRY,
      required
    );
    yield* fillNexiCardField(page, "security_code", NEXI_TEST_CVV, required);
    yield* fillNexiCardField(page, "cardholder_name", data.name, optional);
    yield* fillNexiCardField(page, "cardholder_email", data.email, optional);

    yield* activateNexiControl(page, "continue", {
      absentAfterMs: continueAbsentAfterMs,
      findTimeoutMs: timeouts.providerTransition,
      transitionTimeoutMs: timeouts.providerTransition,
    });
    yield* activateNexiControl(page, "pay", {
      findTimeoutMs: timeouts.providerTransition,
      ...(onPaymentAuthorizationRequested
        ? { onActivate: onPaymentAuthorizationRequested }
        : {}),
      transitionTimeoutMs: timeouts.providerTransition,
    });
    yield* activateNexiControl(page, "challenge", {
      activation: "pointer",
      findTimeoutMs: timeouts.providerTransition,
      skipWhenReturned: true,
      transitionTimeoutMs: timeouts.providerTransition,
    });
    yield* activateNexiControl(page, "return", {
      findTimeoutMs: timeouts.providerTransition,
      skipWhenReturned: true,
      transitionTimeoutMs: timeouts.providerTransition,
    });

    if (hostedPaymentPage) {
      yield* waitForReturnedPaymentTabToClose({
        hostedPaymentPage,
        run,
        session,
        timeoutMs: timeouts.providerTransition,
      });
    }
  });

const observeNexiHostedPage = (
  page: NexiHostedPaymentSession
): Effect.Effect<ObservedNexiHostedPage, WorkspaceE2EError> =>
  Effect.gen(function* () {
    // Every hosted-page decision reads the main document: its AI snapshot
    // already includes the hosted-field iframes with frame-scoped refs. Only
    // the scoped field fill enters an iframe, and it always restores main.
    const url = yield* readBrowserUrl(page.run, page.session);
    const isReturnUrl = isCheckoutStatusUrl(url);
    const snapshot = isReturnUrl
      ? ""
      : yield* readInteractiveSnapshot(page.run, page.session, true);
    const responses = parseNexiBuildResponses(
      yield* readBrowserNetworkLog(page.run, page.session)
    );
    const observation: NexiHostedPageObservation = {
      cardDataRejections: Math.max(
        0,
        countNexiCardDataRejections(responses) - page.cardDataRejectionBaseline
      ),
      isReturnUrl,
      responses,
      snapshot,
      ...(url ? { url } : {}),
    };
    return { observation, state: classifyNexiHostedPage(observation) };
  });

// Polls the hosted page until `select` yields a value. Provider states that
// never recover fail immediately; a timeout is classified by the last page.
const pollNexiHostedPage = <A>(
  page: NexiHostedPaymentSession,
  {
    label,
    select,
    step,
    timeoutMs,
  }: {
    readonly label: string;
    readonly select: (observed: ObservedNexiHostedPage) => A | undefined;
    readonly step: NexiHostedPaymentStep;
    readonly timeoutMs: number;
  }
): Effect.Effect<A, WorkspaceE2EError> => {
  let latest: ObservedNexiHostedPage | undefined;
  return pollUntil(
    observeNexiHostedPage(page).pipe(
      Effect.flatMap((observed) => {
        latest = observed;
        if (isTerminalNexiHostedPageState(observed.state))
          return Effect.fail(
            nexiHostedPaymentError(step, label, observed, "provider failure")
          );
        return Effect.succeed(select(observed));
      })
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label,
      timeoutMs,
    }
  ).pipe(
    Effect.catch((error) =>
      error.diagnosticCode
        ? Effect.fail(error)
        : Effect.gen(function* () {
            const observed =
              latest ??
              (yield* observeNexiHostedPage(page).pipe(
                Effect.orElseSucceed(() => undefined)
              ));
            return yield* observed
              ? nexiHostedPaymentError(step, label, observed, error)
              : error;
          })
    )
  );
};

const nexiHostedPaymentError = (
  step: NexiHostedPaymentStep,
  label: string,
  { observation, state }: ObservedNexiHostedPage,
  cause: WorkspaceE2EError | "provider failure"
) => {
  const diagnosticCode = toNexiHostedPaymentDiagnosticCode(
    step,
    toNexiHostedPageStateCode(state) ?? "unknown"
  );
  const reason =
    cause === "provider failure"
      ? `Nexi will not leave this state while waiting for ${label}`
      : cause.message;
  const message = [
    `${label} failed: ${reason}`,
    `Nexi page state: ${describeNexiHostedPageState(state)}`,
    formatNexiBuildFailures(observation.responses),
    summarizeHostedPaymentSnapshot(observation.snapshot),
  ].join("\n");

  if (cause === "provider failure")
    return workspaceE2EError(message, { diagnosticCode, operation: label });
  return (
    cause.reason === "timeout" ? workspaceE2ETimeoutError : workspaceE2EError
  )(message, { cause, diagnosticCode, operation: label });
};

const fillNexiCardField = (
  page: NexiHostedPaymentSession,
  field: NexiCardField,
  value: string,
  {
    required,
    timeoutMs,
  }: { readonly required: boolean; readonly timeoutMs: number }
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const label = `Nexi ${field} field`;
    const target = yield* pollNexiHostedPage<NexiCardFieldTarget | "absent">(
      page,
      {
        label,
        select: ({ observation }) => {
          const found = findNexiCardField(
            parseNexiSnapshot(observation.snapshot),
            field
          );
          if (found?.enabled) return found;
          // Optional fields are skipped only when Nexi does not render them.
          if (!found && !required && observation.snapshot.trim())
            return "absent";
          return undefined;
        },
        step: "card_entry",
        timeoutMs,
      }
    ).pipe(
      Effect.catch((error) =>
        required ||
        (error.diagnosticCode !== undefined && error.reason !== "timeout")
          ? Effect.fail(error)
          : Effect.sync(() => {
              log(`${label} stayed unavailable; continuing without it`);
              return "absent" as const;
            })
      )
    );
    if (target === "absent") return;

    const filled = yield* fillCardFieldTarget(page, target, value);
    if (filled) return;
    if (!required) {
      log(`${label} value did not stick; continuing without it`);
      return;
    }
    const cause = toWorkspaceE2EError(
      `fill ${label}`,
      new Error(
        `field value remained empty after ${cardFieldFillAttemptCount} attempts`
      )
    );
    const observed = yield* observeNexiHostedPage(page);
    return yield* nexiHostedPaymentError("card_entry", label, observed, cause);
  });

// Fills one field inside its hosted-field iframe, then requires the session to
// be back in the main frame: every later decision reads the main document, so
// a failed restore must not surface later as a missing-field timeout. An
// interrupted or failed fill still attempts the restore, best effort.
const fillCardFieldTarget = (
  page: NexiHostedPaymentSession,
  target: NexiCardFieldTarget,
  value: string
): Effect.Effect<boolean, WorkspaceE2EError> => {
  if (!target.frameRef) return fillAndVerifyCardField(page, target, value);
  const restoreBestEffort = switchToMainFrame(page.run, page.session).pipe(
    Effect.ignore
  );
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(
      fillAndVerifyCardField(page, target, value).pipe(
        Effect.onInterrupt(() => restoreBestEffort)
      )
    );
    if (Exit.isFailure(exit)) {
      yield* restoreBestEffort;
      return yield* exit;
    }
    yield* requireMainFrame(page.run, page.session);
    return exit.value;
  });
};

const fillAndVerifyCardField = (
  page: NexiHostedPaymentSession,
  target: NexiCardFieldTarget,
  value: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  Effect.gen(function* () {
    // Inside the field's iframe the hosted field is its only input.
    const selector = target.frameRef ? "input" : target.ref;
    if (target.frameRef) {
      const switched = yield* runCardFieldCommand(
        page,
        "switch hosted payment frame",
        ["frame", target.frameRef],
        30_000
      );
      if (switched.exitCode !== 0) return false;
    }

    for (let attempt = 1; attempt <= cardFieldFillAttemptCount; attempt += 1) {
      const fill = yield* runCardFieldCommand(
        page,
        "fill hosted payment field",
        ["fill", selector, value],
        60_000
      );
      if (fill.exitCode !== 0) continue;
      if (yield* cardFieldHasValue(page, selector)) return true;

      const type = yield* runCardFieldCommand(
        page,
        "type hosted payment field",
        ["type", selector, value],
        60_000
      );
      if (type.exitCode !== 0) continue;
      if (yield* cardFieldHasValue(page, selector)) return true;
    }
    return false;
  });

const runCardFieldCommand = (
  { run, session }: NexiHostedPaymentSession,
  operation: string,
  args: string[],
  timeoutMs: number
) =>
  runBrowserCommand(operation, run, session, args, {
    allowFailure: true,
    logCommand: false,
    logOutput: false,
    timeoutMs,
  });

const cardFieldHasValue = (page: NexiHostedPaymentSession, selector: string) =>
  runCardFieldCommand(
    page,
    "verify hosted payment field",
    ["get", "value", selector],
    30_000
  ).pipe(
    Effect.map((result) => result.exitCode === 0 && !!result.stdout.trim())
  );

type ControlActivationOptions = {
  readonly activation?: "keyboard" | "pointer";
  // Skip the control when Nexi never renders it within this window. Once
  // rendered, the control must become enabled and complete its transition.
  readonly absentAfterMs?: number;
  readonly findTimeoutMs: number;
  readonly onActivate?: () => void;
  // Treat a provider redirect back to checkout status as completion.
  readonly skipWhenReturned?: boolean;
  readonly transitionTimeoutMs: number;
};

const activateNexiControl = (
  page: NexiHostedPaymentSession,
  control: NexiHostedControl,
  options: ControlActivationOptions
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const label = `Nexi ${control} control`;
    const startedAt = Date.now();
    let rendered = false;
    const found = yield* pollNexiHostedPage<
      NexiControlTarget | "absent" | "returned"
    >(page, {
      label,
      select: ({ observation, state }) => {
        if (state.kind === "returned")
          return options.skipWhenReturned ? "returned" : undefined;
        const target = findNexiControl(
          parseNexiSnapshot(observation.snapshot),
          control
        );
        rendered ||= target !== undefined;
        if (target?.enabled) return target;
        return !rendered &&
          options.absentAfterMs !== undefined &&
          Date.now() - startedAt >= options.absentAfterMs
          ? "absent"
          : undefined;
      },
      step: control,
      timeoutMs: options.findTimeoutMs,
    });
    if (found === "absent") {
      log(`${label} not rendered; continuing`);
      return;
    }
    if (found === "returned") {
      log(`${label} skipped; checkout status page already loaded`);
      return;
    }

    options.onActivate?.();
    const activation = yield* Effect.exit(
      options.activation === "pointer"
        ? clickBrowserElement(page.run, page.session, found.ref, {
            timeoutMs: 30_000,
          })
        : Effect.gen(function* () {
            yield* focusBrowserElement(page.run, page.session, found.ref, {
              timeoutMs: 30_000,
            });
            yield* pressBrowserKey(page.run, page.session, "Enter", {
              timeoutMs: 30_000,
            });
          })
    );
    if (Exit.isFailure(activation)) {
      // The activation can navigate away from Nexi while its command still
      // rejects. Never activate again; accept only an observed return.
      const observed = yield* observeNexiHostedPage(page).pipe(
        Effect.orElseSucceed(() => undefined)
      );
      if (options.skipWhenReturned && observed?.state.kind === "returned") {
        log(
          `${label} activation reported an error after returning to checkout status`
        );
        return;
      }
      return yield* activation;
    }

    yield* pollNexiHostedPage(page, {
      label: `${label} completion`,
      select: ({ observation, state }) => {
        if (state.kind === "returned") return true;
        // Navigation between Nexi documents briefly has no snapshot.
        if (state.kind === "snapshot-unavailable") return undefined;
        return findNexiControl(parseNexiSnapshot(observation.snapshot), control)
          ? undefined
          : true;
      },
      step: control,
      timeoutMs: options.transitionTimeoutMs,
    });
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
  hostedPaymentPage.hostedPaymentTabId === hostedPaymentPage.checkoutTabId
    ? Effect.void
    : Effect.gen(function* () {
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
        yield* switchToBrowserTab(
          run,
          session,
          hostedPaymentPage.checkoutTabId
        );
      });
