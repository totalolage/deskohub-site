import type { DotyposDiscountGroupId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountCodeId } from "@/features/discounts/persistence-contracts";
import { discountCodeQueryParam } from "@/features/discounts/promotion-code";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  assertPageCheck,
  openPage,
  readPageUrl,
  scrollIntoView,
  waitForPageCondition,
  waitForPageTextContent,
  waitForReactHandler,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import { workspaceE2EMaximumSameDateCoworkReservations } from "../capacity";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../case-runner";
import {
  loadAvailableCoworkDates,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  reuseCoworkCheckoutContact,
  selectCoworkDates,
} from "../checkout/data";
import {
  applyDiscountCode,
  applyUnavailableDiscountCode,
} from "../checkout/discount-code";
import {
  submitCheckoutPayment,
  submitReservationForPayPage,
} from "../checkout/payment";
import {
  preparedReservationForm,
  prepareReservationForm,
  toReservationSelectionPreparation,
  toReservationStep,
} from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import type { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import {
  isWorkspaceE2ETimeout,
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  withoutWorkspaceE2ETimeout,
} from "../errors";
import {
  assertNoDiscountPaymentState,
  type ExpectedDiscountApplication,
  validateVoucherRedemptions,
  waitForCheckoutRow,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  discountCodeFixtures,
  expireDiscountCodeForE2E,
  setE2ECalendarSaleReservedDeskEligibility,
} from "../integrations/discount-fixtures";
import {
  changeDotyposCustomerDiscount,
  type E2EDotyposDiscountGroup,
  prepareDotyposCustomerDiscount,
} from "../integrations/dotypos";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { addRedaction, assert, browserSessionFor, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { makeUrl, setSearchParams } from "../urls";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";

const calendarSaleLabel = "E2E Calendar sale";
const codeDiscountLabel = "E2E promo code";
const customerDiscountLabel = "Customer discount";
const unavailableCodeScenarios = [
  { code: "E2E_UNKNOWN", id: "unknown" },
  {
    code: discountCodeFixtures.customerIneligible.code,
    id: "customer-ineligible",
  },
] as const;

export type DiscountE2EPreparation = {
  readonly availableBasicDates: readonly string[];
  readonly availablePlusDates: readonly string[];
  readonly availableReservedDeskDates: readonly string[];
  readonly customerDiscountGroup: E2EDotyposDiscountGroup;
};

export type DiscountAvailabilityE2EPreparation = Omit<
  DiscountE2EPreparation,
  "customerDiscountGroup"
>;

export const prepareDiscountAvailabilityE2E = (
  config: WorkspaceE2EConfig,
  allocation: WorkspaceE2EDateAllocation
): Effect.Effect<
  DiscountAvailabilityE2EPreparation,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.all(
    {
      availableBasicDates: loadAvailableCoworkDates(config, { allocation }),
      availablePlusDates: loadAvailableCoworkDates(config, {
        allocation,
        entryTier: "open-space",
      }),
      availableReservedDeskDates: loadAvailableCoworkDates(config, {
        allocation,
        entryTier: "reserved-desk",
      }),
    },
    { concurrency: "unbounded" }
  );

export const makeDiscountE2ECases = ({
  config,
  datasourceConfig,
  excludedDates,
  flowStates,
  allocation,
  preparation,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly excludedDates: ReadonlySet<string>;
  readonly flowStates: CheckoutFlowState[];
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly preparation: DiscountE2EPreparation;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const { customerDiscountGroup } = preparation;
    const customerDiscountExpectation = makeCustomerDiscountExpectation(
      customerDiscountGroup.basisPoints
    );
    const coworkAutomaticDiscounts = [calendarDiscountExpectation] as const;
    const checkoutDates = yield* selectCoworkDates(
      preparation.availableBasicDates,
      unavailableCodeScenarios.length + 11,
      {
        allocation,
        excludedDates,
        maximumReservationsPerDate:
          workspaceE2EMaximumSameDateCoworkReservations["open-space"],
        selectionLabel: "open-space",
      }
    );
    const calendarCheckoutDates = yield* selectCoworkDates(
      preparation.availablePlusDates,
      2,
      {
        allocation,
        excludedDates: new Set([...excludedDates, ...checkoutDates]),
        selectionLabel: "open-space (calendar sale)",
      }
    );
    const transientCalendarDates = yield* selectCoworkDates(
      preparation.availableReservedDeskDates,
      2,
      {
        allocation,
        excludedDates: new Set([
          ...excludedDates,
          ...checkoutDates,
          ...calendarCheckoutDates,
        ]),
        selectionLabel: "reserved-desk",
      }
    );
    const cases: WorkspaceE2ECase[] = [];
    let nextDateIndex = 0;

    const code = discountCodeFixtures.partial.code;
    addRedaction(code, true);
    const baseCodeCheckoutData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-discount-code"
    );
    const codeCheckoutUrl = yield* makeUrl(
      "build query discount checkout URL",
      baseCodeCheckoutData.checkoutUrl
    ).pipe(
      Effect.flatMap((url) =>
        setSearchParams(url, { [discountCodeQueryParam]: code })
      )
    );
    const codeCheckoutData = {
      ...baseCodeCheckoutData,
      checkoutUrl: codeCheckoutUrl.href,
    };
    nextDateIndex += 1;
    const codeCheckoutState = trackCheckoutState(flowStates, codeCheckoutData);
    cases.push({
      checkoutStates: [codeCheckoutState],
      execute: ({ run, runStep, session }) =>
        executeDiscountCheckout({
          config,
          data: codeCheckoutData,
          datasourceConfig,
          expectedDiscounts: [
            ...coworkAutomaticDiscounts,
            codeDiscountExpectation,
          ],
          flowId: "cowork-discount-code",
          reservationPageDiscounts: [
            ...coworkAutomaticDiscounts,
            codeDiscountExpectation,
          ],
          run,
          runStep,
          session,
          state: codeCheckoutState,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run discount-code checkout e2e case", cause)
          )
        ),
      id: "checkout-discount-code",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const expiringCodeData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-code-expires-before-payment"
    );
    nextDateIndex += 1;
    const expiringCodeState = trackCheckoutState(flowStates, expiringCodeData);
    cases.push({
      checkoutStates: [expiringCodeState],
      execute: ({ run, runStep, session }) =>
        executeDiscountCodeExpiresBeforePayment({
          code: discountCodeFixtures.expiresBeforePayment.code,
          codeId: discountCodeFixtures.expiresBeforePayment.id,
          config,
          data: expiringCodeData,
          run,
          runStep,
          session,
          state: expiringCodeState,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run expiring discount-code e2e case", cause)
          )
        ),
      id: "discount-code-expires-before-payment",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const calendarCheckoutData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(calendarCheckoutDates, 0),
      "cowork-calendar-sale",
      { entryTier: "open-space" }
    );
    const calendarCheckoutState = trackCheckoutState(
      flowStates,
      calendarCheckoutData
    );
    cases.push({
      checkoutStates: [calendarCheckoutState],
      execute: ({ run, runStep, session }) =>
        executeDiscountCheckout({
          config,
          data: calendarCheckoutData,
          datasourceConfig,
          expectedDiscounts: coworkAutomaticDiscounts,
          flowId: "cowork-calendar-sale",
          run,
          runStep,
          session,
          state: calendarCheckoutState,
          // The least loaded payment lane carries the product-independent
          // post-fulfillment paths for every paid case.
          verifyPostFulfillmentPaths: true,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run Calendar sale checkout e2e case", cause)
          )
        ),
      id: "checkout-calendar-sale",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const quoteChangeData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(transientCalendarDates, 0),
      "cowork-calendar-disappears-before-quote",
      { entryTier: "reserved-desk" }
    );
    const quoteChangeState = trackCheckoutState(flowStates, quoteChangeData);
    const paymentChangeData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(transientCalendarDates, 1),
      "cowork-calendar-disappears-before-payment",
      { entryTier: "reserved-desk" }
    );
    const paymentChangeState = trackCheckoutState(
      flowStates,
      paymentChangeData
    );
    cases.push({
      checkoutStates: [quoteChangeState, paymentChangeState],
      execute: ({ run, runStep, session }) =>
        withE2ECalendarSaleReservedDeskEligibility(
          executeCalendarSalePricingChanges({
            config,
            paymentChangeData,
            paymentChangeState,
            quoteChangeData,
            quoteChangeState,
            run,
            runStep,
            session,
          })
        ).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError(
              "run Calendar pricing-change checkout e2e case",
              cause
            )
          )
        ),
      id: "calendar-sale-pricing-changes",
      timeoutMs: config.timeouts.checkoutCase * 2,
    });

    const customerScenarios = [
      {
        data: makeCoworkCheckoutData(
          config.baseUrl,
          yield* requireCheckoutDate(calendarCheckoutDates, 1),
          "cowork-all-discounts",
          { entryTier: "open-space" }
        ),
        discountCode: discountCodeFixtures.partial.code,
        expectedDiscounts: [
          ...coworkAutomaticDiscounts,
          customerDiscountExpectation,
          codeDiscountExpectation,
        ],
        id: "all-discounts",
      },
    ] as const;

    for (const scenario of customerScenarios) {
      const state = trackCheckoutState(flowStates, scenario.data);
      cases.push({
        checkoutStates: [state],
        execute: ({ run, runStep, session }) =>
          Effect.gen(function* () {
            yield* runStep({
              execute: prepareDotyposCustomerDiscount(
                datasourceConfig,
                scenario.data,
                customerDiscountGroup.id
              ),
              id: "prepare-customer-discount",
              timeoutMs: config.timeouts.datasource,
            });
            yield* executeDiscountCheckout({
              config,
              data: scenario.data,
              datasourceConfig,
              discountCode:
                "discountCode" in scenario ? scenario.discountCode : undefined,
              expectedDiscounts: scenario.expectedDiscounts,
              flowId: `cowork-${scenario.id}`,
              run,
              runStep,
              session,
              state,
            });
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError((cause) =>
              toWorkspaceE2EError(`run ${scenario.id} checkout e2e case`, cause)
            )
          ),
        id: `checkout-${scenario.id}`,
        timeoutMs: config.timeouts.checkoutCase,
      });
    }

    const changingCustomerDiscountData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-customer-discount-changes-before-payment"
    );
    nextDateIndex += 1;
    const changingCustomerDiscountState = trackCheckoutState(
      flowStates,
      changingCustomerDiscountData
    );
    cases.push({
      checkoutStates: [changingCustomerDiscountState],
      execute: ({ run, runStep, session }) =>
        executeCustomerDiscountChangesBeforePayment({
          config,
          customerDiscount: customerDiscountExpectation,
          data: changingCustomerDiscountData,
          datasourceConfig,
          discountGroupId: customerDiscountGroup.id,
          run,
          runStep,
          session,
          state: changingCustomerDiscountState,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError(
              "run changing customer-discount e2e case",
              cause
            )
          )
        ),
      id: "customer-discount-changes-before-payment",
      timeoutMs: config.timeouts.checkoutCase,
    });

    for (const scenario of unavailableCodeScenarios) {
      const data = makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(checkoutDates, nextDateIndex),
        `cowork-code-${scenario.id}`
      );
      nextDateIndex += 1;
      const state = trackCheckoutState(flowStates, data);
      cases.push({
        checkoutStates: [state],
        execute: ({ run, runStep, session }) =>
          executeUnavailableDiscountCode({
            code: scenario.code,
            config,
            data,
            run,
            runStep,
            session,
            state,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                `run ${scenario.id} discount-code e2e case`,
                cause
              )
            )
          ),
        id: `discount-code-${scenario.id}`,
        timeoutMs: config.timeouts.checkoutCase,
      });
    }

    const capacityOwnerData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-code-capacity-owner"
    );
    nextDateIndex += 1;
    const capacityContenderData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-code-capacity-contender"
    );
    nextDateIndex += 1;
    const capacityOwnerState = trackCheckoutState(
      flowStates,
      capacityOwnerData
    );
    const capacityContenderState = trackCheckoutState(
      flowStates,
      capacityContenderData
    );
    cases.push({
      checkoutStates: [capacityOwnerState, capacityContenderState],
      execute: ({ run, runStep, session }) =>
        executeConsumedDiscountCode({
          code: discountCodeFixtures.capacityOne.code,
          config,
          contenderData: capacityContenderData,
          contenderState: capacityContenderState,
          datasourceConfig,
          ownerData: capacityOwnerData,
          ownerState: capacityOwnerState,
          run,
          runStep,
          session,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run exhausted-capacity code e2e case", cause)
          )
        ),
      id: "discount-code-capacity-reached",
      timeoutMs:
        config.timeouts.zeroTotalCheckoutCase + config.timeouts.checkoutCase,
    });

    const redemptionOwnerData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-code-redemption-owner"
    );
    nextDateIndex += 1;
    const redemptionContenderData = reuseCoworkCheckoutContact(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      redemptionOwnerData
    );
    nextDateIndex += 1;
    const redemptionOwnerState = trackCheckoutState(
      flowStates,
      redemptionOwnerData
    );
    const redemptionContenderState = trackCheckoutState(
      flowStates,
      redemptionContenderData
    );
    cases.push({
      checkoutStates: [redemptionOwnerState, redemptionContenderState],
      execute: ({ run, runStep, session }) =>
        executeConsumedDiscountCode({
          code: discountCodeFixtures.onePerCustomer.code,
          config,
          contenderData: redemptionContenderData,
          contenderState: redemptionContenderState,
          datasourceConfig,
          ownerData: redemptionOwnerData,
          ownerState: redemptionOwnerState,
          run,
          runStep,
          session,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run already-redeemed code e2e case", cause)
          )
        ),
      id: "discount-code-already-redeemed",
      timeoutMs:
        config.timeouts.zeroTotalCheckoutCase + config.timeouts.checkoutCase,
    });

    const voucherFullData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-voucher-full-usage"
    );
    nextDateIndex += 1;
    const voucherFullState = trackCheckoutState(flowStates, voucherFullData);
    cases.push({
      checkoutStates: [voucherFullState],
      execute: ({ run, runStep, session }) =>
        executeFullyConsumedVoucherCheckout({
          automaticDiscounts: coworkAutomaticDiscounts,
          config,
          data: voucherFullData,
          datasourceConfig,
          run,
          runStep,
          session,
          state: voucherFullState,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run full voucher usage e2e case", cause)
          )
        ),
      id: "checkout-voucher-full-usage",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const voucherOwnerData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-voucher-first-redemption"
    );
    nextDateIndex += 1;
    const voucherReuseData = reuseCoworkCheckoutContact(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      voucherOwnerData
    );
    nextDateIndex += 1;
    const voucherExhaustedData = reuseCoworkCheckoutContact(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      voucherOwnerData
    );
    nextDateIndex += 1;
    const voucherOwnerState = trackCheckoutState(flowStates, voucherOwnerData);
    const voucherReuseState = trackCheckoutState(flowStates, voucherReuseData);
    const voucherExhaustedState = trackCheckoutState(
      flowStates,
      voucherExhaustedData
    );
    cases.push({
      checkoutStates: [
        voucherOwnerState,
        voucherReuseState,
        voucherExhaustedState,
      ],
      execute: ({ run, runStep, session }) =>
        executeVoucherReuse({
          config,
          datasourceConfig,
          exhaustedData: voucherExhaustedData,
          exhaustedState: voucherExhaustedState,
          ownerData: voucherOwnerData,
          ownerState: voucherOwnerState,
          reuseData: voucherReuseData,
          reuseState: voucherReuseState,
          run,
          runStep,
          session,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run reusable voucher e2e case", cause)
          )
        ),
      id: "voucher-reuse-and-exhaustion",
      timeoutMs: config.timeouts.checkoutCase * 2,
    });

    return cases;
  });

// Calendar discovery is a remote cache entry keyed by the purchase date, and
// direct fixture writes bypass the admin mutation's tag revalidation. Once an
// ineligible window has been served, a restored sale can stay hidden until the
// advertisedPricingSources revalidation runs, so this case advertises every
// checkout before its single eligibility removal and never waits for a restore.
// The poll remains a safety net for a stale entry left by an earlier run.
// The step budget leaves room for the poll's own attempt-count timeout to report.
const calendarSaleAdvertisementStepTimeoutMs = (config: WorkspaceE2EConfig) =>
  config.timeouts.calendarSaleAdvertisement + config.timeouts.browserAction;

/**
 * Loads the reservation form and prepares its selection until its discount
 * details show the Calendar sale. Only an attempt whose discount
 * check times out is retried; any other failure ends the wait.
 */
export const waitForAdvertisedCalendarSale = ({
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
  pollUntil(
    Effect.gen(function* () {
      const browser = yield* browserSessionFor(run, session);
      yield* openPage(browser, config, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      });
      // The in-page waits fail with plain errors, so an overrun of the
      // evaluation stays a failure, as the argv evaluation's was.
      yield* browser
        .evaluate(
          "prepare advertised Calendar sale",
          prepareReservationForm,
          { preparation: toReservationSelectionPreparation(data) },
          { timeoutMs: config.timeouts.checkoutStart }
        )
        .pipe(withoutWorkspaceE2ETimeout("prepare advertised Calendar sale"));
      return yield* assertDisplayedDiscounts({
        config,
        discounts: [calendarDiscountExpectation],
        session: browser,
        timeoutMs: config.timeouts.calendarSaleAdvertisementAttempt,
      }).pipe(
        Effect.as(true),
        Effect.catchIf(isWorkspaceE2ETimeout, () => Effect.void)
      );
    }),
    {
      intervalMs: workspaceE2EPollIntervalMs.advertisedPricing,
      label: "advertised Calendar sale",
      timeoutMs: config.timeouts.calendarSaleAdvertisement,
    }
  ).pipe(Effect.asVoid);

const executeCalendarSalePricingChanges = ({
  config,
  paymentChangeData,
  paymentChangeState,
  quoteChangeData,
  quoteChangeState,
  run,
  runStep,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly paymentChangeData: CheckoutData;
  readonly paymentChangeState: CheckoutFlowState;
  readonly quoteChangeData: CheckoutData;
  readonly quoteChangeState: CheckoutFlowState;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    paymentChangeState.startedAt = new Date();
    yield* runStep({
      execute: waitForAdvertisedCalendarSale({
        config,
        data: paymentChangeData,
        run,
        session,
      }),
      id: "advertise-calendar-sale",
      timeoutMs: calendarSaleAdvertisementStepTimeoutMs(config),
    });
    const { orderId: paymentChangeOrderId, payPageUrl } = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        const orderId = yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            paymentChangeState.orderId = startedOrderId;
          },
          preparation: preparedReservationForm,
          session: browser,
          timeouts: config.timeouts,
        });
        const url = yield* readPageUrl(browser);
        return yield* tryWorkspaceE2ESync("read Calendar pay page URL", () => {
          assert(url, "Calendar pay page URL missing");
          return { orderId, payPageUrl: url };
        });
      }),
      id: "prepare-calendar-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    paymentChangeState.orderId = paymentChangeOrderId;
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* assertDisplayedDiscounts({
          config,
          discounts: [calendarDiscountExpectation],
          session: browser,
        });
      }),
      id: "assert-calendar-pay-page-discount",
      timeoutMs: config.timeouts.uiTransition,
    });

    quoteChangeState.startedAt = new Date();
    yield* runStep({
      execute: waitForAdvertisedCalendarSale({
        config,
        data: quoteChangeData,
        run,
        session,
      }),
      id: "advertise-calendar-sale-before-quote",
      timeoutMs: calendarSaleAdvertisementStepTimeoutMs(config),
    });
    yield* runStep({
      execute: setE2ECalendarSaleReservedDeskEligibility(false),
      id: "remove-calendar-sale-eligibility",
      timeoutMs: config.timeouts.datasource,
    });

    const quoteChangeOrderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        const orderId = yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            quoteChangeState.orderId = startedOrderId;
          },
          preparation: preparedReservationForm,
          session: browser,
          timeouts: config.timeouts,
        });
        yield* waitForPricingChanged(config, browser);
        return orderId;
      }),
      id: "assert-calendar-quote-pricing-change",
      timeoutMs: config.timeouts.checkoutStart,
    });
    quoteChangeState.orderId = quoteChangeOrderId;
    yield* runStep({
      execute: assertNoDiscountPaymentState(quoteChangeOrderId),
      id: "assert-calendar-quote-change-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`Calendar quote-change e2e passed for order ${quoteChangeOrderId}`);

    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* openPage(browser, config, payPageUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        yield* assertDisplayedDiscounts({
          config,
          discounts: [calendarDiscountExpectation],
          session: browser,
        });
      }),
      id: "reopen-calendar-pay-page",
      timeoutMs:
        config.timeouts.browserNavigation + config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* submitCheckoutPaymentAndWaitForPricingChanged(config, browser);
      }),
      id: "assert-calendar-payment-pricing-change",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(paymentChangeOrderId),
      id: "assert-calendar-payment-change-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`Calendar payment-change e2e passed for order ${paymentChangeOrderId}`);
  });

const executeCustomerDiscountChangesBeforePayment = ({
  config,
  customerDiscount,
  data,
  datasourceConfig,
  discountGroupId,
  run,
  runStep,
  session,
  state,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly customerDiscount: ExpectedDiscountApplication;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly discountGroupId: DotyposDiscountGroupId;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: prepareDotyposCustomerDiscount(
        datasourceConfig,
        data,
        discountGroupId
      ),
      id: "prepare-changing-customer-discount",
      timeoutMs: config.timeouts.datasource,
    });
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* openPage(browser, config, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation: toReservationStep(data),
          session: browser,
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-changing-customer-discount-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    const browser = yield* browserSessionFor(run, session);
    yield* assertDisplayedDiscounts({
      config,
      discounts: [customerDiscount],
      session: browser,
    });
    const customerId = yield* runStep({
      execute: waitForCheckoutRow(datasourceConfig, orderId).pipe(
        Effect.flatMap((row) =>
          tryWorkspaceE2ESync("assert changing-discount customer ID", () => {
            assert(row.dotypos_customer_id, "Dotypos customer ID missing");
            return row.dotypos_customer_id;
          })
        )
      ),
      id: "read-changing-discount-customer",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: changeDotyposCustomerDiscount(
        datasourceConfig,
        customerId,
        null
      ),
      id: "remove-customer-discount-before-payment",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* submitCheckoutPaymentAndWaitForPricingChanged(config, browser);
      }),
      id: "assert-customer-discount-pricing-change",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-changed-customer-discount-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`changed-before-payment customer discount passed for order ${orderId}`);
  });

const withE2ECalendarSaleReservedDeskEligibility = <A>(
  effect: Effect.Effect<A, WorkspaceE2EError, E2EDatabase>
): Effect.Effect<A, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* setE2ECalendarSaleReservedDeskEligibility(true);
    return yield* effect;
  }).pipe(
    Effect.ensuring(
      setE2ECalendarSaleReservedDeskEligibility(true).pipe(Effect.orDie)
    )
  );

const executeConsumedDiscountCode = ({
  code,
  config,
  contenderData,
  contenderState,
  datasourceConfig,
  ownerData,
  ownerState,
  run,
  runStep,
  session,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly contenderData: CheckoutData;
  readonly contenderState: CheckoutFlowState;
  readonly datasourceConfig: DatasourceConfig;
  readonly ownerData: CheckoutData;
  readonly ownerState: CheckoutFlowState;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* executeZeroTotalCheckout({
      config,
      data: ownerData,
      datasourceConfig,
      discountCode: code,
      run,
      runStep,
      session,
      state: ownerState,
      preparation: toReservationStep(ownerData),
    });
    yield* executeUnavailableDiscountCode({
      code,
      config,
      data: contenderData,
      run,
      runStep,
      session,
      state: contenderState,
    });
  });

const executeVoucherReuse = ({
  config,
  datasourceConfig,
  exhaustedData,
  exhaustedState,
  ownerData,
  ownerState,
  reuseData,
  reuseState,
  run,
  runStep,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly exhaustedData: CheckoutData;
  readonly exhaustedState: CheckoutFlowState;
  readonly ownerData: CheckoutData;
  readonly ownerState: CheckoutFlowState;
  readonly reuseData: CheckoutData;
  readonly reuseState: CheckoutFlowState;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const fixture = discountCodeFixtures.voucherReuse;
    yield* executeZeroTotalCheckout({
      appliedMessage: "Promotion applied:",
      config,
      data: ownerData,
      datasourceConfig,
      discountCode: fixture.code,
      run,
      runStep,
      session,
      state: ownerState,
      stepIdPrefix: "first-voucher-",
      preparation: toReservationStep(ownerData),
    });
    yield* executeZeroTotalCheckout({
      appliedMessage: "Promotion applied:",
      config,
      data: reuseData,
      datasourceConfig,
      discountCode: fixture.code,
      run,
      runStep,
      session,
      state: reuseState,
      stepIdPrefix: "reused-voucher-",
      preparation: toReservationStep(reuseData),
    });
    const orderIds = yield* tryWorkspaceE2ESync(
      "read voucher checkout order IDs",
      () => {
        assert(ownerState.orderId, "first voucher checkout order ID missing");
        assert(reuseState.orderId, "reused voucher checkout order ID missing");
        return [ownerState.orderId, reuseState.orderId] as const;
      }
    );
    yield* runStep({
      execute: validateVoucherRedemptions(
        datasourceConfig,
        fixture.id,
        [
          {
            adjustmentValue: fixture.creditPerRun.value,
            appliedValue: fixture.creditPerRun.value / 2,
            orderId: orderIds[0],
            subtotalAfter: "zero",
          },
          {
            adjustmentValue: fixture.creditPerRun.value / 2,
            appliedValue: fixture.creditPerRun.value / 2,
            orderId: orderIds[1],
            subtotalAfter: "zero",
          },
        ],
        fixture.creditPerRun
      ),
      id: "validate-voucher-redemptions",
      timeoutMs: config.timeouts.datasource,
    });
    yield* executeUnavailableDiscountCode({
      code: fixture.code,
      config,
      data: exhaustedData,
      run,
      runStep,
      session,
      state: exhaustedState,
    });
  });

const executeFullyConsumedVoucherCheckout = ({
  automaticDiscounts,
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
}: {
  readonly automaticDiscounts: readonly ExpectedDiscountApplication[];
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  | E2EDatabase
  | HttpClient.HttpClient
  | WorkspaceE2EHostedPaymentPermitService
  | WorkspaceE2EProviderVerificationPermitService
> =>
  Effect.gen(function* () {
    const fixture = discountCodeFixtures.voucherFull;
    yield* executeDiscountCheckout({
      appliedMessage: "Promotion applied:",
      config,
      data,
      datasourceConfig,
      discountCode: fixture.code,
      expectedDiscounts: [
        ...automaticDiscounts,
        {
          adjustment: { kind: "fixed", amount: fixture.creditPerRun },
          label: "Voucher",
          redemptionState: "redeemed",
        },
      ],
      flowId: "cowork-voucher-full-usage",
      run,
      runStep,
      session,
      state,
    });
    const orderId = yield* tryWorkspaceE2ESync(
      "read full voucher checkout order ID",
      () => {
        assert(state.orderId, "full voucher checkout order ID missing");
        return state.orderId;
      }
    );
    yield* runStep({
      execute: validateVoucherRedemptions(
        datasourceConfig,
        fixture.id,
        [
          {
            adjustmentValue: fixture.creditPerRun.value,
            appliedValue: fixture.creditPerRun.value,
            orderId,
            subtotalAfter: "positive",
          },
        ],
        fixture.creditPerRun
      ),
      id: "validate-full-voucher-redemption",
      timeoutMs: config.timeouts.datasource,
    });
  });

const executeDiscountCheckout = ({
  appliedMessage = "Promotion applied: 10% off 🎉",
  config,
  data,
  datasourceConfig,
  discountCode,
  expectedDiscounts,
  flowId,
  reservationPageDiscounts,
  run,
  runStep,
  session,
  state,
  verifyPostFulfillmentPaths,
}: {
  readonly appliedMessage?: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly discountCode?: string;
  readonly expectedDiscounts: readonly ExpectedDiscountApplication[];
  readonly flowId: string;
  readonly reservationPageDiscounts?: readonly ExpectedDiscountApplication[];
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly verifyPostFulfillmentPaths?: boolean;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  | E2EDatabase
  | HttpClient.HttpClient
  | WorkspaceE2EHostedPaymentPermitService
  | WorkspaceE2EProviderVerificationPermitService
> =>
  executeCheckoutFlow({
    beforeReservationSubmit: reservationPageDiscounts
      ? Effect.gen(function* () {
          const browser = yield* browserSessionFor(run, session);
          yield* assertDisplayedDiscounts({
            config,
            discounts: reservationPageDiscounts,
            session: browser,
          });
        })
      : undefined,
    config,
    data,
    datasourceConfig,
    expectedDiscounts,
    flow: discountCheckoutFlow(flowId),
    payPageSteps: () => {
      const automaticDiscounts = discountCode
        ? expectedDiscounts.slice(0, -1)
        : expectedDiscounts;
      const steps: WorkspaceE2EStep<void>[] = [];
      if (automaticDiscounts.length > 0) {
        steps.push({
          execute: Effect.gen(function* () {
            const browser = yield* browserSessionFor(run, session);
            yield* assertDisplayedDiscounts({
              config,
              discounts: automaticDiscounts,
              session: browser,
            });
          }),
          id: "assert-automatic-checkout-discounts",
          timeoutMs: config.timeouts.uiTransition,
        });
      }
      if (discountCode) {
        steps.push({
          execute: Effect.gen(function* () {
            const browser = yield* browserSessionFor(run, session);
            yield* applyDiscountCode({
              appliedMessage,
              code: discountCode,
              config,
              session: browser,
            });
          }),
          id: "apply-checkout-discount-code",
          timeoutMs: config.timeouts.uiTransition,
        });
      }
      steps.push({
        execute: Effect.gen(function* () {
          const browser = yield* browserSessionFor(run, session);
          yield* assertDisplayedDiscounts({
            config,
            discounts: expectedDiscounts,
            session: browser,
          });
        }),
        id: "assert-final-checkout-discounts",
        timeoutMs: config.timeouts.uiTransition,
      });
      return steps;
    },
    run,
    runStep,
    session,
    state,
    verifyPostFulfillmentPaths,
  });

const executeUnavailableDiscountCode = ({
  code,
  config,
  data,
  run,
  runStep,
  session,
  state,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* openPage(browser, config, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation: toReservationStep(data),
          session: browser,
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-unavailable-code-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* applyUnavailableDiscountCode({ code, config, session: browser });
        yield* assertPageCheck(
          browser,
          "assert existing summary remains payable",
          findUnpayableSummaryProblem,
          undefined,
          { timeoutMs: config.timeouts.uiTransition }
        );
      }),
      id: "submit-unavailable-discount-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-unavailable-code-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`unavailable discount code e2e passed for order ${orderId}`);
  });

const executeDiscountCodeExpiresBeforePayment = ({
  code,
  codeId,
  config,
  data,
  run,
  runStep,
  session,
  state,
}: {
  readonly code: string;
  readonly codeId: DiscountCodeId;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* openPage(browser, config, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation: toReservationStep(data),
          session: browser,
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-expiring-code-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* applyDiscountCode({
          appliedMessage: "Promotion applied: 10% off 🎉",
          code,
          config,
          session: browser,
        });
      }),
      id: "apply-code-before-expiration",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: expireDiscountCodeForE2E(codeId),
      id: "expire-code-before-payment",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        yield* submitCheckoutPaymentAndWaitForPricingChanged(config, browser);
      }),
      id: "assert-expired-code-pricing-change",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-expired-code-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`expired-before-payment code e2e passed for order ${orderId}`);
  });

export const calendarDiscountExpectation = {
  adjustment: { kind: "percentage", basisPoints: 2000 },
  hasExpiration: true,
  label: calendarSaleLabel,
} as const satisfies ExpectedDiscountApplication;

const codeDiscountExpectation = {
  adjustment: { kind: "percentage", basisPoints: 1000 },
  label: codeDiscountLabel,
  redemptionState: "redeemed",
} as const satisfies ExpectedDiscountApplication;

const makeCustomerDiscountExpectation = (
  basisPoints: number
): ExpectedDiscountApplication => ({
  adjustment: { kind: "percentage", basisPoints },
  label: customerDiscountLabel,
});

const discountCheckoutFlow = (id: string) => ({
  id,
  toReservationPreparation: toReservationStep,
});

/**
 * Asserts each discount through the pay page's discount tooltip.
 */
export const assertDisplayedDiscounts = ({
  config,
  discounts,
  session,
  timeoutMs = config.timeouts.uiTransition,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly discounts: readonly ExpectedDiscountApplication[];
  readonly session: E2EBrowserSession;
  readonly timeoutMs?: number;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.suspend(() => {
    let stage:
      | "react-handler"
      | "scroll-trigger"
      | "blur-trigger"
      | "focus-trigger"
      | "detail" = "react-handler";
    let detailIndex = 0;
    let currentDetail: DiscountDetail | undefined;
    return Effect.gen(function* () {
      yield* waitForReactHandler(session, discountDetailsTrigger, "onFocus", {
        timeoutMs,
      });
      stage = "scroll-trigger";
      yield* scrollIntoView(session, discountDetailsTrigger, {
        timeoutMs: config.timeouts.browserAction,
      });
      stage = "blur-trigger";
      yield* session.use("focus browser element", async (page) => {
        const trigger = page
          .locator(discountDetailsTrigger)
          .filter({ visible: true });
        await trigger.blur({ timeout: config.timeouts.browserAction });
        stage = "focus-trigger";
        await trigger.focus({ timeout: config.timeouts.browserAction });
      });
      for (const discount of discounts) {
        stage = "detail";
        detailIndex += 1;
        currentDetail = toDiscountDetail(discount);
        yield* waitForPageCondition(
          session,
          `${discount.label} discount detail`,
          isDiscountDetailShown,
          currentDetail,
          { timeoutMs }
        );
      }
    }).pipe(
      // An outer step deadline interrupts the wait before its own timeout.
      Effect.onError(() =>
        Effect.sync(() =>
          log(
            `DISCOUNT_WAIT stage=${stage} detail_index=${detailIndex} detail_count=${discounts.length}`
          )
        ).pipe(
          Effect.andThen(() =>
            currentDetail
              ? session
                  .evaluate(
                    "observe failed discount detail",
                    observeDiscountDetail,
                    currentDetail,
                    { timeoutMs: config.timeouts.browserAction }
                  )
                  .pipe(
                    Effect.tap((observation) =>
                      Effect.sync(() =>
                        log(
                          `DISCOUNT_DETAIL triggers=${observation.triggers} visible_triggers=${observation.visibleTriggers} first_visible=${observation.firstVisible} first_linked=${observation.firstLinked} first_label=${observation.firstLabel} first_adjustment=${observation.firstAdjustment} visible_linked=${observation.visibleLinked} visible_label=${observation.visibleLabel} visible_adjustment=${observation.visibleAdjustment} body_label=${observation.bodyLabel}`
                        )
                      )
                    ),
                    Effect.ignore
                  )
              : Effect.void
          )
        )
      )
    );
  });

/** The control whose tooltip details the checkout's discounts. */
const discountDetailsTrigger = "[data-checkout-discount-details]";

type DiscountDetail = {
  readonly adjustment: string;
  /** Lower-cased in Node, as the label match ignores case. */
  readonly label: string;
  readonly trigger: string;
};

export const toDiscountDetail = ({
  adjustment,
  label,
}: Pick<
  ExpectedDiscountApplication,
  "adjustment" | "label"
>): DiscountDetail => ({
  adjustment: formatDiscountAdjustment(adjustment, "en-US"),
  label: label.toLocaleLowerCase(),
  trigger: discountDetailsTrigger,
});

/**
 * Runs in the browser: whether the discount-details tooltip, reached through
 * its trigger's `aria-describedby`, names the discount and its adjustment.
 * It must not close over anything.
 */
export const isDiscountDetailShown = ({
  adjustment,
  label,
  trigger,
}: DiscountDetail) => {
  const descriptionId = document
    .querySelector(trigger)
    ?.getAttribute("aria-describedby");
  const content = descriptionId
    ? (document.getElementById(descriptionId)?.textContent ?? "")
    : "";
  return (
    content.toLocaleLowerCase().includes(label) && content.includes(adjustment)
  );
};

/** Runs in the browser; returns only counts and expected-content booleans. */
const observeDiscountDetail = ({
  adjustment,
  label,
  trigger,
}: DiscountDetail) => {
  const triggers = [...document.querySelectorAll(trigger)];
  const visibleTriggers = triggers.filter(
    (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === "visible"
  );
  const describe = (element: Element | undefined) => {
    const id = element?.getAttribute("aria-describedby");
    const description = id ? document.getElementById(id) : null;
    const text = description?.textContent ?? "";
    return {
      linked: Boolean(description),
      label: text.toLocaleLowerCase().includes(label),
      adjustment: text.includes(adjustment),
    };
  };
  const first = describe(triggers[0]);
  const visible = describe(visibleTriggers[0]);
  return {
    triggers: triggers.length,
    visibleTriggers: visibleTriggers.length,
    firstVisible: Boolean(triggers[0] && visibleTriggers.includes(triggers[0])),
    firstLinked: first.linked,
    firstLabel: first.label,
    firstAdjustment: first.adjustment,
    visibleLinked: visible.linked,
    visibleLabel: visible.label,
    visibleAdjustment: visible.adjustment,
    bodyLabel: (document.body.textContent ?? "")
      .toLocaleLowerCase()
      .includes(label),
  };
};

/**
 * Runs in the browser: why the pay page no longer offers payment after a
 * rejected code, or `null` when its consent and pay action remain.
 */
export const findUnpayableSummaryProblem = (): string | null => {
  const consent = document.querySelector("#checkout-pay-legal-consent");
  const payButton = [...document.querySelectorAll("button")].find((button) =>
    /order and pay/i.test(button.textContent ?? "")
  );
  if (!(consent instanceof HTMLButtonElement) || consent.disabled) {
    return "payment consent unavailable after code rejection";
  }
  if (!(payButton instanceof HTMLButtonElement)) {
    return "payment action unavailable after code rejection";
  }
  return null;
};

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};

const waitForPricingChanged = (
  config: WorkspaceE2EConfig,
  browser: E2EBrowserSession
) =>
  waitForPageTextContent(browser, "Pricing changed.", {
    timeoutMs: config.timeouts.providerTransition,
  }).pipe(
    Effect.andThen(
      waitForPageTextContent(
        browser,
        "Review the updated summary before continuing.",
        { timeoutMs: config.timeouts.uiTransition }
      )
    )
  );

const submitCheckoutPaymentAndWaitForPricingChanged = (
  config: WorkspaceE2EConfig,
  browser: E2EBrowserSession
) =>
  submitCheckoutPayment(browser, config.timeouts).pipe(
    Effect.flatMap(browser.activate),
    Effect.andThen(waitForPricingChanged(config, browser))
  );
