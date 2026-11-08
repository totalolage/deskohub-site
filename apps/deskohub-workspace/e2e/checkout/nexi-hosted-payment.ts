import type { Page } from "@playwright/test";
import { Effect, Exit } from "effect";
import {
  locateSnapshotRef,
  readNetworkLog,
  readPageSnapshot,
  readPageUrl,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import {
  type NexiHostedPaymentStep,
  toNexiHostedPaymentDiagnosticCode,
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { pollUntil } from "../polling";
import { redact, redactDiagnosticText } from "../redaction";
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
import { nexiSandboxTestCard } from "./nexi-sandbox-test-card";

const cardFieldFillAttemptCount = 3;
const optionalCardFieldTimeoutMs = 10_000;
const continueAbsentAfterMs = 15_000;

export type HostedPaymentPage = {
  // The checkout pay page that started this hosted payment.
  readonly checkoutPage: Page;
  readonly checkoutPageUrl: string;
  // The page showing Nexi: a page of its own, or the checkout page when Nexi
  // opened in the same tab.
  readonly page: Page;
  readonly url: string;
};

type NexiHostedPaymentSession = {
  // Card-data rejections already in the session log before this payment.
  readonly cardDataRejectionBaseline: number;
  readonly session: E2EBrowserSession;
};

// How the driver answers the 3-D Secure stub. A failed authentication ends on
// Nexi's "Payment error" page, whose Back to the shop returns to the result URL.
export type NexiChallengeOutcome = "authenticated" | "failed";

type ObservedNexiHostedPage = {
  readonly observation: NexiHostedPageObservation;
  readonly state: NexiHostedPageState;
};

export const completeNexiHostedPayment = ({
  challengeOutcome = "authenticated",
  data,
  hostedPaymentPage,
  onPaymentAuthorizationRequested,
  session,
  timeouts,
}: {
  challengeOutcome?: NexiChallengeOutcome;
  data: CheckoutData;
  hostedPaymentPage?: HostedPaymentPage;
  // Called just before the Pay activation, which is the only step that asks
  // Nexi to authorize the payment.
  onPaymentAuthorizationRequested?: () => void;
  session: E2EBrowserSession;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    addRedaction(nexiSandboxTestCard.number);
    addRedaction(nexiSandboxTestCard.cvv, true);
    addRedaction(nexiSandboxTestCard.expiry, true);

    const page: NexiHostedPaymentSession = {
      cardDataRejectionBaseline: countNexiCardDataRejections(
        parseNexiBuildResponses(yield* readNetworkLog(session))
      ),
      session,
    };
    const required = { required: true, timeoutMs: timeouts.providerTransition };
    const optional = { required: false, timeoutMs: optionalCardFieldTimeoutMs };

    yield* fillNexiCardField(
      page,
      "card_number",
      nexiSandboxTestCard.number,
      required
    );
    yield* fillNexiCardField(
      page,
      "expiration_date",
      nexiSandboxTestCard.expiry,
      required
    );
    yield* fillNexiCardField(
      page,
      "security_code",
      nexiSandboxTestCard.cvv,
      required
    );
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
    if (challengeOutcome === "authenticated") {
      yield* activateNexiControl(page, "challenge", {
        activation: "pointer",
        findTimeoutMs: timeouts.providerTransition,
        skipWhenReturned: true,
        transitionTimeoutMs: timeouts.providerTransition,
      });
    } else {
      // A frictionless authorization would skip the stub and pay, so the
      // failure choice is required.
      yield* activateNexiControl(page, "challenge_failure", {
        activation: "pointer",
        acceptsProviderErrorPage: true,
        findTimeoutMs: timeouts.providerTransition,
        transitionTimeoutMs: timeouts.providerTransition,
      });
    }
    yield* activateNexiControl(page, "return", {
      acceptsProviderErrorPage: challengeOutcome === "failed",
      findTimeoutMs: timeouts.providerTransition,
      skipWhenReturned: true,
      transitionTimeoutMs: timeouts.providerTransition,
    });

    if (hostedPaymentPage) {
      yield* waitForReturnedPaymentTabToClose({
        hostedPaymentPage,
        session,
        timeoutMs: timeouts.providerTransition,
      });
    }
  });

// An unreadable page reads as no URL and an empty snapshot, which the model
// classifies; the observation itself never fails.
const observeNexiHostedPage = (
  page: NexiHostedPaymentSession
): Effect.Effect<ObservedNexiHostedPage> =>
  Effect.gen(function* () {
    // Every hosted-page decision reads the main document: its AI snapshot
    // already includes the hosted-field iframes with frame-scoped refs. Only
    // the field fill reaches into an iframe, through a frame locator.
    const url = yield* readPageUrl(page.session);
    const isReturnUrl = isCheckoutStatusUrl(url);
    const snapshot = isReturnUrl
      ? ""
      : yield* readPageSnapshot(page.session).pipe(
          Effect.orElseSucceed(() => "")
        );
    const responses = parseNexiBuildResponses(
      yield* readNetworkLog(page.session)
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
    acceptsProviderErrorPage = false,
    label,
    select,
    step,
    timeoutMs,
  }: {
    // The error page is the expected result of a failed authentication, not
    // a sandbox rejection, once the driver has chosen that failure.
    readonly acceptsProviderErrorPage?: boolean;
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
        if (
          isTerminalNexiHostedPageState(observed.state) &&
          !(
            acceptsProviderErrorPage &&
            observed.state.kind === "provider-error-page"
          )
        )
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
            const observed = latest ?? (yield* observeNexiHostedPage(page));
            return yield* nexiHostedPaymentError(step, label, observed, error);
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

// Fills the field, then types it when the fill did not stick, up to
// `cardFieldFillAttemptCount` times. A failed action counts as not filled.
const fillCardFieldTarget = (
  { session }: NexiHostedPaymentSession,
  target: NexiCardFieldTarget,
  value: string
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (
      target.frameRef &&
      !(yield* succeeds(
        session.use("wait for hosted payment frame", (page) =>
          hostedFieldFrame(page, target.frameRef ?? "")
            .locator(":root")
            .waitFor({ state: "attached", timeout: 30_000 })
        )
      ))
    )
      return false;

    for (let attempt = 1; attempt <= cardFieldFillAttemptCount; attempt += 1) {
      const filled = yield* succeeds(
        session.use("fill hosted payment field", (page) =>
          cardFieldInput(page, target).fill(value, { timeout: 60_000 })
        )
      );
      if (!filled) continue;
      if (yield* cardFieldHasValue(session, target)) return true;

      const typed = yield* succeeds(
        session.use("type hosted payment field", (page) =>
          cardFieldInput(page, target).pressSequentially(value, {
            delay: 50,
            timeout: 60_000,
          })
        )
      );
      if (!typed) continue;
      if (yield* cardFieldHasValue(session, target)) return true;
    }
    return false;
  });

const succeeds = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false)
  );

const hostedFieldFrame = (page: Page, frameRef: string) =>
  locateSnapshotRef(page, frameRef).filter({ visible: true }).contentFrame();

// Inside its hosted-field iframe the field is the frame's only input.
const cardFieldInput = (page: Page, target: NexiCardFieldTarget) =>
  (target.frameRef
    ? hostedFieldFrame(page, target.frameRef).locator("input")
    : locateSnapshotRef(page, target.ref)
  ).filter({ visible: true });

const cardFieldHasValue = (
  session: E2EBrowserSession,
  target: NexiCardFieldTarget
) =>
  session
    .use("verify hosted payment field", (page) =>
      cardFieldInput(page, target).inputValue({ timeout: 30_000 })
    )
    .pipe(
      Effect.map((value) => !!redact(value).trim()),
      Effect.orElseSucceed(() => false)
    );

type ControlActivationOptions = {
  readonly acceptsProviderErrorPage?: boolean;
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
      acceptsProviderErrorPage: options.acceptsProviderErrorPage ?? false,
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
    const { session } = page;
    const target = (active: Page) =>
      locateSnapshotRef(active, found.ref).filter({ visible: true });
    const activation = yield* Effect.exit(
      options.activation === "pointer"
        ? session.use("click browser element", (active) =>
            target(active).click({ timeout: 30_000 })
          )
        : Effect.andThen(
            session.use("focus browser element", (active) =>
              target(active).focus({ timeout: 30_000 })
            ),
            // As the argv `press` command, the key press has no timeout of
            // its own; the step bounds it.
            session.use("press browser key", (active) =>
              active.keyboard.press("Enter")
            )
          )
    );
    if (Exit.isFailure(activation)) {
      // The activation can navigate away from Nexi while its command still
      // rejects. Never activate again; accept only an observed return.
      const observed = yield* observeNexiHostedPage(page);
      if (options.skipWhenReturned && observed.state.kind === "returned") {
        log(
          `${label} activation reported an error after returning to checkout status`
        );
        return;
      }
      return yield* activation;
    }

    yield* pollNexiHostedPage(page, {
      acceptsProviderErrorPage: options.acceptsProviderErrorPage ?? false,
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

// Nexi's own page closes itself once it has returned to the checkout status
// page; the checkout page is driven again after that.
const waitForReturnedPaymentTabToClose = ({
  hostedPaymentPage: { checkoutPage, page },
  session,
  timeoutMs,
}: {
  readonly hostedPaymentPage: HostedPaymentPage;
  readonly session: E2EBrowserSession;
  readonly timeoutMs: number;
}) =>
  page === checkoutPage
    ? Effect.void
    : Effect.gen(function* () {
        yield* pollUntil(
          session.use("read browser tabs", async (active) => {
            const pages = active.context().pages();
            return pages.length === 1 && pages[0] === checkoutPage
              ? true
              : undefined;
          }),
          {
            intervalMs: workspaceE2EPollIntervalMs.browser,
            label: "returned payment tab to close",
            timeoutMs,
          }
        );
        yield* session.activate(checkoutPage);
      });

const summarizeHostedPaymentSnapshot = (snapshot: string) => {
  const lines = snapshot
    .split("\n")
    .filter((line) =>
      /\b(?:button|frame|heading|iframe|input|textbox|link)\b/i.test(line)
    )
    .slice(0, 80)
    .map(redactDiagnosticText)
    .join("\n");

  return lines
    ? `Nexi HPP snapshot summary:\n${lines}`
    : "Nexi HPP snapshot summary unavailable";
};
