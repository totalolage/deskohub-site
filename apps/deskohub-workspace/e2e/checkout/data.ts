import { Effect } from "effect";
import {
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationInterval,
} from "../../features/reservation/meeting-room-reservation-time";
import {
  getMeetingRoomSubmitReservationScript,
  submitCoworkReservationScript,
} from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  effectifyPromise,
  effectifySync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { hasMeetingRoomTableCandidate } from "../integrations/dotypos";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutFlow } from "../types";

let checkoutContactSequence = 0;

export const checkoutFlows: readonly CheckoutFlow[] = [
  {
    id: "cowork-basic",
    makeData: (config, _datasourceConfig, date) =>
      Effect.succeed(makeCoworkCheckoutData(config.browserUrl, date)),
    submitReservationScript: () => submitCoworkReservationScript,
    usesCoworkDate: true,
  },
  {
    id: "meeting-room-60",
    makeData: (config, datasourceConfig) =>
      Effect.gen(function* () {
        const hasTable = yield* hasMeetingRoomTableCandidate(datasourceConfig);
        if (!hasTable) {
          log(
            "Skipping meeting-room checkout e2e: no active visible Dotypos table is tagged reservation:meeting-room"
          );
          return undefined;
        }

        const slot = yield* selectAvailableMeetingRoomSlot(config);
        return makeMeetingRoomCheckoutData(config.browserUrl, slot);
      }),
    submitReservationScript: getMeetingRoomSubmitReservationScript,
  },
];

type MeetingRoomSlot = {
  readonly date: string;
  readonly endsAt: string;
  readonly startDateTime: string;
  readonly startsAt: string;
};

const makeCheckoutContact = (flowId: string) => {
  checkoutContactSequence += 1;
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const sequence = String(checkoutContactSequence % 100).padStart(2, "0");
  const emailKey = `${flowId}-${runId}-${sequence}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-");
  const name = `Workspace E2E ${flowId} ${runId} ${sequence}`;
  const phone = `+420735${runId.slice(6, 10)}${sequence}`;
  const email = `delivered+${emailKey}@resend.dev`;
  const message = `Automated checkout e2e ${flowId} ${runId} ${sequence}`;

  return { email, message, name, phone };
};

export const makeCoworkCheckoutData = (
  checkoutBaseUrl: string,
  date: string,
  flowId = "cowork-basic"
): CheckoutData => {
  const locale: CheckoutData["locale"] = "en-US";
  const contact = makeCheckoutContact(flowId);
  const params = new URLSearchParams({
    coffee: "false",
    date,
    email: contact.email,
    entryTier: "basic",
    message: contact.message,
    name: contact.name,
    phone: contact.phone,
  });

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/checkout/order?${params}`,
    date,
    email: contact.email,
    expectedCoffee: false,
    expectedMonitorOption: null,
    expectedProductTier: "basic",
    locale,
    message: contact.message,
    name: contact.name,
    orderIdHint: "",
    phone: contact.phone,
  };
};

const makeMeetingRoomCheckoutData = (
  checkoutBaseUrl: string,
  slot: MeetingRoomSlot
): CheckoutData => {
  const locale: CheckoutData["locale"] = "en-US";
  const contact = makeCheckoutContact("meeting-room-60");

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/checkout/reservation/meeting-room`,
    date: slot.date,
    email: contact.email,
    expectedCoffee: false,
    expectedEndsAt: slot.endsAt,
    expectedMonitorOption: null,
    expectedProductTier: "meeting-room",
    expectedStartsAt: slot.startsAt,
    locale,
    message: contact.message,
    name: contact.name,
    orderIdHint: "",
    phone: contact.phone,
    startDateTime: slot.startDateTime,
  };
};

export const requireCheckoutDate = (
  dates: readonly string[],
  index: number
): Effect.Effect<string, WorkspaceE2EError> =>
  effectifySync("select checkout date", () => {
    const date = dates[index];
    assert(date, `missing checkout date ${index + 1}`);
    return date;
  });

export const selectAvailableCoworkDates = (
  config: WorkspaceE2EConfig,
  count: number
): Effect.Effect<readonly string[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const from = futureIsoDate(14);
    const to = futureIsoDate(90);
    const params = new URLSearchParams({ entryTier: "basic", from, to });
    const response = yield* effectifyPromise(
      "fetch workspace availability dates",
      () =>
        fetch(`${config.browserUrl}/api/workspace/availability?${params}`, {
          headers: config.bypassSecret
            ? { "x-vercel-protection-bypass": config.bypassSecret }
            : undefined,
        })
    );
    yield* effectifySync("assert availability response", () =>
      assert(response.ok, `availability check failed with ${response.status}`)
    );

    const availability = (yield* effectifyPromise(
      "read workspace availability response",
      () => response.json()
    )) as {
      readonly unavailableDates?: unknown;
    };
    const unavailable = yield* effectifySync(
      "parse workspace availability dates",
      () => {
        assert(
          Array.isArray(availability.unavailableDates),
          "availability response missing unavailableDates"
        );
        return new Set(
          availability.unavailableDates.filter(
            (date): date is string => typeof date === "string"
          )
        );
      }
    );

    const dates: string[] = [];
    for (let offset = 14; offset <= 90; offset += 1) {
      const date = futureIsoDate(offset);
      if (!isWeekday(date) || unavailable.has(date)) continue;
      dates.push(date);
      if (dates.length === count) {
        log(`Selected available checkout dates ${dates.join(", ")}`);
        return dates;
      }
    }

    return yield* Effect.fail(
      workspaceE2EError(
        `Only found ${dates.length} available checkout dates, need ${count}`,
        { operation: "select available cowork checkout dates" }
      )
    );
  });

const selectAvailableMeetingRoomSlot = (
  config: WorkspaceE2EConfig
): Effect.Effect<MeetingRoomSlot, WorkspaceE2EError> =>
  Effect.gen(function* () {
    for (let offset = 14; offset <= 90; offset += 1) {
      const date = futureIsoDate(offset);
      if (!isWeekday(date)) continue;

      const startDateTime = `${date}T10:00`;
      const interval = yield* effectifySync(
        "create meeting-room checkout interval",
        () => {
          const value = getMeetingRoomReservationInterval(startDateTime, 60);
          assert(value, "meeting-room test interval could not be created");
          return value;
        }
      );
      const params = new URLSearchParams({
        _tag: "meeting-room",
        date,
        endsAt: interval.endsAt,
        from: date,
        startsAt: interval.startsAt,
        to: getMeetingRoomAvailabilityToDate(interval),
      });
      const response = yield* effectifyPromise(
        "fetch meeting-room availability",
        () =>
          fetch(`${config.browserUrl}/api/workspace/availability?${params}`, {
            headers: config.bypassSecret
              ? { "x-vercel-protection-bypass": config.bypassSecret }
              : undefined,
          })
      );
      yield* effectifySync("assert meeting-room availability response", () =>
        assert(
          response.ok,
          `meeting-room availability check failed with ${response.status}`
        )
      );

      const availability = (yield* effectifyPromise(
        "read meeting-room availability response",
        () => response.json()
      )) as {
        readonly meetingRoomUnavailable?: unknown;
        readonly unavailableDates?: unknown;
      };
      const isAvailable = yield* effectifySync(
        "parse meeting-room availability",
        () => {
          const unavailableDates = Array.isArray(availability.unavailableDates)
            ? availability.unavailableDates
            : [];
          return (
            !unavailableDates.includes(date) &&
            availability.meetingRoomUnavailable !== true
          );
        }
      );
      if (!isAvailable) continue;

      log(`Selected available meeting-room slot ${startDateTime}`);
      return {
        date,
        endsAt: interval.endsAt,
        startDateTime,
        startsAt: interval.startsAt,
      };
    }

    return yield* Effect.fail(
      workspaceE2EError("No available meeting-room checkout slot found", {
        operation: "select available meeting-room checkout slot",
      })
    );
  });

const futureIsoDate = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const isWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
};
