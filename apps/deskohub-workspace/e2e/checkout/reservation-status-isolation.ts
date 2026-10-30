import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { normalizeBrowserText, openPage, waitForPageText } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStep } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  withoutWorkspaceE2ETimeout,
} from "../errors";
import { readCheckoutRow } from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  addRedaction,
  assert,
  browserSessionFor,
  log,
  type Runner,
} from "../runtime";
import type { CheckoutData, CheckoutRow } from "../types";
import { withWorkspaceE2ELocalReservationFixture } from "./local-reservation-fixture";

const makeReservationStatusUrl = (
  config: WorkspaceE2EConfig,
  locale: CheckoutData["locale"],
  orderId: WorkspaceReservationId
) =>
  new URL(
    `/${locale}${reservationStatusPath}/${encodeURIComponent(orderId)}`,
    config.baseUrl
  ).toString();

const makeReservationContactUrl = (
  config: WorkspaceE2EConfig,
  locale: CheckoutData["locale"]
) => new URL(`/${locale}/contact`, config.baseUrl).toString();

const waitForReservationContactUrl = ({
  config,
  description,
  locale,
  session,
  timeoutMs,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly description: string;
  readonly locale: CheckoutData["locale"];
  readonly session: E2EBrowserSession;
  readonly timeoutMs: number;
}) =>
  session
    .use(`wait for ${description}`, (page) =>
      page.waitForFunction(
        (expected) =>
          location.origin === expected.origin &&
          location.pathname === expected.pathname &&
          location.hash === "",
        {
          origin: new URL(config.baseUrl).origin,
          pathname: `/${locale}/contact`,
        },
        { timeout: timeoutMs }
      )
    )
    .pipe(Effect.asVoid);

const waitForExactReservationUrl = ({
  description,
  session,
  statusUrl,
  timeoutMs,
}: {
  readonly description: string;
  readonly session: E2EBrowserSession;
  readonly statusUrl: string;
  readonly timeoutMs: number;
}) =>
  session
    .use(`wait for ${description}`, (page) =>
      page.waitForFunction(
        (statusUrl) => {
          const expected = new URL(statusUrl);
          return (
            location.origin === expected.origin &&
            location.pathname === expected.pathname &&
            location.search === expected.search &&
            location.hash === expected.hash
          );
        },
        statusUrl,
        { timeout: timeoutMs }
      )
    )
    .pipe(Effect.asVoid);

/**
 * Evaluates a self-contained check of the page and fails with `failure`
 * unless it holds. An evaluation that overruns its bound fails rather than
 * timing out, as the argv evaluation it replaces did.
 */
const assertPage = <Arg>({
  arg,
  check,
  config,
  failure,
  label,
  session,
}: {
  readonly arg: Arg;
  readonly check: (arg: Arg) => boolean;
  readonly config: WorkspaceE2EConfig;
  readonly failure: string;
  readonly label: string;
  readonly session: E2EBrowserSession;
}) =>
  session
    .evaluate(label, check, arg, { timeoutMs: config.timeouts.browserAction })
    .pipe(
      withoutWorkspaceE2ETimeout(label),
      Effect.flatMap((holds) =>
        tryWorkspaceE2ESync(label, () => assert(holds === true, failure))
      )
    );

const assertPaidSupportReservationRow = ({
  customerId,
  orderId,
  row,
}: {
  readonly customerId: DotyposCustomerId;
  readonly orderId: WorkspaceReservationId;
  readonly row: CheckoutRow | undefined;
}) =>
  tryWorkspaceE2ESync(
    "assert paid reservation status isolation database state",
    () => {
      assert(row, "paid reservation row is missing after checkout");
      assert(
        row.reservation_id === orderId,
        "paid reservation row id changed before status isolation"
      );
      assert(
        row.dotypos_customer_id === customerId,
        "paid reservation customer changed before status isolation"
      );
      assert(
        row.payment_state === "paid",
        "paid reservation payment state was not paid"
      );
      assert(
        row.fulfillment_state === "failed",
        "paid reservation did not remain in the support failure state"
      );
    }
  );

const assertAuthorizedPaidSupportStatus = Effect.fn(
  "ReservationStatusIsolation.assertAuthorizedPaidSupportStatus"
)(function* ({
  config,
  orderId,
  session,
  statusUrl,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
  readonly statusUrl: string;
}) {
  yield* openPage(session, config, statusUrl);
  yield* waitForExactReservationUrl({
    description: "authorized reservation status URL",
    session,
    statusUrl,
    timeoutMs: config.timeouts.browserNavigation,
  });
  yield* waitForPageText({
    description: "authorized paid support status",
    matches: (text) => {
      const normalized = normalizeBrowserText(text);
      return (
        normalized.includes("We couldn't deliver your confirmation.") &&
        normalized.includes("Your payment went through") &&
        normalized.includes("Send support request")
      );
    },
    session,
    timeoutMs: config.timeouts.uiTransition,
  });
  yield* assertPage({
    arg: orderId,
    check: (orderId) => {
      const body = document.body?.innerText ?? "";
      const exactOrderId = [...document.querySelectorAll("dd")].some(
        (element) => element.textContent?.trim() === orderId
      );
      return (
        exactOrderId &&
        body.includes("We couldn't deliver your confirmation.") &&
        body.includes("Your payment went through") &&
        document.querySelector("#checkout-status-support-contact") instanceof
          HTMLAnchorElement &&
        document.querySelector("#checkout-status-access") === null
      );
    },
    config,
    failure:
      "paid reservation status did not expose authorized support details",
    label: "assert authorized paid support reservation status",
    session,
  });
});

const assertOtherReservationDenied = Effect.fn(
  "ReservationStatusIsolation.assertOtherReservationDenied"
)(function* ({
  config,
  orderId,
  session,
  statusUrl,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
  readonly statusUrl: string;
}) {
  yield* openPage(session, config, statusUrl);
  yield* waitForExactReservationUrl({
    description: "other reservation status URL",
    session,
    statusUrl,
    timeoutMs: config.timeouts.browserNavigation,
  });
  yield* waitForPageText({
    description: "other reservation not-found status",
    matches: (text) => {
      const normalized = normalizeBrowserText(text);
      return normalized.includes("We could not find this order.");
    },
    session,
    timeoutMs: config.timeouts.uiTransition,
  });
  yield* assertPage({
    arg: orderId,
    check: (orderId) =>
      !(document.body?.innerText ?? "").includes(orderId) &&
      document.querySelector("#checkout-status-access") === null &&
      document.querySelector("#checkout-status-support-contact") === null,
    config,
    failure: "other reservation details were exposed to the booking session",
    label: "assert other reservation remains private",
    session,
  });
});

/**
 * A signed-out visitor of the status link signs in first: the page redirects
 * to the reservation sign-in with the status path to return to, and shows
 * nothing of the order.
 */
const assertSignedOutStatusSignIn = Effect.fn(
  "ReservationStatusIsolation.assertSignedOutStatusSignIn"
)(function* ({
  config,
  locale,
  orderId,
  session,
  statusUrl,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly session: E2EBrowserSession;
  readonly statusUrl: string;
}) {
  const title = m.accountSignInReservationTitle({}, { locale });
  yield* openPage(session, config, statusUrl);
  yield* session.use(
    "wait for signed-out reservation status sign-in URL",
    (page) =>
      page.waitForFunction(
        (expected) => {
          const search = new URLSearchParams(location.search);
          return (
            location.origin === expected.origin &&
            location.pathname === expected.pathname &&
            search.get("returnTo") === expected.returnTo &&
            search.get("for") === "reservation"
          );
        },
        {
          origin: new URL(config.baseUrl).origin,
          pathname: `/${locale}/auth/sign-in`,
          returnTo: new URL(statusUrl).pathname,
        },
        { timeout: config.timeouts.browserNavigation }
      )
  );
  yield* waitForPageText({
    description: "signed-out reservation status sign-in title",
    matches: (text) => normalizeBrowserText(text).includes(title),
    session,
    timeoutMs: config.timeouts.uiTransition,
  });
  yield* assertPage({
    arg: orderId,
    check: (orderId) =>
      !(document.body?.innerText ?? "").includes(orderId) &&
      document.querySelector("#checkout-status-support-contact") === null,
    config,
    failure: "reservation status details were exposed to a signed-out visitor",
    label: "assert signed-out reservation status stays private",
    session,
  });
});

/**
 * The signed-out visitor's own browser, opened through the runner's id
 * beside the booking session and closed when the check ends. Interrupting
 * the check also stops waiting for the browser to open, and a close that
 * fails or outlasts `browserSessionClose` is ignored, as the argv close was;
 * the runner's Scope still closes a session that outlives either wait.
 */
const signedOutBrowser = (
  config: WorkspaceE2EConfig,
  run: Runner,
  id: string
) =>
  Effect.acquireRelease(
    browserSessionFor(run, id),
    (session) =>
      session
        .close()
        .pipe(
          Effect.timeout(config.timeouts.browserSessionClose),
          Effect.ignore
        ),
    { interruptible: true }
  );

/**
 * Checks who can read the paid order's status. Checkout runs signed in, so
 * the booking session reads its own order and nothing else, and a signed-out
 * visitor of the same status link is sent to sign in.
 */
export const assertReservationStatusIsolation = ({
  config,
  customerId,
  data,
  orderId,
  run,
  session: sessionId,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly customerId: DotyposCustomerId;
  readonly data: Pick<CheckoutData, "locale">;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    addRedaction(customerId, true);
    addRedaction(orderId, true);

    const restoreUrl = makeReservationContactUrl(config, data.locale);
    const targetStatusUrl = makeReservationStatusUrl(
      config,
      data.locale,
      orderId
    );
    addRedaction(targetStatusUrl);
    const session = yield* browserSessionFor(run, sessionId);
    yield* waitForReservationContactUrl({
      config,
      description: "original reservation support contact URL",
      locale: data.locale,
      session,
      timeoutMs: config.timeouts.browserNavigation,
    });

    const row = yield* readCheckoutRow(orderId);
    yield* assertPaidSupportReservationRow({ customerId, orderId, row });

    yield* withWorkspaceE2ELocalReservationFixture((localFixture) => {
      addRedaction(localFixture.customerId, true);
      addRedaction(localFixture.reservationId, true);
      const otherStatusUrl = makeReservationStatusUrl(
        config,
        data.locale,
        localFixture.reservationId
      );
      addRedaction(otherStatusUrl);

      return Effect.gen(function* () {
        yield* tryWorkspaceE2ESync(
          "assert reservation isolation fixture differs from target",
          () => {
            assert(
              localFixture.customerId !== customerId,
              "reservation isolation fixture customer must differ from target"
            );
            assert(
              localFixture.reservationId !== orderId,
              "reservation isolation fixture order must differ from target"
            );
          }
        );
        yield* Effect.scoped(
          Effect.flatMap(
            signedOutBrowser(config, run, `${sessionId}-signed-out`),
            (signedOut) =>
              assertSignedOutStatusSignIn({
                config,
                locale: data.locale,
                orderId,
                session: signedOut,
                statusUrl: targetStatusUrl,
              })
          )
        );
        yield* assertAuthorizedPaidSupportStatus({
          config,
          orderId,
          session,
          statusUrl: targetStatusUrl,
        });
        yield* assertOtherReservationDenied({
          config,
          orderId: localFixture.reservationId,
          session,
          statusUrl: otherStatusUrl,
        });
      });
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* openPage(session, config, restoreUrl);
          yield* waitForReservationContactUrl({
            config,
            description: "original reservation support contact URL",
            locale: data.locale,
            session,
            timeoutMs: config.timeouts.browserNavigation,
          });
        }).pipe(Effect.orDie)
      )
    );

    log("Reservation status isolation validated");
  });

export const reservationStatusIsolationStep = ({
  config,
  customerId,
  data,
  orderId,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly customerId: DotyposCustomerId;
  readonly data: Pick<CheckoutData, "locale">;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
}): WorkspaceE2EStep<void, E2EDatabase> => ({
  execute: assertReservationStatusIsolation({
    config,
    customerId,
    data,
    orderId,
    run,
    session,
  }),
  id: "assert-reservation-status-isolation",
  timeoutMs: config.timeouts.datasource,
});
