import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  currencyCZK,
  formatWorkspaceMoney,
} from "@/features/checkout/workspace-money";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/persistence-contracts";
import { discountCodeQueryParam } from "@/features/discounts/promotion-code";
import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  activateHydratedBrowserElement,
  focusBrowserElement,
  openBrowserPage,
  readBrowserUrl,
  scrollBrowserElementIntoView,
  waitForBrowserCondition,
  waitForBrowserReactHandler,
  waitForBrowserTextContent,
  waitForBrowserUrl,
} from "../browser";
import {
  getPrefilledReservationConditionScript,
  getSubmitMeetingRoomReservationScript,
  submitPreparedMeetingRoomReservationScript,
} from "../browser-scripts";
import {
  type MeetingRoomCheckoutSlot,
  makeMeetingRoomCheckoutData,
  reuseMeetingRoomCheckoutContact,
} from "../checkout/data";
import { submitDiscountCode } from "../checkout/discount-code";
import { submitReservationForPayPage } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import {
  assertNoDiscountPaymentState,
  readCheckoutRow,
  waitForCheckoutRow,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import { readDotyposReservationStatus } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { addRedaction, assert, log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2ECase,
  WorkspaceE2EStepRunner,
} from "../types";
import {
  assertHeldMeetingRoomSlotAvailability,
  type MeetingRoomE2EPreparation,
  meetingRoomE2ECoreSlotCount,
} from "./meeting-room";

const _reservationLinkSlotCount = 4;
// Syntactically canonical but never seeded, so the checkout can only treat it
// as customer intent and never as an applied discount.
const unknownLinkCode = canonicalPromotionCodeSchema.make("E2E_LINK_UNKNOWN");

type LinkLocale = CheckoutData["locale"];

export const makeReservationLinkE2ECases = ({
  config,
  datasourceConfig,
  flowStates,
  preparation,
  run,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly flowStates: CheckoutFlowState[];
  readonly preparation: MeetingRoomE2EPreparation;
  readonly run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const linkSlots = preparation.slots.slice(meetingRoomE2ECoreSlotCount);
    const requireLinkSlot = (
      slot: MeetingRoomCheckoutSlot | undefined,
      id: string
    ) =>
      tryWorkspaceE2ESync(`require ${id} reservation-link slot`, () => {
        assert(slot, `missing ${id} reservation-link slot`);
        return slot;
      });
    const enZeroTotalSlot = yield* requireLinkSlot(
      linkSlots[0],
      "en-US zero-total"
    );
    const csZeroTotalSlot = yield* requireLinkSlot(
      linkSlots[1],
      "cs-CZ zero-total"
    );
    const unknownCodeSlot = yield* requireLinkSlot(
      linkSlots[2],
      "unknown code"
    );
    const replacementSlot = yield* requireLinkSlot(linkSlots[3], "replacement");

    const zeroTotalCode = discountCodeFixtures.zeroTotal.code;
    addRedaction(zeroTotalCode, true);
    addRedaction(unknownLinkCode, true);

    const enZeroTotalData = makeReservationLinkCheckoutData(
      config.baseUrl,
      enZeroTotalSlot,
      "meeting-room-link-zero-total-en-US",
      "en-US",
      zeroTotalCode
    );
    const csZeroTotalData = makeReservationLinkCheckoutData(
      config.baseUrl,
      csZeroTotalSlot,
      "meeting-room-link-zero-total-cs-CZ",
      "cs-CZ",
      zeroTotalCode
    );
    const unknownCodeData = makeReservationLinkCheckoutData(
      config.baseUrl,
      unknownCodeSlot,
      "meeting-room-link-unknown-code-en-US",
      "en-US",
      unknownLinkCode
    );
    // The replacement resubmission must target a different free interval,
    // like the existing reservation-replacement flows, because the first
    // hold still occupies the original slot until supersession cancels it.
    const replacementData = reuseMeetingRoomCheckoutContact(
      config.baseUrl,
      replacementSlot,
      enZeroTotalData
    );

    // The original and replacement holds are separate cleanup resources: each
    // keeps its own flow state so cleanup can cancel both after a failure.
    const enZeroTotalState = trackCheckoutState(flowStates, enZeroTotalData);
    const enReplacementState = trackCheckoutState(flowStates, replacementData);
    const csZeroTotalState = trackCheckoutState(flowStates, csZeroTotalData);
    const unknownCodeState = trackCheckoutState(flowStates, unknownCodeData);

    return [
      {
        checkoutStates: [enZeroTotalState, enReplacementState],
        execute: ({ runStep, session }) =>
          runReservationLinkZeroTotalCase({
            config,
            data: enZeroTotalData,
            datasourceConfig,
            firstState: enZeroTotalState,
            httpClient,
            locale: "en-US",
            replacementData,
            replacementState: enReplacementState,
            run,
            runStep,
            session,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run en-US meeting-room reservation-link e2e case",
                cause
              )
            )
          ),
        id: "reservation-link-meeting-room-zero-total-en-US",
        timeoutMs: config.timeouts.checkoutCase,
      },
      {
        checkoutStates: [csZeroTotalState],
        execute: ({ runStep, session }) =>
          runReservationLinkZeroTotalCase({
            config,
            data: csZeroTotalData,
            datasourceConfig,
            firstState: csZeroTotalState,
            httpClient,
            locale: "cs-CZ",
            run,
            runStep,
            session,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run cs-CZ meeting-room reservation-link e2e case",
                cause
              )
            )
          ),
        id: "reservation-link-meeting-room-zero-total-cs-CZ",
        timeoutMs: config.timeouts.checkoutCase,
      },
      {
        checkoutStates: [unknownCodeState],
        execute: ({ runStep, session }) =>
          runReservationLinkUnknownCodeCase({
            config,
            data: unknownCodeData,
            datasourceConfig,
            httpClient,
            run,
            runStep,
            session,
            state: unknownCodeState,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run unknown reservation-link code e2e case",
                cause
              )
            )
          ),
        id: "reservation-link-meeting-room-unknown-code-en-US",
        timeoutMs: config.timeouts.checkoutCase,
      },
    ];
  });

const makeReservationLinkCheckoutData = (
  checkoutBaseUrl: string,
  slot: MeetingRoomCheckoutSlot,
  flowId: string,
  locale: LinkLocale,
  discountCode: CanonicalPromotionCode
): CheckoutData => {
  const base = makeMeetingRoomCheckoutData(checkoutBaseUrl, slot, flowId);
  assert(base.meetingRoom, "reservation-link checkout interval missing");
  const params = new URLSearchParams({
    [discountCodeQueryParam]: discountCode,
    duration: getMeetingRoomReservationDurationKey(slot.duration),
    email: base.email,
    message: base.message,
    name: base.name,
    // URLSearchParams percent-encodes the leading "+" so the signed link
    // survives email clients and copy/paste instead of decoding into a space.
    phone: base.phone,
    startDateTime: slot.startDateTime,
  });
  return {
    ...base,
    checkoutUrl: `${checkoutBaseUrl}/${locale}/reservation/meeting-room?${params}`,
    locale,
  };
};

const runReservationLinkZeroTotalCase = ({
  config,
  data,
  datasourceConfig,
  firstState,
  httpClient,
  locale,
  replacementData,
  replacementState,
  run,
  runStep,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly firstState: CheckoutFlowState;
  readonly httpClient: HttpClient.HttpClient;
  readonly locale: LinkLocale;
  readonly replacementData?: CheckoutData;
  readonly replacementState?: CheckoutFlowState;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    firstState.startedAt = new Date();
    const firstOrderId = yield* openLinkAndHoldReservation({
      assertSelectedDurationZeroPrice: true,
      config,
      data,
      run,
      runStep,
      session,
      state: firstState,
    });
    const firstRow = yield* runStep({
      execute: assertHeldReservationRow(datasourceConfig, firstOrderId, data),
      id: "assert-held-link-reservation-row",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertHeldMeetingRoomSlotAvailability(
        config,
        datasourceConfig,
        data,
        firstRow
      ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      id: "assert-held-link-slot-availability",
      timeoutMs: config.timeouts.datasource,
    });
    // The link code applies during the advertisement/customer quote, so the
    // landing pay URL is already final and safe to reload as captured.
    const payUrl = yield* runStep({
      execute: readSignedPayUrl(run, session, locale, firstOrderId),
      id: "assert-signed-pay-url",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: assertAppliedZeroTotalPaySummary({ config, data, run, session }),
      id: "assert-applied-zero-total-link-pay-summary",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, payUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        yield* assertAppliedZeroTotalPaySummary({
          config,
          data,
          run,
          session,
        });
      }),
      id: "reload-signed-pay-url-and-reassert-summary",
      timeoutMs: config.timeouts.uiTransition,
    });

    if (!replacementData || !replacementState) {
      yield* runStep({
        execute: assertNoDiscountPaymentState(firstOrderId),
        id: "assert-link-created-no-payment-state",
        timeoutMs: config.timeouts.datasource,
      });
      log(`reservation-link zero-total e2e passed for order ${firstOrderId}`);
      return;
    }

    replacementState.startedAt = new Date();
    const secondOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        yield* returnToReservationWithConflictingQuery({
          config,
          data,
          locale,
          replacementData,
          run,
          session,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (orderId) => {
            replacementState.orderId = orderId;
          },
          run,
          session,
          submitReservationScript:
            getSubmitMeetingRoomReservationScript(replacementData),
          timeouts: config.timeouts,
        });
      }),
      id: "resubmit-after-conflicting-query-restoration",
      timeoutMs: config.timeouts.checkoutStart,
    });
    const secondRow = yield* runStep({
      execute: assertHeldReservationRow(
        datasourceConfig,
        secondOrderId,
        replacementData
      ),
      id: "assert-replacement-link-reservation-row",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertHeldMeetingRoomSlotAvailability(
        config,
        datasourceConfig,
        replacementData,
        secondRow
      ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      id: "assert-replacement-held-slot-availability",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertSupersededLinkHold({
        datasourceConfig,
        firstOrderId,
        secondOrderId,
        secondRow,
      }),
      id: "assert-link-hold-superseded",
      timeoutMs: config.timeouts.datasource,
    });
    // The original link code rides through the restored reservation, so the
    // replacement pay page is already zero-total without another apply.
    yield* runStep({
      execute: assertAppliedZeroTotalPaySummary({
        config,
        data: replacementData,
        run,
        session,
      }),
      id: "assert-replacement-zero-total-pay-summary",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(firstOrderId),
      id: "assert-superseded-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(secondOrderId),
      id: "assert-replacement-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`reservation-link replacement e2e passed for order ${secondOrderId}`);
  });

const runReservationLinkUnknownCodeCase = ({
  config,
  data,
  datasourceConfig,
  httpClient,
  run,
  runStep,
  session,
  state,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly httpClient: HttpClient.HttpClient;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const zeroTotalCode = discountCodeFixtures.zeroTotal.code;
    const orderId = yield* openLinkAndHoldReservation({
      config,
      data,
      run,
      runStep,
      session,
      state,
    });
    const heldRow = yield* runStep({
      execute: assertHeldReservationRow(datasourceConfig, orderId, data),
      id: "assert-held-unknown-code-reservation-row",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertHeldMeetingRoomSlotAvailability(
        config,
        datasourceConfig,
        data,
        heldRow
      ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      id: "assert-held-unknown-code-slot-availability",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: readSignedPayUrl(run, session, data.locale, orderId).pipe(
        Effect.asVoid
      ),
      id: "assert-signed-unknown-code-pay-url",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: assertRequestedOnlyDiscountCode({
        code: unknownLinkCode,
        config,
        run,
        session,
      }),
      id: "assert-unknown-code-requested-only",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* submitDiscountCode({
          code: unknownLinkCode,
          config,
          run,
          session,
        });
        yield* waitForBrowserTextContent(
          run,
          session,
          m.checkoutDiscountCodeUnavailable({}, { locale: data.locale }),
          { timeoutMs: config.timeouts.uiTransition }
        );
      }),
      id: "apply-unknown-code-gives-unavailable-feedback",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertRequestedOnlyDiscountCode({
        code: unknownLinkCode,
        config,
        run,
        session,
      }),
      id: "assert-unknown-code-intent-retained",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* submitDiscountCode({
          code: zeroTotalCode,
          config,
          run,
          session,
        });
        yield* waitForBrowserTextContent(
          run,
          session,
          appliedDiscountMessage(data.locale),
          { timeoutMs: config.timeouts.uiTransition }
        );
      }),
      id: "correct-to-zero-total-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    // The correction server action re-signs the pay state, so capture the
    // fresh pay URL now and reload exactly that URL.
    const freshPayUrl = yield* runStep({
      execute: readSignedPayUrl(run, session, data.locale, orderId),
      id: "read-fresh-signed-pay-url-after-correction",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, freshPayUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        yield* assertAppliedZeroTotalPaySummary({ config, data, run, session });
      }),
      id: "reload-fresh-signed-pay-url-and-reassert-summary",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-corrected-link-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`reservation-link unknown-code e2e passed for order ${orderId}`);
  });

const openLinkAndHoldReservation = ({
  assertSelectedDurationZeroPrice = false,
  config,
  data,
  run,
  runStep,
  session,
  state,
}: {
  readonly assertSelectedDurationZeroPrice?: boolean;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}) =>
  runStep({
    execute: Effect.gen(function* () {
      yield* openBrowserPage(config, run, session, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      });
      // Prove the signed link prefills the native form values before any
      // submission helper can mask a prefill regression.
      yield* waitForBrowserCondition(
        run,
        session,
        "reservation-link prefilled form values",
        getPrefilledReservationConditionScript(data),
        { timeoutMs: config.timeouts.uiTransition }
      );
      if (assertSelectedDurationZeroPrice) {
        // The valid link code applies during the advertisement quote, so the
        // selected hour:1 option must already advertise the zero amount.
        yield* waitForBrowserCondition(
          run,
          session,
          "selected duration advertises the discounted zero amount",
          getSelectedDurationZeroPriceCondition(data),
          { timeoutMs: config.timeouts.uiTransition }
        );
      }
      return yield* submitReservationForPayPage({
        onOrderId: (orderId) => {
          state.orderId = orderId;
        },
        run,
        session,
        // Submit-only helper: the prefilled query already prepared the form,
        // so the script only waits for the hydrated submit control.
        submitReservationScript: submitPreparedMeetingRoomReservationScript,
        timeouts: config.timeouts,
      });
    }),
    id: "open-reservation-link-and-hold",
    timeoutMs: config.timeouts.checkoutStart,
  });

const readSignedPayUrl = (
  run: Runner,
  session: string,
  locale: LinkLocale,
  orderId: WorkspaceReservationId
): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* readBrowserUrl(run, session);
    return yield* tryWorkspaceE2ESync("assert signed pay URL", () => {
      const parsed = parseUrl(url ?? "");
      assert(
        parsed?.pathname === `/${locale}/checkout/pay`,
        "signed pay URL path mismatch"
      );
      assert(parsed?.searchParams.get("payState"), "pay state token missing");
      assert(
        parsed?.searchParams.get("orderId") === orderId,
        "signed pay URL order id mismatch"
      );
      for (const key of [
        discountCodeQueryParam,
        "duration",
        "email",
        "message",
        "name",
        "phone",
        "startDateTime",
      ]) {
        assert(
          !parsed?.searchParams.has(key),
          `signed pay URL leaked public query parameter ${key}`
        );
      }
      return parsed.toString();
    });
  });

const assertHeldReservationRow = (
  datasourceConfig: DatasourceConfig,
  orderId: WorkspaceReservationId,
  data: CheckoutData
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  waitForCheckoutRow(datasourceConfig, orderId).pipe(
    Effect.flatMap((row) =>
      tryWorkspaceE2ESync("assert held reservation-link row", () => {
        assert(row.reservation_state === "held", "reservation was not held");
        assertHeldRowHasNoPaymentOrFulfillment(row);
        assert(
          row.dotypos_reservation_id,
          "held reservation Dotypos id missing"
        );
        assert(
          row.dotypos_customer_id,
          "held reservation Dotypos customer missing"
        );
        assert(row.locale === data.locale, "held reservation locale mismatch");
        return row;
      })
    )
  );

// Initial hold enum values per the reservation repository: the hold starts
// payment and fulfillment at "not_started" with no active attempt timestamps.
const assertHeldRowHasNoPaymentOrFulfillment = (row: CheckoutRow) => {
  assert(
    row.payment_state === "not_started",
    "held reservation unexpectedly started payment"
  );
  assert(
    row.fulfillment_state === "not_started",
    "held reservation unexpectedly started fulfillment"
  );
  assert(
    row.active_payment_attempt_id === null,
    "held reservation has an active payment attempt"
  );
  assert(row.paid_at === null, "held reservation has a paid timestamp");
  assert(
    row.fulfilled_at === null,
    "held reservation has a fulfilled timestamp"
  );
};

const assertRequestedOnlyDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: CanonicalPromotionCode;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  waitForBrowserCondition(
    run,
    session,
    "requested-only discount code input",
    `
(() => {
  const form = document.querySelector('#checkout-discount-code-form');
  if (!(form instanceof HTMLFormElement)) return false;
  if (form.querySelector('output')) return false;
  const input = form.querySelector('#checkout-discount-code');
  return input instanceof HTMLInputElement && input.value === ${JSON.stringify(code)};
})()
`,
    { timeoutMs: config.timeouts.uiTransition }
  );

const appliedDiscountMessage = (locale: Locale) =>
  m.checkoutDiscountCodeApplied(
    {
      discount: formatDiscountAdjustment(
        { kind: "percentage", basisPoints: 10_000 },
        locale
      ),
    },
    { locale }
  );

// The seeded zero-total fixture label is resolved per reservation locale.
const zeroTotalDiscountLabels: Record<LinkLocale, string> = {
  "cs-CZ": "E2E sleva 100 %",
  "en-US": "E2E 100% discount",
};

const formatZeroTotalAdjustment = (locale: Locale) =>
  formatDiscountAdjustment({ kind: "percentage", basisPoints: 10_000 }, locale);

const zeroTotalMoneyText = (locale: Locale) =>
  formatWorkspaceMoney(currencyCZK(0), locale);

export const getAppliedZeroTotalPaySummaryCondition = (
  data: CheckoutData
): string => {
  const totalLabel = m.checkoutSummaryItemTotal({}, { locale: data.locale });
  const zeroTotal = zeroTotalMoneyText(data.locale);
  const appliedMessage = appliedDiscountMessage(data.locale);

  return `
(() => {
  const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
  const totalLabel = ${JSON.stringify(totalLabel)};
  const zeroTotal = ${JSON.stringify(zeroTotal)};
  // The total line renders a label span and an amount span as its only two
  // direct children, so a zero amount on any other summary line never matches.
  const totalRows = [...document.querySelectorAll('div')].filter((div) => {
    const spans = [...div.children];
    return (
      spans.length === 2 &&
      spans.every((span) => span.tagName === 'SPAN') &&
      normalize(spans[0].textContent) === normalize(totalLabel) &&
      normalize(spans[1].textContent) === normalize(zeroTotal)
    );
  });
  if (totalRows.length !== 1) return false;
  return normalize(document.body?.innerText ?? '').includes(normalize(${JSON.stringify(appliedMessage)}));
})()
`;
};

export const getDiscountListedOnceCondition = ({
  adjustmentText,
  label,
}: {
  readonly adjustmentText: string;
  readonly label: string;
}): string => `
(() => {
  const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
  const trigger = document.querySelector('[data-checkout-discount-details]');
  if (!trigger) return false;
  const descriptionId = trigger.getAttribute('aria-describedby');
  if (!descriptionId) return false;
  const content = document.getElementById(descriptionId);
  if (!content) return false;
  const items = [...content.querySelectorAll('li')];
  // Normalize the expected literals with the same function as the DOM text:
  // localized formatting such as the Czech percent keeps NBSP, so comparing
  // raw literals against normalized text silently never matches.
  const label = normalize(${JSON.stringify(label.toLocaleLowerCase())});
  const adjustment = normalize(${JSON.stringify(adjustmentText.toLocaleLowerCase())});
  const matches = items.filter((item) => {
    const text = normalize(item.textContent).toLocaleLowerCase();
    return text.includes(label) && text.includes(adjustment);
  });
  return matches.length === 1;
})()
`;

export const getSelectedDurationZeroPriceCondition = (
  data: CheckoutData
): string => {
  assert(data.meetingRoom, "reservation-link checkout interval missing");
  const durationKey = getMeetingRoomReservationDurationKey(
    data.meetingRoom.duration
  );
  const discountedPriceText = m.checkoutSummaryDiscountedPrice(
    { price: zeroTotalMoneyText(data.locale) },
    { locale: data.locale }
  );
  const zeroTotal = zeroTotalMoneyText(data.locale);

  return `
(() => {
  const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
  const discountedText = ${JSON.stringify(discountedPriceText)};
  const zeroTotal = ${JSON.stringify(zeroTotal)};
  const option = document.querySelector('[data-reservation-type-option="${durationKey}"]');
  if (!(option instanceof HTMLElement)) return false;
  // Semantic discounted-price text plus the visible current amount must both
  // carry the exact zero; a positive original amount never matches.
  const discounted = [...option.querySelectorAll('span')].filter(
    (span) => normalize(span.textContent) === normalize(discountedText)
  );
  if (discounted.length !== 1) return false;
  const current = option.querySelector(
    'span.text-aquamarine-ink > span[aria-hidden="true"]'
  );
  return (
    current instanceof HTMLSpanElement &&
    normalize(current.textContent) === normalize(zeroTotal)
  );
})()
`;
};

const assertAppliedZeroTotalPaySummary = ({
  config,
  data,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* waitForBrowserCondition(
      run,
      session,
      "applied zero-total reservation-link pay summary",
      getAppliedZeroTotalPaySummaryCondition(data),
      { timeoutMs: config.timeouts.uiTransition }
    );
    // Open the existing discount details tooltip and require the fixture
    // discount exactly once; automatic discounts may coexist.
    const triggerSelector = "[data-checkout-discount-details]";
    yield* waitForBrowserReactHandler(
      run,
      session,
      triggerSelector,
      "onFocus",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* scrollBrowserElementIntoView(run, session, triggerSelector, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* focusBrowserElement(run, session, triggerSelector, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForBrowserCondition(
      run,
      session,
      "zero-total discount listed exactly once",
      getDiscountListedOnceCondition({
        adjustmentText: formatZeroTotalAdjustment(data.locale),
        label: zeroTotalDiscountLabels[data.locale],
      }),
      { timeoutMs: config.timeouts.uiTransition }
    );
  });

const returnToReservationWithConflictingQuery = ({
  config,
  data,
  locale,
  replacementData,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly locale: LinkLocale;
  readonly replacementData: CheckoutData;
  readonly run: Runner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const reservationPath = `/${locale}/reservation/meeting-room`;
    yield* activateHydratedBrowserElement(
      run,
      session,
      `a[href^="${reservationPath}?payState="]`,
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* waitForBrowserUrl({
      description: "restored reservation page",
      matches: (value) => {
        const url = parseUrl(value);
        return (
          url?.pathname === reservationPath && url.searchParams.has("payState")
        );
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    const restoredHref = yield* readBrowserUrl(run, session);
    const conflictingUrl = yield* tryWorkspaceE2ESync(
      "build conflicting public query URL",
      () => {
        assert(data.meetingRoom, "original reservation interval missing");
        assert(replacementData.meetingRoom, "replacement interval missing");
        const url = parseUrl(restoredHref ?? "");
        assert(url, "restored reservation URL missing");
        url.searchParams.set(discountCodeQueryParam, unknownLinkCode);
        url.searchParams.set("duration", "hour:4");
        url.searchParams.set("email", "conflicting-link@example.test");
        url.searchParams.set("message", "Conflicting public link query");
        url.searchParams.set("name", "Conflicting Link Name");
        url.searchParams.set("phone", "+420999999999");
        // A valid different start so the conflict is itself submittable and
        // cannot be rejected as an invalid date before signed values win.
        url.searchParams.set(
          "startDateTime",
          replacementData.meetingRoom.startDateTime
        );
        return url.href;
      }
    );
    yield* openBrowserPage(config, run, session, conflictingUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserCondition(
      run,
      session,
      "signed reservation values win over conflicting public query",
      getPrefilledReservationConditionScript(data),
      { timeoutMs: config.timeouts.uiTransition }
    );
    // The signed original code keeps the advertisement discounted before any
    // deliberate edit; the later replacement submit changes the start itself.
    yield* waitForBrowserCondition(
      run,
      session,
      "restored edit keeps the signed zero-price advertisement",
      getSelectedDurationZeroPriceCondition(data),
      { timeoutMs: config.timeouts.uiTransition }
    );
  });

const assertSupersededLinkHold = ({
  datasourceConfig,
  firstOrderId,
  secondOrderId,
  secondRow,
}: {
  readonly datasourceConfig: DatasourceConfig;
  readonly firstOrderId: WorkspaceReservationId;
  readonly secondOrderId: WorkspaceReservationId;
  readonly secondRow: CheckoutRow;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const firstRow = yield* readCheckoutRow(firstOrderId).pipe(
      Effect.flatMap((row) =>
        tryWorkspaceE2ESync("read superseded reservation-link row", () => {
          assert(row, "superseded reservation-link row missing");
          return row;
        })
      )
    );
    const firstDotyposId = yield* tryWorkspaceE2ESync(
      "read superseded Dotypos id",
      () => {
        assert(
          firstRow.dotypos_reservation_id,
          "superseded Dotypos id missing"
        );
        return firstRow.dotypos_reservation_id;
      }
    );
    const secondDotyposId = yield* tryWorkspaceE2ESync(
      "read replacement Dotypos id",
      () => {
        assert(
          secondRow.dotypos_reservation_id,
          "replacement Dotypos id missing"
        );
        return secondRow.dotypos_reservation_id;
      }
    );
    const firstDotyposStatus = yield* readDotyposReservationStatus(
      datasourceConfig,
      firstDotyposId
    );
    const secondDotyposStatus = yield* readDotyposReservationStatus(
      datasourceConfig,
      secondDotyposId
    );
    yield* tryWorkspaceE2ESync("assert reservation-link hold replaced", () => {
      assert(
        secondOrderId !== firstOrderId,
        "resubmission reused the order id"
      );
      assert(
        firstRow.reservation_state === "cancelled",
        "superseded reservation-link hold was not cancelled"
      );
      assertHeldRowHasNoPaymentOrFulfillment(firstRow);
      assert(
        firstDotyposStatus === "CANCELLED",
        "superseded Dotypos hold was not cancelled"
      );
      assert(
        secondDotyposStatus === "NEW",
        "replacement Dotypos hold is not pending"
      );
    });
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};
