import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import {
  evalBrowserScript,
  normalizeBrowserText,
  openBrowserPage,
  waitForBrowserCondition,
  waitForBrowserText,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import { readCheckoutRow } from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { addRedaction, assert, log } from "../runtime";
import type { CheckoutData, CheckoutRow, WorkspaceE2EStep } from "../types";
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
  run,
  session,
  timeoutMs,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly description: string;
  readonly locale: CheckoutData["locale"];
  readonly run: Runner;
  readonly session: string;
  readonly timeoutMs: number;
}) => {
  const expectedOrigin = JSON.stringify(new URL(config.baseUrl).origin);
  const expectedPath = JSON.stringify(`/${locale}/contact`);
  return waitForBrowserCondition(
    run,
    session,
    description,
    `(() => location.origin === ${expectedOrigin} &&
      location.pathname === ${expectedPath} &&
      location.hash === "")()`,
    { timeoutMs }
  );
};

const waitForExactReservationUrl = ({
  description,
  run,
  session,
  statusUrl,
  timeoutMs,
}: {
  readonly description: string;
  readonly run: Runner;
  readonly session: string;
  readonly statusUrl: string;
  readonly timeoutMs: number;
}) =>
  waitForBrowserCondition(
    run,
    session,
    description,
    `(() => {
      const expected = new URL(${JSON.stringify(statusUrl)});
      return location.origin === expected.origin &&
        location.pathname === expected.pathname &&
        location.search === expected.search &&
        location.hash === expected.hash;
    })()`,
    { timeoutMs }
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
    "assert paid reservation cookie isolation database state",
    () => {
      assert(row, "paid reservation row is missing after checkout");
      assert(
        row.reservation_id === orderId,
        "paid reservation row id changed before cookie isolation"
      );
      assert(
        row.dotypos_customer_id === customerId,
        "paid reservation customer changed before cookie isolation"
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

const assertAuthorizedPaidSupportStatus = ({
  config,
  orderId,
  run,
  session,
  statusUrl,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
  readonly statusUrl: string;
}) =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, statusUrl);
    yield* waitForExactReservationUrl({
      description: "authorized reservation status URL",
      run,
      session,
      statusUrl,
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserText({
      description: "authorized paid support status",
      matches: (text) => {
        const normalized = normalizeBrowserText(text);
        return (
          normalized.includes("We couldn't deliver your confirmation.") &&
          normalized.includes("Your payment was received") &&
          normalized.includes("Send support request")
        );
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    const result = yield* evalBrowserScript(
      "assert authorized paid support reservation status",
      run,
      session,
      `(() => {
        const orderId = ${JSON.stringify(orderId)};
        const body = document.body?.innerText ?? "";
        const exactOrderId = [...document.querySelectorAll("dd")].some(
          (element) => element.textContent?.trim() === orderId
        );
        return exactOrderId &&
          body.includes("We couldn't deliver your confirmation.") &&
          body.includes("Your payment was received") &&
          document.querySelector("#checkout-status-support-contact") instanceof HTMLAnchorElement &&
          document.querySelector("#checkout-status-access") === null;
      })()`,
      { logOutput: false, timeoutMs: config.timeouts.browserAction }
    );
    yield* tryWorkspaceE2ESync(
      "assert authorized paid support reservation status",
      () =>
        assert(
          result.stdout.trim() === "true",
          "paid reservation status did not expose authorized support details"
        )
    );
  });

const assertOtherReservationDenied = ({
  config,
  orderId,
  run,
  session,
  statusUrl,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly session: string;
  readonly statusUrl: string;
}) =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, statusUrl);
    yield* waitForExactReservationUrl({
      description: "other reservation status URL",
      run,
      session,
      statusUrl,
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserText({
      description: "other reservation not-found status",
      matches: (text) => {
        const normalized = normalizeBrowserText(text);
        return normalized.includes("We could not find this order.");
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    const result = yield* evalBrowserScript(
      "assert other reservation remains private",
      run,
      session,
      `(() => {
        const orderId = ${JSON.stringify(orderId)};
        const body = document.body?.innerText ?? "";
        return !body.includes(orderId) &&
          document.querySelector("#checkout-status-access") === null &&
          document.querySelector("#checkout-status-support-contact") === null;
      })()`,
      { logOutput: false, timeoutMs: config.timeouts.browserAction }
    );
    yield* tryWorkspaceE2ESync("assert other reservation remains private", () =>
      assert(
        result.stdout.trim() === "true",
        "other reservation details were exposed through the target cookie"
      )
    );
  });

export const assertReservationCookieIsolation = ({
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
    yield* waitForReservationContactUrl({
      config,
      description: "original reservation support contact URL",
      locale: data.locale,
      run,
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
        yield* assertAuthorizedPaidSupportStatus({
          config,
          orderId,
          run,
          session,
          statusUrl: targetStatusUrl,
        });
        yield* assertOtherReservationDenied({
          config,
          orderId: localFixture.reservationId,
          run,
          session,
          statusUrl: otherStatusUrl,
        });
      });
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* openBrowserPage(config, run, session, restoreUrl);
          yield* waitForReservationContactUrl({
            config,
            description: "original reservation support contact URL",
            locale: data.locale,
            run,
            session,
            timeoutMs: config.timeouts.browserNavigation,
          });
        }).pipe(Effect.orDie)
      )
    );

    log("Reservation cookie isolation validated");
  });

export const reservationCookieIsolationStep = ({
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
  execute: assertReservationCookieIsolation({
    config,
    customerId,
    data,
    orderId,
    run,
    session,
  }),
  id: "assert-reservation-cookie-isolation",
  timeoutMs: config.timeouts.datasource,
});
