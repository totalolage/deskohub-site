import type { DotyposDiscountGroupId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountCodeId } from "@/features/discounts/persistence-contracts";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  evalBrowserScript,
  focusBrowserElement,
  openBrowserPage,
  scrollBrowserElementIntoView,
  switchToBrowserTab,
  waitForBrowserCondition,
  waitForBrowserReactHandler,
  waitForBrowserTextContent,
} from "../browser";
import {
  getPrepareCoworkAdvertisedPriceScript,
  getSubmitCoworkReservationScript,
  submitPreparedCoworkReservationScript,
} from "../browser-scripts";
import { workspaceE2EMaximumSameDateCoworkReservations } from "../capacity";
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
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
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
  setE2ECalendarSaleCoworkEligibility,
} from "../integrations/discount-fixtures";
import {
  changeDotyposCustomerDiscount,
  type E2EDotyposDiscountGroup,
  prepareDotyposCustomerDiscount,
} from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";

const calendarSaleLabel = "E2E Calendar sale";
const codeDiscountLabel = "E2E promo code";
const customerDiscountLabel = "Customer discount";
const unavailableCodeScenarios = [
  { code: "E2E INVALID", id: "invalid-syntax" },
  { code: "E2E_UNKNOWN", id: "unknown" },
  { code: discountCodeFixtures.inactive.code, id: "inactive" },
  { code: discountCodeFixtures.notStarted.code, id: "not-started" },
  { code: discountCodeFixtures.expired.code, id: "expired" },
  {
    code: discountCodeFixtures.customerIneligible.code,
    id: "customer-ineligible",
  },
  {
    code: discountCodeFixtures.productIneligible.code,
    id: "product-ineligible",
  },
] as const;

export type DiscountE2EPreparation = {
  readonly availableBasicDates: readonly string[];
  readonly availablePlusDates: readonly string[];
  readonly availableProfiDates: readonly string[];
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
        entryTier: "plus",
      }),
      availableProfiDates: loadAvailableCoworkDates(config, {
        allocation,
        entryTier: "profi",
        monitorOption: "2x27-qhd",
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
  run,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly excludedDates: ReadonlySet<string>;
  readonly flowStates: CheckoutFlowState[];
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly preparation: DiscountE2EPreparation;
  readonly run: Runner;
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
      unavailableCodeScenarios.length + 13,
      {
        allocation,
        excludedDates,
        maximumReservationsPerDate:
          workspaceE2EMaximumSameDateCoworkReservations.basic,
        selectionLabel: "tier:basic",
      }
    );
    const calendarCheckoutDates = yield* selectCoworkDates(
      preparation.availablePlusDates,
      4,
      {
        allocation,
        excludedDates: new Set([...excludedDates, ...checkoutDates]),
        selectionLabel: "tier:plus",
      }
    );
    const transientCalendarDates = yield* selectCoworkDates(
      preparation.availableProfiDates,
      2,
      {
        allocation,
        excludedDates: new Set([
          ...excludedDates,
          ...checkoutDates,
          ...calendarCheckoutDates,
        ]),
        selectionLabel: "tier:profi with monitor:2x27-qhd",
      }
    );
    const cases: WorkspaceE2ECase[] = [];
    let nextDateIndex = 0;

    const codeCheckoutData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(checkoutDates, nextDateIndex),
      "cowork-discount-code"
    );
    nextDateIndex += 1;
    const codeCheckoutState = trackCheckoutState(flowStates, codeCheckoutData);
    cases.push({
      checkoutStates: [codeCheckoutState],
      execute: ({ runStep, session }) =>
        executeDiscountCheckout({
          config,
          data: codeCheckoutData,
          datasourceConfig,
          discountCode: discountCodeFixtures.partial.code,
          expectedDiscounts: [
            ...coworkAutomaticDiscounts,
            codeDiscountExpectation,
          ],
          flowId: "cowork-discount-code",
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
      execute: ({ runStep, session }) =>
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
      { entryTier: "plus" }
    );
    const calendarCheckoutState = trackCheckoutState(
      flowStates,
      calendarCheckoutData
    );
    cases.push({
      checkoutStates: [calendarCheckoutState],
      execute: ({ runStep, session }) =>
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
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run Calendar sale checkout e2e case", cause)
          )
        ),
      id: "checkout-calendar-sale",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const combinedCheckoutData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(calendarCheckoutDates, 1),
      "cowork-calendar-sale-and-code",
      { entryTier: "plus" }
    );
    const combinedCheckoutState = trackCheckoutState(
      flowStates,
      combinedCheckoutData
    );
    cases.push({
      checkoutStates: [combinedCheckoutState],
      execute: ({ runStep, session }) =>
        executeDiscountCheckout({
          config,
          data: combinedCheckoutData,
          datasourceConfig,
          discountCode: discountCodeFixtures.partial.code,
          expectedDiscounts: [
            ...coworkAutomaticDiscounts,
            codeDiscountExpectation,
          ],
          flowId: "cowork-calendar-sale-and-code",
          run,
          runStep,
          session,
          state: combinedCheckoutState,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.mapError((cause) =>
            toWorkspaceE2EError(
              "run combined Calendar and code checkout e2e case",
              cause
            )
          )
        ),
      id: "checkout-calendar-sale-and-code",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const quoteChangeData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(transientCalendarDates, 0),
      "cowork-calendar-disappears-before-quote",
      { entryTier: "profi" }
    );
    const quoteChangeState = trackCheckoutState(flowStates, quoteChangeData);
    const paymentChangeData = makeCoworkCheckoutData(
      config.baseUrl,
      yield* requireCheckoutDate(transientCalendarDates, 1),
      "cowork-calendar-disappears-before-payment",
      { entryTier: "profi" }
    );
    const paymentChangeState = trackCheckoutState(
      flowStates,
      paymentChangeData
    );
    cases.push({
      checkoutStates: [quoteChangeState, paymentChangeState],
      execute: ({ runStep, session }) =>
        withE2ECalendarSaleCoworkEligibility(
          executeCalendarSaleDisappearsBeforeQuote({
            config,
            data: quoteChangeData,
            run,
            runStep,
            session,
            state: quoteChangeState,
          })
        ).pipe(
          Effect.andThen(
            withE2ECalendarSaleCoworkEligibility(
              executeCalendarSaleDisappearsBeforePayment({
                config,
                data: paymentChangeData,
                run,
                runStep,
                session,
                state: paymentChangeState,
              })
            )
          ),
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
          yield* requireCheckoutDate(checkoutDates, nextDateIndex),
          "cowork-customer-discount"
        ),
        expectedDiscounts: [
          ...coworkAutomaticDiscounts,
          customerDiscountExpectation,
        ],
        id: "customer-discount",
      },
      {
        data: makeCoworkCheckoutData(
          config.baseUrl,
          yield* requireCheckoutDate(checkoutDates, nextDateIndex + 1),
          "cowork-customer-discount-and-code"
        ),
        discountCode: discountCodeFixtures.partial.code,
        expectedDiscounts: [
          ...coworkAutomaticDiscounts,
          customerDiscountExpectation,
          codeDiscountExpectation,
        ],
        id: "customer-discount-and-code",
      },
      {
        data: makeCoworkCheckoutData(
          config.baseUrl,
          yield* requireCheckoutDate(calendarCheckoutDates, 2),
          "cowork-calendar-and-customer-discount",
          { entryTier: "plus" }
        ),
        expectedDiscounts: [
          ...coworkAutomaticDiscounts,
          customerDiscountExpectation,
        ],
        id: "calendar-and-customer-discount",
      },
      {
        data: makeCoworkCheckoutData(
          config.baseUrl,
          yield* requireCheckoutDate(calendarCheckoutDates, 3),
          "cowork-all-discounts",
          { entryTier: "plus" }
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
    nextDateIndex += 2;

    for (const scenario of customerScenarios) {
      const state = trackCheckoutState(flowStates, scenario.data);
      cases.push({
        checkoutStates: [state],
        execute: ({ runStep, session }) =>
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
      execute: ({ runStep, session }) =>
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
        execute: ({ runStep, session }) =>
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
      execute: ({ runStep, session }) =>
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
      execute: ({ runStep, session }) =>
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
      execute: ({ runStep, session }) =>
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
      execute: ({ runStep, session }) =>
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

const executeCalendarSaleDisappearsBeforeQuote = ({
  config,
  data,
  run,
  runStep,
  session,
  state,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        yield* evalBrowserScript(
          "prepare advertised Calendar sale",
          run,
          session,
          getPrepareCoworkAdvertisedPriceScript(data),
          { timeoutMs: config.timeouts.checkoutStart }
        );
        yield* assertDisplayedDiscounts({
          config,
          discounts: [calendarDiscountExpectation],
          run,
          session,
        });
      }),
      id: "advertise-calendar-sale",
      timeoutMs: config.timeouts.checkoutStart,
    });
    yield* runStep({
      execute: setE2ECalendarSaleCoworkEligibility(false),
      id: "remove-calendar-sale-eligibility-before-quote",
      timeoutMs: config.timeouts.datasource,
    });
    const orderId = yield* runStep({
      execute: submitReservationForPayPage({
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript: submitPreparedCoworkReservationScript,
        timeouts: config.timeouts,
      }).pipe(Effect.tap(() => waitForPricingChanged(config, run, session))),
      id: "assert-calendar-quote-pricing-change",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-calendar-quote-change-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`Calendar quote-change e2e passed for order ${orderId}`);
  });

const executeCalendarSaleDisappearsBeforePayment = ({
  config,
  data,
  run,
  runStep,
  session,
  state,
}: {
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
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript: getSubmitCoworkReservationScript(data),
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-calendar-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: assertDisplayedDiscounts({
        config,
        discounts: [calendarDiscountExpectation],
        run,
        session,
      }),
      id: "assert-calendar-pay-page-discount",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: setE2ECalendarSaleCoworkEligibility(false),
      id: "remove-calendar-sale-eligibility-before-payment",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: submitCheckoutPaymentAndWaitForPricingChanged(
        config,
        run,
        session
      ),
      id: "assert-calendar-payment-pricing-change",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: assertNoDiscountPaymentState(orderId),
      id: "assert-calendar-payment-change-created-no-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    log(`Calendar payment-change e2e passed for order ${orderId}`);
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
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript: getSubmitCoworkReservationScript(data),
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-changing-customer-discount-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* assertDisplayedDiscounts({
      config,
      discounts: [customerDiscount],
      run,
      session,
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
      execute: submitCheckoutPaymentAndWaitForPricingChanged(
        config,
        run,
        session
      ),
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

const withE2ECalendarSaleCoworkEligibility = <A>(
  effect: Effect.Effect<A, WorkspaceE2EError, E2EDatabase>
): Effect.Effect<A, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* setE2ECalendarSaleCoworkEligibility(true);
    return yield* effect;
  }).pipe(
    Effect.ensuring(
      setE2ECalendarSaleCoworkEligibility(true).pipe(Effect.orDie)
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
      submitReservationScript: getSubmitCoworkReservationScript(ownerData),
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
      submitReservationScript: getSubmitCoworkReservationScript(ownerData),
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
      submitReservationScript: getSubmitCoworkReservationScript(reuseData),
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
  E2EDatabase | HttpClient.HttpClient
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

export const executeDiscountCheckout = ({
  appliedMessage = "Promotion applied: 10% off 🎉",
  config,
  data,
  datasourceConfig,
  discountCode,
  expectedDiscounts,
  flowId,
  run,
  runStep,
  session,
  state,
}: {
  readonly appliedMessage?: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly discountCode?: string;
  readonly expectedDiscounts: readonly ExpectedDiscountApplication[];
  readonly flowId: string;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | HttpClient.HttpClient
> =>
  executeCheckoutFlow({
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
          execute: assertDisplayedDiscounts({
            config,
            discounts: automaticDiscounts,
            run,
            session,
          }),
          id: "assert-automatic-checkout-discounts",
          timeoutMs: config.timeouts.uiTransition,
        });
      }
      if (discountCode) {
        steps.push({
          execute: applyDiscountCode({
            appliedMessage,
            code: discountCode,
            config,
            run,
            session,
          }),
          id: "apply-checkout-discount-code",
          timeoutMs: config.timeouts.uiTransition,
        });
      }
      steps.push({
        execute: assertDisplayedDiscounts({
          config,
          discounts: expectedDiscounts,
          run,
          session,
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
  });

export const executeUnavailableDiscountCode = ({
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
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript: getSubmitCoworkReservationScript(data),
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-unavailable-code-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: applyUnavailableDiscountCode({
        code,
        config,
        run,
        session,
      }).pipe(
        Effect.andThen(
          evalBrowserScript(
            "assert existing summary remains payable",
            run,
            session,
            `
(() => {
  const consent = document.querySelector('#checkout-pay-legal-consent');
  const payButton = [...document.querySelectorAll('button')].find((button) =>
    /order and pay/i.test(button.textContent ?? '')
  );
  if (!(consent instanceof HTMLButtonElement) || consent.disabled) {
    throw new Error('payment consent unavailable after code rejection');
  }
  if (!(payButton instanceof HTMLButtonElement)) {
    throw new Error('payment action unavailable after code rejection');
  }
  return true;
})()
`,
            { timeoutMs: config.timeouts.uiTransition }
          )
        )
      ),
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

export const executeDiscountCodeExpiresBeforePayment = ({
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
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript: getSubmitCoworkReservationScript(data),
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-expiring-code-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: applyDiscountCode({
        appliedMessage: "Promotion applied: 10% off 🎉",
        code,
        config,
        run,
        session,
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
      execute: submitCheckoutPaymentAndWaitForPricingChanged(
        config,
        run,
        session
      ),
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

export const codeDiscountExpectation = {
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
  submitReservationScript: getSubmitCoworkReservationScript,
});

export const assertDisplayedDiscounts = ({
  config,
  discounts,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly discounts: readonly ExpectedDiscountApplication[];
  readonly run: Runner;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
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
    for (const { adjustment, label } of discounts) {
      const adjustmentLabel = formatDiscountAdjustment(adjustment, "en-US");
      const labelLiteral = JSON.stringify(label.toLocaleLowerCase());
      const adjustmentLiteral = JSON.stringify(adjustmentLabel);
      yield* waitForBrowserCondition(
        run,
        session,
        `${label} discount detail`,
        `
(() => {
  const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
  const descriptionId = trigger?.getAttribute('aria-describedby');
  const content = descriptionId
    ? (document.getElementById(descriptionId)?.textContent ?? '')
    : '';
  return content.toLocaleLowerCase().includes(${labelLiteral})
    && content.includes(${adjustmentLiteral});
})()
`,
        { timeoutMs: config.timeouts.uiTransition }
      );
    }
  });

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
  run: Runner,
  session: string
) =>
  waitForBrowserTextContent(run, session, "Pricing changed.", {
    timeoutMs: config.timeouts.providerTransition,
  }).pipe(
    Effect.andThen(
      waitForBrowserTextContent(
        run,
        session,
        "Review the updated summary before continuing.",
        { timeoutMs: config.timeouts.uiTransition }
      )
    )
  );

const submitCheckoutPaymentAndWaitForPricingChanged = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string
) =>
  submitCheckoutPayment(run, session).pipe(
    Effect.flatMap((checkoutTabId) =>
      switchToBrowserTab(run, session, checkoutTabId)
    ),
    Effect.andThen(waitForPricingChanged(config, run, session))
  );
