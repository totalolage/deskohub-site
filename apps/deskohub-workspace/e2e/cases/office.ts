import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { getWorkspaceOfficePrice } from "@/features/checkout/product-catalog";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { waitForBrowserText } from "../browser";
import { getSubmitOfficeReservationScript } from "../browser-scripts";
import {
  loadOfficeAvailability,
  makeOfficeCheckoutData,
  type OfficeCheckoutSlot,
  selectAvailableOfficeSlot,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";

export type OfficeE2EPreparation = {
  readonly slot: OfficeCheckoutSlot;
};

export const prepareOfficeE2E = (
  config: WorkspaceE2EConfig,
  allocation: WorkspaceE2EDateAllocation
): Effect.Effect<
  OfficeE2EPreparation,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  selectAvailableOfficeSlot(config, allocation).pipe(
    Effect.map((slot) => ({ slot }))
  );

export const makeOfficeE2ECases = ({
  config,
  datasourceConfig,
  flowStates,
  preparation,
  run,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly flowStates: CheckoutFlowState[];
  readonly preparation: OfficeE2EPreparation;
  readonly run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const data = makeOfficeCheckoutData(
      config.baseUrl,
      preparation.slot,
      "office-paid-multi-day"
    );
    const state = trackCheckoutState(flowStates, data);

    return [
      {
        checkoutStates: [state],
        execute: ({ resources, runStep, session }) =>
          executeCheckoutFlow({
            config,
            data,
            datasourceConfig,
            flow: {
              id: "office-paid-multi-day",
              submitReservationScript: getSubmitOfficeReservationScript,
            },
            resources,
            payPageSteps: () => [
              {
                execute: assertOfficePayPage(config, data, run, session),
                id: "assert-office-pay-summary",
                timeoutMs: config.timeouts.uiTransition,
              },
              {
                execute: assertHeldOfficeUnavailable(config, data).pipe(
                  Effect.provideService(HttpClient.HttpClient, httpClient)
                ),
                id: "assert-held-office-unavailable",
                timeoutMs: config.timeouts.datasource,
              },
            ],
            run,
            runStep,
            session,
            state,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run paid multi-day office checkout e2e case",
                cause
              )
            )
          ),
        id: "checkout-office-paid-multi-day",
        timeoutMs: config.timeouts.checkoutCase,
      },
    ];
  });

const assertOfficePayPage = (
  config: WorkspaceE2EConfig,
  data: CheckoutData,
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const office = yield* getOfficeSlot(data);
    const dayCount =
      Temporal.PlainDate.from(office.startsOn).until(
        Temporal.PlainDate.from(office.endsOn),
        { largestUnit: "day" }
      ).days + 1;
    const people = office.additionalGuests + 1;
    const itemTitle = `Private office · ${dayCount} days · ${people} people`;
    const price = formatWorkspaceMoney(
      getWorkspaceOfficePrice({
        additionalGuests: office.additionalGuests,
        dayCount,
      }),
      data.locale
    ).replaceAll(/\s+/g, " ");

    yield* waitForBrowserText({
      description: "office pay summary",
      matches: (text) => {
        const normalized = text.replaceAll(/\s+/g, " ");
        return normalized.includes(itemTitle) && normalized.includes(price);
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Office pay summary validated");
  });

const assertHeldOfficeUnavailable = (
  config: WorkspaceE2EConfig,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const office = yield* getOfficeSlot(data);
    const availability = yield* pollUntil(
      loadOfficeAvailability(config, office).pipe(
        Effect.map((result) => (result.officeUnavailable ? result : undefined))
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "held office range to become unavailable",
        timeoutMs: config.timeouts.datasource,
      }
    );

    yield* tryWorkspaceE2ESync("assert held office availability", () => {
      assert(
        availability.officeUnavailable,
        "held office range remained available"
      );
    });
    log("Held office range is exclusively unavailable");
  });

const getOfficeSlot = (data: CheckoutData) =>
  tryWorkspaceE2ESync("read office checkout range", () => {
    assert(data.office, "office checkout range missing");
    return data.office;
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};
