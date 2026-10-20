import { Effect } from "effect";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  type ReservationSelectionSearchParams,
  reservationCustomerQueryParam,
} from "@/features/reservation/reservation-checkout-query";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import {
  clickBrowserElement,
  evalBrowserScript,
  fillBrowserField,
  openBrowserPage,
  readBrowserUrl,
  waitForBrowserCondition,
  waitForBrowserReactHandler,
  waitForBrowserUrl,
} from "../browser";
import {
  getPrefilledReservationConditionScript,
  getPrepareCoworkAdvertisedPriceScript,
  getPrepareMeetingRoomAdvertisedPriceScript,
  getPrepareOfficeAdvertisedPriceScript,
} from "../browser-scripts";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
  requireCheckoutDate,
  reuseCoworkCheckoutContact,
  selectCoworkDates,
} from "../checkout/data";
import {
  continueToReservationContactStep,
  prepareReservationSelection,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { loadDotyposOfficeSeatCapacity } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  WorkspaceE2ECase,
  WorkspaceE2EStepRunner,
} from "../types";
import type { DiscountAvailabilityE2EPreparation } from "./discounts";
import {
  type MeetingRoomE2EPreparation,
  meetingRoomE2EUrlStateSlotIndex,
} from "./meeting-room";
import type { OfficeE2EPreparation } from "./office";

// Contact details and the customer mode must never reach the URL.
const reservationContactQueryParams = [
  "name",
  "email",
  "phone",
  reservationCustomerQueryParam,
] as const;

// A parameter outside every selection, which the write-back must keep as it
// arrived.
const unrelatedQueryParams = { utm_source: "workspace-e2e-url-state" };

const urlStateMonitorOption: WorkspaceProductMonitorOption = "2x32-qhd";
const officeSeatPriceSelector = (seats: number) =>
  `[data-reservation-type-price="${seats}"]`;
const coffeeSwitchSelector =
  '[data-cowork-optional-addon-toggle="coffee"] [role="switch"]';

export type ReservationUrlState = {
  readonly pathname: string;
  readonly preserved: Readonly<Record<string, string>>;
  // A parameter set to `undefined` must be absent.
  readonly selection: ReservationSelectionSearchParams;
};

/**
 * The first way `url` differs from the expected reservation URL state, naming
 * only the parameter, never its value, or `undefined` when it matches.
 */
export const findReservationUrlStateMismatch = (
  url: string,
  expected: ReservationUrlState
): string | undefined => {
  const parsed = parseUrl(url);
  if (!parsed) return "URL is not readable";
  if (parsed.pathname !== expected.pathname) return "path changed";
  for (const name of reservationContactQueryParams) {
    if (parsed.searchParams.has(name))
      return `contact parameter ${name} present`;
  }
  for (const [name, value] of Object.entries(expected.selection)) {
    if (value === undefined) {
      if (parsed.searchParams.has(name)) {
        return `removed selection parameter ${name} present`;
      }
    } else if (parsed.searchParams.get(name) !== value) {
      return `selection parameter ${name} missing or different`;
    }
  }
  for (const [name, value] of Object.entries(expected.preserved)) {
    if (parsed.searchParams.get(name) !== value) {
      return `preserved parameter ${name} missing or different`;
    }
  }
  return undefined;
};

type UrlStateCaseContext = {
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
};

export const makeReservationUrlStateE2ECases = ({
  allocation,
  config,
  datasourceConfig,
  preparation,
  run,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly preparation: {
    readonly discounts: DiscountAvailabilityE2EPreparation;
    readonly meetingRoom: MeetingRoomE2EPreparation;
    readonly office: OfficeE2EPreparation | undefined;
  };
  readonly run: Runner;
}): Effect.Effect<readonly WorkspaceE2ECase[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    // None of these cases submits, so they hold no capacity: their dates only
    // need to stay in the run's shard and outside the dates other cases hold
    // exclusively (meeting-room slots and office ranges).
    const openSpaceDate = yield* requireCheckoutDate(
      yield* selectCoworkDates(preparation.discounts.availableBasicDates, 1, {
        allocation,
        selectionLabel: "reservation URL-state open-space",
      }),
      0
    );
    const reservedDeskDate = yield* requireCheckoutDate(
      yield* selectCoworkDates(
        preparation.discounts.availableReservedDeskDates,
        1,
        {
          allocation,
          selectionLabel: "reservation URL-state reserved-desk",
        }
      ),
      0
    );
    const openSpaceData = makeCoworkCheckoutData(
      config.baseUrl,
      openSpaceDate,
      "url-state-cowork",
      { coffee: true, entryTier: "open-space" }
    );
    // Reserved Desk advertising can go stale while the Calendar-sale pricing
    // case removes its sale target, so this case waits only for a ready price
    // and never asserts its amount or checks out.
    const reservedDeskData = reuseCoworkCheckoutContact(
      config.baseUrl,
      reservedDeskDate,
      openSpaceData,
      { entryTier: "reserved-desk", monitorOption: urlStateMonitorOption }
    );
    const meetingRoomSlot = yield* tryWorkspaceE2ESync(
      "require meeting-room URL-state slot",
      () => {
        const slot =
          preparation.meetingRoom.slots[meetingRoomE2EUrlStateSlotIndex];
        assert(slot, "missing meeting-room URL-state slot");
        return slot;
      }
    );
    const meetingRoomData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      meetingRoomSlot,
      "url-state-meeting-room"
    );

    const cases: WorkspaceE2ECase[] = [
      {
        checkoutStates: [],
        execute: ({ runStep, session }) =>
          assertCoworkUrlState(
            { config, run, runStep, session },
            { openSpaceData, reservedDeskData }
          ).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run cowork URL-state e2e case", cause)
            )
          ),
        id: "reservation-url-state-cowork",
        timeoutMs: config.timeouts.reservationUrlStateCase,
      },
      {
        checkoutStates: [],
        execute: ({ runStep, session }) =>
          assertMeetingRoomUrlState(
            { config, run, runStep, session },
            meetingRoomData
          ).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run meeting-room URL-state e2e case", cause)
            )
          ),
        id: "reservation-url-state-meeting-room",
        timeoutMs: config.timeouts.reservationUrlStateCase,
      },
    ];
    if (!preparation.office) return cases;

    // The paid office case holds the other prepared range, so these cases
    // use the one no case holds.
    const officeData = makeOfficeCheckoutData(
      config.baseUrl,
      preparation.office.urlStateSlot,
      "url-state-office"
    );
    cases.push(
      {
        checkoutStates: [],
        execute: ({ runStep, session }) =>
          assertOfficeUrlState(
            { config, run, runStep, session },
            officeData
          ).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run office URL-state e2e case", cause)
            )
          ),
        id: "reservation-url-state-office",
        timeoutMs: config.timeouts.reservationUrlStateCase,
      },
      {
        checkoutStates: [],
        execute: ({ runStep, session }) =>
          assertOfficeStartsOnLink(
            { config, run, runStep, session },
            datasourceConfig,
            officeData
          ).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run office startsOn link e2e case", cause)
            )
          ),
        id: "reservation-url-state-office-starts-on-link",
        timeoutMs: config.timeouts.reservationUrlStateCase,
      }
    );
    return cases;
  });

const assertCoworkUrlState = (
  context: UrlStateCaseContext,
  {
    openSpaceData,
    reservedDeskData,
  }: {
    readonly openSpaceData: CheckoutData;
    readonly reservedDeskData: CheckoutData;
  }
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const { config, run, runStep, session } = context;
    const pathname = "/en-US/reservation/cowork";
    yield* runStep({
      execute: openReservationPage(context, pathname),
      id: "open-cowork-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: getPrepareCoworkAdvertisedPriceScript(openSpaceData),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "select-open-space-date",
      timeoutMs: config.timeouts.uiTransition,
    });
    // The contact step keeps the selection URL; typing there and returning
    // must not write the contact into it.
    yield* runStep({
      execute: continueToReservationContactStep({
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: "continue-to-cowork-contact",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: typeContact(context, openSpaceData),
      id: "type-cowork-contact",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: returnToReservationSelection(context),
      id: "return-to-cowork-selection",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: switchCoffeeOn(context),
      id: "switch-coffee-on",
      timeoutMs: config.timeouts.browserAction,
    });
    const openSpaceState: ReservationUrlState = {
      pathname,
      preserved: unrelatedQueryParams,
      selection: {
        coffee: "true",
        date: openSpaceData.date,
        entryTier: "open-space",
        monitorOption: undefined,
      },
    };
    yield* runStep({
      execute: waitForReservationUrlState(
        context,
        "open-space selection in the URL",
        openSpaceState
      ),
      id: "assert-open-space-url",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: reloadAndAssertRestoredSelection(
        context,
        openSpaceData,
        openSpaceState
      ),
      id: "reload-and-assert-open-space-restored",
      timeoutMs: config.timeouts.browserNavigation,
    });

    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: getPrepareCoworkAdvertisedPriceScript(reservedDeskData),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "select-reserved-desk-date-and-monitor",
      timeoutMs: config.timeouts.uiTransition,
    });
    const reservedDeskState: ReservationUrlState = {
      pathname,
      preserved: unrelatedQueryParams,
      selection: {
        // Reserved Desk includes coffee.
        coffee: "true",
        date: reservedDeskData.date,
        entryTier: "reserved-desk",
        monitorOption: urlStateMonitorOption,
      },
    };
    yield* runStep({
      execute: waitForReservationUrlState(
        context,
        "reserved-desk selection in the URL",
        reservedDeskState
      ),
      id: "assert-reserved-desk-url",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: reloadAndAssertRestoredSelection(
        context,
        reservedDeskData,
        reservedDeskState
      ),
      id: "reload-and-assert-reserved-desk-restored",
      timeoutMs: config.timeouts.browserNavigation,
    });
    log("Cowork reservation URL-state e2e passed");
  });

const assertMeetingRoomUrlState = (
  context: UrlStateCaseContext,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const { config, run, runStep, session } = context;
    const pathname = "/en-US/reservation/meeting-room";
    const meetingRoom = yield* requireMeetingRoom(data);
    yield* runStep({
      execute: openReservationPage(context, pathname),
      id: "open-meeting-room-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    // Selects the start date, duration, and start time, then types the
    // contact, and waits for the selection's availability and price.
    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: getPrepareMeetingRoomAdvertisedPriceScript(data),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "select-meeting-room-start-and-duration",
      timeoutMs: config.timeouts.uiTransition,
    });
    const state: ReservationUrlState = {
      pathname,
      preserved: unrelatedQueryParams,
      selection: {
        duration: getMeetingRoomReservationDurationKey(meetingRoom.duration),
        startDateTime: meetingRoom.startDateTime,
      },
    };
    yield* runStep({
      execute: waitForReservationUrlState(
        context,
        "meeting-room selection in the URL",
        state
      ),
      id: "assert-meeting-room-url",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: reloadAndAssertRestoredSelection(context, data, state),
      id: "reload-and-assert-meeting-room-restored",
      timeoutMs: config.timeouts.browserNavigation,
    });
    log("Meeting-room reservation URL-state e2e passed");
  });

const assertOfficeUrlState = (
  context: UrlStateCaseContext,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const { config, run, runStep, session } = context;
    const pathname = "/en-US/reservation/office";
    yield* runStep({
      execute: openReservationPage(context, pathname),
      id: "open-office-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    // Selects the start date, day count, and seats, then types the contact,
    // and waits for the selection's availability and price.
    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: getPrepareOfficeAdvertisedPriceScript(data),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "select-office-start-days-and-seats",
      timeoutMs: config.timeouts.uiTransition,
    });
    const state = yield* getOfficeUrlState(data);
    yield* runStep({
      execute: waitForReservationUrlState(
        context,
        "office selection in the URL",
        state
      ),
      id: "assert-office-url",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: reloadAndAssertRestoredSelection(context, data, state),
      id: "reload-and-assert-office-restored",
      timeoutMs: config.timeouts.browserNavigation,
    });
    log("Office reservation URL-state e2e passed");
  });

/**
 * Opens an office link with a future `startsOn` and checks that the page
 * shows that start date, a seat option per seat of the office table, and the
 * same price the customer sees after choosing that selection on a link-free
 * page.
 */
const assertOfficeStartsOnLink = (
  context: UrlStateCaseContext,
  datasourceConfig: DatasourceConfig,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const { config, run, runStep, session } = context;
    const pathname = "/en-US/reservation/office";
    const state = yield* getOfficeUrlState(data);
    const seats = yield* getOfficeSeats(data);
    const seatCapacity = yield* runStep({
      execute: loadDotyposOfficeSeatCapacity(datasourceConfig),
      id: "load-office-seat-capacity",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: openBrowserPage(
        config,
        run,
        session,
        `${config.baseUrl}${pathname}?${new URLSearchParams(
          Object.entries(state.selection).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        )}`,
        { timeoutMs: config.timeouts.browserNavigation }
      ).pipe(Effect.asVoid),
      id: "open-office-starts-on-link",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: waitForBrowserCondition(
        run,
        session,
        "linked office selection",
        getPrefilledReservationConditionScript(data, { includeContact: false }),
        { timeoutMs: config.timeouts.uiTransition }
      ),
      id: "assert-linked-office-selection",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: waitForBrowserCondition(
        run,
        session,
        "office seat options for the office table capacity",
        getOfficeSeatOptionsConditionScript(seatCapacity),
        { timeoutMs: config.timeouts.uiTransition }
      ),
      id: "assert-linked-office-seat-options",
      timeoutMs: config.timeouts.uiTransition,
    });
    const linkedDisplay = yield* runStep({
      execute: readOfficeSelectionDisplay(context, seats),
      id: "read-linked-office-date-and-price",
      timeoutMs: config.timeouts.uiTransition,
    });

    yield* runStep({
      execute: openBrowserPage(
        config,
        run,
        session,
        `${config.baseUrl}${pathname}`,
        { timeoutMs: config.timeouts.browserNavigation }
      ).pipe(Effect.asVoid),
      id: "open-link-free-office-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: prepareReservationSelection({
        prepareScript: getPrepareOfficeAdvertisedPriceScript(data),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
        timeouts: config.timeouts,
      }),
      id: "select-linked-office-selection-through-form",
      timeoutMs: config.timeouts.uiTransition,
    });
    const selectedDisplay = yield* runStep({
      execute: readOfficeSelectionDisplay(context, seats),
      id: "read-selected-office-date-and-price",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* tryWorkspaceE2ESync("compare linked and selected office", () => {
      for (const field of Object.keys(linkedDisplay) as Array<
        keyof OfficeSelectionDisplay
      >) {
        assert(
          linkedDisplay[field] === selectedDisplay[field],
          `linked office ${field} differs from the form selection`
        );
      }
    });
    log("Office startsOn link e2e passed");
  });

const openReservationPage = (
  { config, run, session }: UrlStateCaseContext,
  pathname: string
) =>
  openBrowserPage(
    config,
    run,
    session,
    `${config.baseUrl}${pathname}?${new URLSearchParams(unrelatedQueryParams)}`,
    { timeoutMs: config.timeouts.browserNavigation }
  ).pipe(Effect.asVoid);

// Native fills, so the form receives the customer's own input events.
const typeContact = (
  { config, run, session }: UrlStateCaseContext,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* fillBrowserField(run, session, 'input[name="name"]', data.name, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* fillBrowserField(run, session, 'input[name="email"]', data.email, {
      timeoutMs: config.timeouts.browserAction,
    });
  });

const selectionSummaryChangeSelector =
  'section[aria-labelledby="reservation-selection-summary-heading"] button';

// The summary's Change button returns to the selection step in place.
const returnToReservationSelection = ({
  config,
  run,
  session,
}: UrlStateCaseContext): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const options = { timeoutMs: config.timeouts.browserAction };
    yield* waitForBrowserReactHandler(
      run,
      session,
      selectionSummaryChangeSelector,
      "onClick",
      options
    );
    yield* clickBrowserElement(
      run,
      session,
      selectionSummaryChangeSelector,
      options
    );
    yield* waitForBrowserCondition(
      run,
      session,
      "reservation selection step",
      `document.querySelector('#reservation-continue') !== null`,
      options
    );
  });

const switchCoffeeOn = ({
  config,
  run,
  session,
}: UrlStateCaseContext): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const options = { timeoutMs: config.timeouts.browserAction };
    yield* waitForBrowserCondition(
      run,
      session,
      "coffee switched off",
      getSwitchCheckedConditionScript(coffeeSwitchSelector, false),
      options
    );
    yield* waitForBrowserReactHandler(
      run,
      session,
      coffeeSwitchSelector,
      "onClick",
      options
    );
    yield* clickBrowserElement(run, session, coffeeSwitchSelector, options);
    yield* waitForBrowserCondition(
      run,
      session,
      "coffee switched on",
      getSwitchCheckedConditionScript(coffeeSwitchSelector, true),
      options
    );
  });

const waitForReservationUrlState = (
  { config, run, session }: UrlStateCaseContext,
  description: string,
  expected: ReservationUrlState
) => {
  let lastMismatch = "URL was not read";
  return waitForBrowserUrl({
    description,
    matches: (url) => {
      const mismatch = findReservationUrlStateMismatch(url, expected);
      lastMismatch = mismatch ?? "none";
      return mismatch === undefined;
    },
    run,
    session,
    timeoutMs: config.timeouts.uiTransition,
  }).pipe(
    Effect.tapError(() =>
      Effect.sync(() => log(`${description}: last mismatch ${lastMismatch}`))
    ),
    Effect.asVoid
  );
};

/**
 * Reloads the page from its written URL and checks the server-rendered form
 * shows the same selection, and that loading it leaves the URL unchanged.
 */
const reloadAndAssertRestoredSelection = (
  context: UrlStateCaseContext,
  data: CheckoutData,
  expected: ReservationUrlState
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const { config, run, session } = context;
    const writtenUrl = yield* readBrowserUrl(run, session);
    const url = yield* tryWorkspaceE2ESync(
      "read written reservation URL",
      () => {
        assert(writtenUrl, "written reservation URL missing");
        return writtenUrl;
      }
    );
    yield* openBrowserPage(config, run, session, url, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* waitForBrowserCondition(
      run,
      session,
      "restored reservation selection",
      getPrefilledReservationConditionScript(data, { includeContact: false }),
      { timeoutMs: config.timeouts.uiTransition }
    );
    const reloadedUrl = yield* readBrowserUrl(run, session);
    yield* tryWorkspaceE2ESync("assert reloaded reservation URL", () => {
      const mismatch = findReservationUrlStateMismatch(
        reloadedUrl ?? "",
        expected
      );
      assert(mismatch === undefined, `reloaded reservation URL: ${mismatch}`);
    });
  });

const getOfficeUrlState = (data: CheckoutData) =>
  tryWorkspaceE2ESync("build office URL state", (): ReservationUrlState => {
    assert(data.office, "office range missing");
    assert(
      data.expectedReservationDetails.kind === "office",
      "office reservation details missing"
    );
    return {
      pathname: "/en-US/reservation/office",
      preserved: {},
      selection: {
        dayCount: String(data.expectedReservationDetails.dayCount),
        seats: String(data.office.seats),
        startsOn: data.office.startsOn,
      },
    };
  });

const getOfficeSeats = (data: CheckoutData) =>
  tryWorkspaceE2ESync("read office seats", () => {
    assert(data.office, "office range missing");
    return data.office.seats;
  });

const requireMeetingRoom = (data: CheckoutData) =>
  tryWorkspaceE2ESync("read meeting-room interval", () => {
    assert(data.meetingRoom, "meeting-room interval missing");
    return data.meetingRoom;
  });

const getSwitchCheckedConditionScript = (
  selector: string,
  checked: boolean
) => `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  return element instanceof HTMLButtonElement &&
    element.getAttribute('aria-checked') === ${JSON.stringify(String(checked))};
})()
`;

// Live seat cards for exactly one through `seatCapacity` seats, none of them
// the loading fallback or disabled.
const getOfficeSeatOptionsConditionScript = (seatCapacity: number) => `
(() => {
  if (document.querySelector('[data-office-seat-option-fallback]')) return false;
  const options = [...document.querySelectorAll('input[name="seats"]')];
  return options.length === ${seatCapacity} &&
    options.every(
      (option, index) =>
        option instanceof HTMLInputElement &&
        option.value === String(index + 1) &&
        !option.disabled
    );
})()
`;

type OfficeSelectionDisplay = {
  readonly basePrice: string;
  readonly seatPrice: string;
  readonly startDate: string;
};

/**
 * Waits for the office access and selected-seat prices to be ready, then
 * reads them with the start date field's committed value.
 */
const readOfficeSelectionDisplay = (
  { config, run, session }: UrlStateCaseContext,
  seats: number
): Effect.Effect<OfficeSelectionDisplay, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const elements = `
  const basePrice = document.querySelector('[data-office-base-price]');
  const seatPrice = document.querySelector(${JSON.stringify(officeSeatPriceSelector(seats))});
  const startDate = document.querySelector('input[name="startsOn"]');
  const submit = document.querySelector('#reservation-continue');
  const text = (element) => (element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
`;
    yield* waitForBrowserCondition(
      run,
      session,
      "office access and seat prices",
      `
(() => {
  ${elements}
  return basePrice instanceof HTMLElement &&
    basePrice.querySelector('[data-slot="skeleton"]') === null &&
    seatPrice instanceof HTMLElement &&
    seatPrice.dataset.reservationTypePriceReady === 'true' &&
    startDate instanceof HTMLInputElement &&
    submit instanceof HTMLButtonElement &&
    submit.dataset.reservationPriceLoading === 'false' &&
    submit.dataset.reservationPriceError !== 'true';
})()
`,
      { timeoutMs: config.timeouts.uiTransition }
    );
    const result = yield* evalBrowserScript(
      "read office date and prices",
      run,
      session,
      `
(() => {
  ${elements}
  return {
    basePrice: text(basePrice),
    seatPrice: text(seatPrice),
    startDate: startDate.value,
  };
})()
`,
      { logOutput: false, timeoutMs: config.timeouts.browserAction }
    );
    return yield* tryWorkspaceE2ESync("parse office date and prices", () => {
      const display = JSON.parse(
        result.stdout.trim()
      ) as Partial<OfficeSelectionDisplay>;
      assert(
        typeof display.basePrice === "string" &&
          display.basePrice.length > 0 &&
          typeof display.seatPrice === "string" &&
          display.seatPrice.length > 0 &&
          typeof display.startDate === "string" &&
          display.startDate.length > 0,
        "office date and prices missing"
      );
      return display as OfficeSelectionDisplay;
    });
  });
