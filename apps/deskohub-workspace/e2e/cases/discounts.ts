import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  evalBrowserScript,
  hoverBrowserElement,
  openBrowserPage,
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
  waitForCheckoutRow,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  discountCodeFixtures,
  expireDiscountCodeForE2E,
  setE2ECalendarSaleProfiEligibility,
} from "../integrations/discount-fixtures";
import {
  changeDotyposCustomerDiscount,
  type E2EDotyposDiscountGroup,
  prepareDotyposCustomerDiscount,
  resolveE2EDotyposDiscountGroup,
} from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
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

export const prepareDiscountE2E = (
  config: WorkspaceE2EConfig,
  datasourceConfig: DatasourceConfig,
  allocation: WorkspaceE2EDateAllocation
): Effect.Effect<
  DiscountE2EPreparation,
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
      customerDiscountGroup: resolveE2EDotyposDiscountGroup(datasourceConfig),
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
    const checkoutDates = yield* selectCoworkDates(
      preparation.availableBasicDates,
      unavailableCodeScenarios.length + 9,
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
          expectedDiscounts: [codeDiscountExpectation],
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
          expectedDiscounts: [calendarDiscountExpectation],
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
            calendarDiscountExpectation,
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
        withE2ECalendarSaleProfiEligibility(
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
            withE2ECalendarSaleProfiEligibility(
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
      runAfterParallel: true,
      timeoutMs: config.timeouts.checkoutCase * 2,
    });

    const customerScenarios = [
      {
        data: makeCoworkCheckoutData(
          config.baseUrl,
          yield* requireCheckoutDate(checkoutDates, nextDateIndex),
          "cowork-customer-discount"
        ),
        expectedDiscounts: [customerDiscountExpectation],
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
          calendarDiscountExpectation,
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
          calendarDiscountExpectation,
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
          tier: "profi",
        });
      }),
      id: "advertise-calendar-sale",
      timeoutMs: config.timeouts.checkoutStart,
    });
    yield* runStep({
      execute: setE2ECalendarSaleProfiEligibility(false),
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
      capacity: "reservation-start",
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
      execute: setE2ECalendarSaleProfiEligibility(false),
      id: "remove-calendar-sale-eligibility-before-payment",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.andThen(waitForPricingChanged(config, run, session))
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
  readonly discountGroupId: string;
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
      capacity: "reservation-start",
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
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.andThen(waitForPricingChanged(config, run, session))
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

const withE2ECalendarSaleProfiEligibility = <A>(
  effect: Effect.Effect<A, WorkspaceE2EError, E2EDatabase>
): Effect.Effect<A, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* setE2ECalendarSaleProfiEligibility(true);
    return yield* effect;
  }).pipe(
    Effect.ensuring(setE2ECalendarSaleProfiEligibility(true).pipe(Effect.orDie))
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

export const executeDiscountCheckout = ({
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
    payPageStep: () => ({
      execute: Effect.gen(function* () {
        const automaticDiscounts = expectedDiscounts.filter(
          ({ label }) => label !== codeDiscountLabel
        );
        if (automaticDiscounts.length > 0) {
          yield* assertDisplayedDiscounts({
            config,
            discounts: automaticDiscounts,
            run,
            session,
          });
        }
        if (discountCode) {
          yield* applyDiscountCode({
            appliedMessage: "Discount code applied: 10% off 🎉",
            code: discountCode,
            config,
            run,
            session,
          });
        }
        yield* assertDisplayedDiscounts({
          config,
          discounts: expectedDiscounts,
          run,
          session,
        });
      }),
      id: "assert-and-apply-checkout-discounts",
      timeoutMs: config.timeouts.uiTransition,
    }),
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
      capacity: "reservation-start",
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
  readonly codeId: string;
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
      capacity: "reservation-start",
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
        appliedMessage: "Discount code applied: 10% off 🎉",
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
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.andThen(waitForPricingChanged(config, run, session))
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
  basisPoints: 2000,
  hasExpiration: true,
  label: calendarSaleLabel,
} as const satisfies ExpectedDiscountApplication;

export const codeDiscountExpectation = {
  basisPoints: 1000,
  label: codeDiscountLabel,
  redemptionState: "redeemed",
} as const satisfies ExpectedDiscountApplication;

const makeCustomerDiscountExpectation = (
  basisPoints: number
): ExpectedDiscountApplication => ({
  basisPoints,
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
  tier,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly discounts: readonly ExpectedDiscountApplication[];
  readonly run: Runner;
  readonly session: string;
  readonly tier?: WorkspaceCoworkProductTier;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const triggerSelector = tier
      ? `[data-reservation-type-option="${tier}"] button[aria-label^="Show discounts applied to"]`
      : 'button[aria-label^="Show discounts applied to"]';
    yield* waitForBrowserReactHandler(
      run,
      session,
      triggerSelector,
      "onPointerMove",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* hoverBrowserElement(run, session, triggerSelector, {
      timeoutMs: config.timeouts.browserAction,
    });
    for (const { basisPoints, label } of discounts) {
      const adjustment = new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(basisPoints / 10_000);
      const labelLiteral = JSON.stringify(label.toLocaleLowerCase());
      const adjustmentLiteral = JSON.stringify(adjustment);
      yield* waitForBrowserCondition(
        run,
        session,
        `${label} discount detail`,
        `
(() => [...document.querySelectorAll('[role="tooltip"] li')].some((item) => {
  const content = item.textContent ?? '';
  return content.toLocaleLowerCase().includes(${labelLiteral})
    && content.includes(${adjustmentLiteral});
}))()
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
