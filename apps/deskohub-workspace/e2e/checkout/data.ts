import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceMeetingRoomDurationMinutes,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import { getWorkspaceMeetingRoomReservationDuration } from "@/features/checkout/product-catalog";
import { isMeetingRoomWholeDayReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutFlow } from "../types";

export type MeetingRoomCheckoutSlot = {
  readonly date: string;
  readonly durationMinutes: WorkspaceMeetingRoomDurationMinutes;
  readonly endsAt: ReservationInterval["endsAt"];
  readonly startDateTime: string;
  readonly startsAt: ReservationInterval["startsAt"];
};

export type MeetingRoomAvailability = {
  readonly meetingRoomUnavailable: boolean;
  readonly unavailableDates: readonly string[];
};

let checkoutContactSequence = 0;
const emailLocalPartLimit = 64;
const deliveredEmailPrefix = "delivered+";

export const checkoutFlows: readonly CheckoutFlow[] = [
  {
    id: "cowork-basic",
    makeData: (config, _datasourceConfig, date) =>
      Effect.succeed(makeCoworkCheckoutData(config.baseUrl, date)),
    submitReservationScript: getSubmitCoworkReservationScript,
  },
];

const makeCheckoutContact = (flowId: string) => {
  checkoutContactSequence += 1;
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const sequence = String(checkoutContactSequence % 100).padStart(2, "0");
  const uniqueSuffix = randomUUID().slice(0, 8);
  const normalizedFlowId = flowId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const uniqueEmailKey = `${runId}-${sequence}-${uniqueSuffix}`;
  const maxEmailFlowIdLength =
    emailLocalPartLimit -
    deliveredEmailPrefix.length -
    uniqueEmailKey.length -
    1;
  const emailKey = `${normalizedFlowId.slice(0, maxEmailFlowIdLength)}-${uniqueEmailKey}`;
  const name = `Workspace E2E ${flowId} ${runId} ${sequence}`;
  const phone = `+4207${runId.slice(2, 8)}${sequence}`;
  const email = `${deliveredEmailPrefix}${emailKey}@resend.dev`;
  const message = `Automated checkout e2e ${flowId} ${runId} ${sequence}`;

  return { email, message, name, phone };
};

export const makeCoworkCheckoutData = (
  checkoutBaseUrl: string,
  date: string,
  flowId = "cowork-basic",
  product: {
    readonly coffee?: boolean;
    readonly entryTier?: WorkspaceCoworkProductTier;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  } = {}
): CheckoutData => {
  const contact = makeCheckoutContact(flowId);
  return makeCoworkCheckoutDataWithContact(
    checkoutBaseUrl,
    date,
    contact,
    product
  );
};

export const reuseCoworkCheckoutContact = (
  checkoutBaseUrl: string,
  date: string,
  source: CheckoutData,
  product: {
    readonly coffee?: boolean;
    readonly entryTier?: WorkspaceCoworkProductTier;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  } = {}
): CheckoutData =>
  makeCoworkCheckoutDataWithContact(
    checkoutBaseUrl,
    date,
    {
      email: source.email,
      message: source.message,
      name: source.name,
      phone: source.phone,
    },
    product
  );

export const makeMeetingRoomCheckoutData = (
  checkoutBaseUrl: string,
  slot: MeetingRoomCheckoutSlot,
  flowId = `meeting-room-${slot.durationMinutes}`
): CheckoutData => {
  const contact = makeCheckoutContact(flowId);
  return makeMeetingRoomCheckoutDataWithContact(checkoutBaseUrl, slot, contact);
};

export const reuseMeetingRoomCheckoutContact = (
  checkoutBaseUrl: string,
  slot: MeetingRoomCheckoutSlot,
  source: CheckoutData
): CheckoutData => {
  return makeMeetingRoomCheckoutDataWithContact(checkoutBaseUrl, slot, {
    email: source.email,
    message: source.message,
    name: source.name,
    phone: source.phone,
  });
};

const makeMeetingRoomCheckoutDataWithContact = (
  checkoutBaseUrl: string,
  slot: MeetingRoomCheckoutSlot,
  contact: ReturnType<typeof makeCheckoutContact>
): CheckoutData => {
  const locale: CheckoutData["locale"] = "en-US";
  const duration = getWorkspaceMeetingRoomReservationDuration(
    slot.durationMinutes
  );

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/reservation/meeting-room`,
    date: slot.date,
    email: contact.email,
    expectedReservationDetails: { kind: "meeting-room", duration },
    locale,
    meetingRoom: {
      durationMinutes: slot.durationMinutes,
      endsAt: slot.endsAt,
      startDateTime: slot.startDateTime,
      startsAt: slot.startsAt,
    },
    message: contact.message,
    name: contact.name,
    orderIdHint: "",
    phone: contact.phone,
  };
};

const makeCoworkCheckoutDataWithContact = (
  checkoutBaseUrl: string,
  date: string,
  contact: ReturnType<typeof makeCheckoutContact>,
  product: {
    readonly coffee?: boolean;
    readonly entryTier?: WorkspaceCoworkProductTier;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  }
): CheckoutData => {
  const locale: CheckoutData["locale"] = "en-US";
  const entryTier = product.entryTier ?? "basic";
  const normalizedProduct = makeExpectedCoworkProduct(entryTier, product);
  const params = new URLSearchParams({
    coffee: String(normalizedProduct.coffee),
    date,
    email: contact.email,
    entryTier: normalizedProduct.entryTier,
    message: contact.message,
    name: contact.name,
    phone: contact.phone,
  });
  if (normalizedProduct.monitorOption) {
    params.set("monitorOption", normalizedProduct.monitorOption);
  }

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/reservation/cowork?${params}`,
    date,
    email: contact.email,
    expectedReservationDetails: {
      kind: "cowork",
      ...normalizedProduct,
    },
    locale,
    message: contact.message,
    name: contact.name,
    orderIdHint: "",
    phone: contact.phone,
  };
};

const makeExpectedCoworkProduct = (
  entryTier: WorkspaceCoworkProductTier,
  product: {
    readonly coffee?: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  }
) => {
  switch (entryTier) {
    case "basic":
      return {
        coffee: product.coffee ?? false,
        entryTier,
      } as const;
    case "plus":
      return {
        coffee: true,
        entryTier,
      } as const;
    case "profi":
      return {
        coffee: true,
        entryTier,
        monitorOption: product.monitorOption ?? "2x27-qhd",
      } as const;
  }
};

export const requireCheckoutDate = (
  dates: readonly string[],
  index: number
): Effect.Effect<string, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("select checkout date", () => {
    const date = dates[index];
    assert(date, `missing checkout date ${index + 1}`);
    return date;
  });

export const selectAvailableCoworkDates = (
  config: WorkspaceE2EConfig,
  count: number,
  {
    entryTier = "basic",
    excludedDates = new Set<string>(),
    monitorOption,
  }: {
    readonly entryTier?: WorkspaceCoworkProductTier;
    readonly excludedDates?: ReadonlySet<string>;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  } = {}
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const from = futureIsoDate(14);
    const to = futureIsoDate(90);
    const params = new URLSearchParams({ entryTier, from, to });
    if (monitorOption) params.set("monitorOption", monitorOption);
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      `${config.baseUrl}/api/workspace/availability?${params}`
    ).pipe(
      HttpClientRequest.setHeaders(
        config.bypassSecret
          ? { "x-vercel-protection-bypass": config.bypassSecret }
          : {}
      )
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("fetch workspace availability dates", cause)
      ),
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(`availability check failed with ${status}`, {
            operation: "fetch workspace availability dates",
          })
      )
    );

    const availability = (yield* response.json.pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read workspace availability response", cause)
      )
    )) as {
      readonly unavailableDates?: unknown;
    };
    const unavailable = yield* tryWorkspaceE2ESync(
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
      if (
        !isWeekday(date) ||
        unavailable.has(date) ||
        excludedDates.has(date)
      ) {
        continue;
      }
      dates.push(date);
      if (dates.length === count) {
        log(`Selected available checkout dates ${dates.join(", ")}`);
        return dates;
      }
    }

    return yield* workspaceE2EError(
      `Only found ${dates.length} available checkout dates, need ${count}`,
      { operation: "select available cowork checkout dates" }
    );
  });

export const selectAvailableMeetingRoomSlots = (
  config: WorkspaceE2EConfig,
  durations: readonly WorkspaceMeetingRoomDurationMinutes[]
): Effect.Effect<
  readonly MeetingRoomCheckoutSlot[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const slots: MeetingRoomCheckoutSlot[] = [];
    const reservedDates = new Set<string>();

    for (const durationMinutes of durations) {
      let selected: MeetingRoomCheckoutSlot | undefined;
      const duration =
        getWorkspaceMeetingRoomReservationDuration(durationMinutes);

      for (let offset = 14; offset <= 90; offset += 1) {
        const date = futureIsoDate(offset);
        if (!isWeekday(date) || reservedDates.has(date)) continue;

        const startDateTime = `${date}T${
          isMeetingRoomWholeDayReservationDuration(duration) ? "00:00" : "10:00"
        }`;
        const interval = yield* tryWorkspaceE2ESync(
          "create meeting-room checkout interval",
          () => {
            const value = getMeetingRoomReservationInterval(
              startDateTime,
              duration
            );
            assert(value, "meeting-room test interval could not be created");
            return value;
          }
        );
        const slot = {
          date: getMeetingRoomReservationDate(interval),
          durationMinutes,
          endsAt: interval.endsAt,
          startDateTime,
          startsAt: interval.startsAt,
        } satisfies MeetingRoomCheckoutSlot;
        const availability = yield* loadMeetingRoomAvailability(config, slot);

        if (
          availability.meetingRoomUnavailable ||
          availability.unavailableDates.length > 0
        ) {
          continue;
        }

        selected = slot;
        break;
      }

      if (!selected) {
        return yield* workspaceE2EError(
          `No available ${durationMinutes}-minute meeting-room checkout slot found`,
          { operation: "select available meeting-room checkout slots" }
        );
      }

      slots.push(selected);
      for (const date of getTouchedDates(selected)) reservedDates.add(date);
      log(
        `Selected available ${durationMinutes}-minute meeting-room slot ${selected.startDateTime}`
      );
    }

    return slots;
  });

export const loadMeetingRoomAvailability = (
  config: WorkspaceE2EConfig,
  slot: MeetingRoomCheckoutSlot
): Effect.Effect<
  MeetingRoomAvailability,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const params = new URLSearchParams({
      kind: "meeting-room",
      from: slot.date,
      to: getMeetingRoomAvailabilityToDate(slot),
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    });
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      `${config.baseUrl}/api/workspace/availability?${params}`
    ).pipe(
      HttpClientRequest.setHeaders(
        config.bypassSecret
          ? { "x-vercel-protection-bypass": config.bypassSecret }
          : {}
      )
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("fetch meeting-room availability", cause)
      ),
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(
            `meeting-room availability check failed with ${status}`,
            { operation: "fetch meeting-room availability" }
          )
      )
    );
    const availability = (yield* response.json.pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read meeting-room availability response", cause)
      )
    )) as {
      readonly meetingRoomUnavailable?: unknown;
      readonly unavailableDates?: unknown;
    };

    return yield* tryWorkspaceE2ESync("parse meeting-room availability", () => {
      assert(
        typeof availability.meetingRoomUnavailable === "boolean",
        "availability response missing meetingRoomUnavailable"
      );
      assert(
        Array.isArray(availability.unavailableDates),
        "availability response missing unavailableDates"
      );
      return {
        meetingRoomUnavailable: availability.meetingRoomUnavailable,
        unavailableDates: availability.unavailableDates.filter(
          (date): date is string => typeof date === "string"
        ),
      };
    });
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

const getTouchedDates = (slot: MeetingRoomCheckoutSlot) => {
  const dates = [slot.date];
  const endDate = getMeetingRoomAvailabilityToDate(slot);
  if (endDate !== slot.date) dates.push(endDate);
  return dates;
};
