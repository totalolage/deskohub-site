import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationIntervalInput,
  officeReservationDetailsSchema,
} from "@/features/reservation/office-reservation";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import {
  formatWorkspaceE2EAllocation,
  getWorkspaceE2ECandidateDate,
  isWorkspaceE2EAllocatedWeekday,
  type WorkspaceE2EDateAllocation,
  workspaceE2EConcurrentRunTarget,
  workspaceE2EFullDateAllocation,
} from "../allocation";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  workspaceE2EOfficeReservationDayCount,
  workspaceE2EOfficeReservationSeats,
} from "../office";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutFlow } from "../types";

export type MeetingRoomCheckoutSlot = {
  readonly date: string;
  readonly duration: MeetingRoomReservationDuration;
  readonly endsAt: ReservationInterval["endsAt"];
  readonly startDateTime: string;
  readonly startsAt: ReservationInterval["startsAt"];
};

export type MeetingRoomAvailability = {
  readonly meetingRoomUnavailable: boolean;
  readonly unavailableDates: readonly string[];
};

export type OfficeCheckoutSlot = {
  readonly endsAt: ReservationInterval["endsAt"];
  readonly endsOn: string;
  readonly seats: number;
  readonly startsAt: ReservationInterval["startsAt"];
  readonly startsOn: string;
};

export type OfficeAvailability = {
  readonly officeUnavailable: boolean;
  readonly unavailableDates: readonly string[];
};

export type CoworkAvailabilitySelection = {
  readonly allocation?: WorkspaceE2EDateAllocation;
  readonly entryTier?: WorkspaceCoworkProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

let checkoutContactSequence = 0;
const emailLocalPartLimit = 64;
const deliveredEmailPrefix = "delivered+";
const decodeOfficeReservationDetails = Schema.decodeUnknownSync(
  officeReservationDetailsSchema
);

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
  flowId = `meeting-room-${getMeetingRoomReservationDurationKey(
    slot.duration
  ).replace(":", "-")}`
): CheckoutData => {
  const contact = makeCheckoutContact(flowId);
  return makeMeetingRoomCheckoutDataWithContact(checkoutBaseUrl, slot, contact);
};

export const makeOfficeCheckoutData = (
  checkoutBaseUrl: string,
  slot: OfficeCheckoutSlot,
  flowId = "office-paid-multi-day"
): CheckoutData => {
  const contact = makeCheckoutContact(flowId);
  const locale: CheckoutData["locale"] = "en-US";

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/reservation/office`,
    date: slot.startsOn,
    email: contact.email,
    expectedReservationDetails: { kind: "office" },
    locale,
    message: contact.message,
    name: contact.name,
    office: slot,
    orderIdHint: "",
    phone: contact.phone,
  };
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
  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/reservation/meeting-room`,
    date: slot.date,
    email: contact.email,
    expectedReservationDetails: { kind: "meeting-room" },
    locale,
    meetingRoom: {
      duration: slot.duration,
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
    allocation,
    entryTier = "basic",
    excludedDates = new Set<string>(),
    maximumReservationsPerDate,
    monitorOption,
  }: {
    readonly entryTier?: WorkspaceCoworkProductTier;
    readonly excludedDates?: ReadonlySet<string>;
    readonly monitorOption?: WorkspaceProductMonitorOption;
    readonly allocation?: WorkspaceE2EDateAllocation;
    readonly maximumReservationsPerDate?: number;
  } = {}
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const availableDates = yield* loadAvailableCoworkDates(config, {
      allocation,
      entryTier,
      monitorOption,
    });

    return yield* selectCoworkDates(availableDates, count, {
      allocation,
      excludedDates,
      maximumReservationsPerDate,
      selectionLabel: makeCoworkSelectionLabel(entryTier, monitorOption),
    });
  });

export const loadAvailableCoworkDates = (
  config: WorkspaceE2EConfig,
  {
    allocation = workspaceE2EFullDateAllocation,
    entryTier = "basic",
    monitorOption,
  }: CoworkAvailabilitySelection = {}
): Effect.Effect<readonly string[], WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const from = getWorkspaceE2ECandidateDate(allocation.fromOffsetDays);
    const to = getWorkspaceE2ECandidateDate(allocation.toOffsetDays);
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

    const allocatedDates: string[] = [];
    for (
      let offset = allocation.fromOffsetDays;
      offset <= allocation.toOffsetDays;
      offset += 1
    ) {
      const date = getWorkspaceE2ECandidateDate(offset);
      if (isWorkspaceE2EAllocatedWeekday(date, allocation)) {
        allocatedDates.push(date);
      }
    }

    return allocatedDates.filter((date) => !unavailable.has(date));
  });

export const selectCoworkDates = (
  availableDates: readonly string[],
  count: number,
  {
    allocation,
    excludedDates = new Set<string>(),
    maximumReservationsPerDate = 1,
    selectionLabel = "cowork",
  }: {
    readonly allocation?: WorkspaceE2EDateAllocation;
    readonly excludedDates?: ReadonlySet<string>;
    readonly maximumReservationsPerDate?: number;
    readonly selectionLabel?: string;
  } = {}
): Effect.Effect<readonly string[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    if (
      !Number.isSafeInteger(maximumReservationsPerDate) ||
      maximumReservationsPerDate <= 0
    ) {
      return yield* workspaceE2EError(
        "Maximum cowork reservations per date must be a positive integer",
        { operation: "select available cowork checkout dates" }
      );
    }
    const dates = availableDates
      .filter((date) => !excludedDates.has(date))
      .flatMap((date) =>
        Array.from({ length: maximumReservationsPerDate }, () => date)
      )
      .slice(0, count);

    if (dates.length === count) {
      log(`Selected available checkout dates ${dates.join(", ")}`);
      return dates;
    }

    const allocationDiagnostic = allocation
      ? ` in ${formatWorkspaceE2EAllocation(allocation)} for supported concurrency ${workspaceE2EConcurrentRunTarget}`
      : "";
    return yield* workspaceE2EError(
      `Only found ${dates.length} available checkout dates for ${selectionLabel}${allocationDiagnostic}, need ${count}`,
      { operation: "select available cowork checkout dates" }
    );
  });

export const selectAvailableMeetingRoomSlots = (
  config: WorkspaceE2EConfig,
  durations: readonly MeetingRoomReservationDuration[],
  allocation: WorkspaceE2EDateAllocation = workspaceE2EFullDateAllocation
): Effect.Effect<
  readonly MeetingRoomCheckoutSlot[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const slots: (MeetingRoomCheckoutSlot | undefined)[] = Array.from({
      length: durations.length,
    });
    const pendingDurations = new Map(
      durations.map((duration, index) => [index, duration])
    );
    const reservedDates = new Set<string>();
    const allocatedDates = Array.from(
      {
        length: allocation.toOffsetDays - allocation.fromOffsetDays + 1,
      },
      (_, index) =>
        getWorkspaceE2ECandidateDate(allocation.fromOffsetDays + index)
    ).filter((date) => isWorkspaceE2EAllocatedWeekday(date, allocation));
    let nextDateIndex = 0;

    while (pendingDurations.size > 0) {
      const roundDates = new Set(reservedDates);
      const candidates: {
        readonly index: number;
        readonly slot: MeetingRoomCheckoutSlot;
      }[] = [];

      for (const [index, duration] of pendingDurations) {
        let slot: MeetingRoomCheckoutSlot | undefined;

        while (nextDateIndex < allocatedDates.length && !slot) {
          const date = allocatedDates[nextDateIndex];
          nextDateIndex += 1;
          if (!date) continue;

          const candidate = yield* makeMeetingRoomCheckoutSlot(date, duration);
          if (getTouchedDates(candidate).some((day) => roundDates.has(day))) {
            continue;
          }
          slot = candidate;
        }

        if (!slot) {
          return yield* workspaceE2EError(
            `No available reservation:meeting-room ${getMeetingRoomReservationDurationKey(duration)} slot found in ${formatWorkspaceE2EAllocation(allocation)} for supported concurrency ${workspaceE2EConcurrentRunTarget}`,
            { operation: "select available meeting-room checkout slots" }
          );
        }

        candidates.push({ index, slot });
        for (const date of getTouchedDates(slot)) roundDates.add(date);
      }

      const checkedCandidates = yield* Effect.forEach(
        candidates,
        ({ index, slot }) =>
          loadMeetingRoomAvailability(config, slot).pipe(
            Effect.map((availability) => ({ availability, index, slot }))
          ),
        { concurrency: "unbounded" }
      );

      for (const { availability, index, slot } of checkedCandidates) {
        if (
          availability.meetingRoomUnavailable ||
          availability.unavailableDates.length > 0
        ) {
          continue;
        }

        slots[index] = slot;
        pendingDurations.delete(index);
        for (const date of getTouchedDates(slot)) reservedDates.add(date);
        log(
          `Selected available ${getMeetingRoomReservationDurationKey(slot.duration)} meeting-room slot ${slot.startDateTime}`
        );
      }
    }

    return yield* tryWorkspaceE2ESync(
      "require selected meeting-room checkout slots",
      () => {
        assert(
          slots.every((slot) => slot !== undefined),
          "meeting-room checkout slot selection incomplete"
        );
        return slots as readonly MeetingRoomCheckoutSlot[];
      }
    );
  });

export const selectAvailableOfficeSlot = (
  config: WorkspaceE2EConfig,
  allocation: WorkspaceE2EDateAllocation = workspaceE2EFullDateAllocation
): Effect.Effect<
  OfficeCheckoutSlot,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const lastCandidateDate = getWorkspaceE2ECandidateDate(
      allocation.toOffsetDays
    );

    for (
      let offset = allocation.fromOffsetDays;
      offset <= allocation.toOffsetDays;
      offset += 1
    ) {
      const startsOn = getWorkspaceE2ECandidateDate(offset);
      if (
        Temporal.PlainDate.from(startsOn).dayOfWeek !== 4 ||
        !isWorkspaceE2EAllocatedWeekday(startsOn, allocation)
      ) {
        continue;
      }

      const slot = yield* makeOfficeCheckoutSlot(startsOn);
      if (slot.endsOn > lastCandidateDate) continue;

      const availability = yield* loadOfficeAvailability(config, slot);
      if (
        availability.officeUnavailable ||
        availability.unavailableDates.length > 0
      ) {
        continue;
      }

      log(
        `Selected available office range ${slot.startsOn} through ${slot.endsOn}`
      );
      return slot;
    }

    return yield* workspaceE2EError(
      `No available reservation:office ${workspaceE2EOfficeReservationDayCount}-day range with ${workspaceE2EOfficeReservationSeats} seats found in ${formatWorkspaceE2EAllocation(allocation)} for supported concurrency ${workspaceE2EConcurrentRunTarget}`,
      { operation: "select available office checkout range" }
    );
  });

const makeOfficeCheckoutSlot = (
  startsOn: string
): Effect.Effect<OfficeCheckoutSlot, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("create office checkout interval", () => {
    const endsOn = Temporal.PlainDate.from(startsOn)
      .add({ days: workspaceE2EOfficeReservationDayCount - 1 })
      .toString();
    const details = decodeOfficeReservationDetails({
      kind: "office",
      startsOn,
      endsOn,
      seats: workspaceE2EOfficeReservationSeats,
    });
    const interval = getOfficeReservationIntervalInput(details);

    return {
      startsOn,
      endsOn,
      seats: workspaceE2EOfficeReservationSeats,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
    };
  });

export const loadOfficeAvailability = (
  config: WorkspaceE2EConfig,
  slot: OfficeCheckoutSlot
): Effect.Effect<
  OfficeAvailability,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const params = new URLSearchParams({
      kind: "office",
      from: slot.startsOn,
      to: slot.endsOn,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      seats: String(slot.seats),
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
        toWorkspaceE2EError("fetch office availability", cause)
      ),
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(`office availability check failed with ${status}`, {
            operation: "fetch office availability",
          })
      )
    );
    const availability = (yield* response.json.pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read office availability response", cause)
      )
    )) as {
      readonly officeUnavailable?: unknown;
      readonly unavailableDates?: unknown;
    };

    return yield* tryWorkspaceE2ESync("parse office availability", () => {
      assert(
        typeof availability.officeUnavailable === "boolean",
        "availability response missing officeUnavailable"
      );
      assert(
        Array.isArray(availability.unavailableDates),
        "availability response missing unavailableDates"
      );
      return {
        officeUnavailable: availability.officeUnavailable,
        unavailableDates: availability.unavailableDates.filter(
          (date): date is string => typeof date === "string"
        ),
      };
    });
  });

const makeMeetingRoomCheckoutSlot = (
  date: string,
  duration: MeetingRoomReservationDuration
): Effect.Effect<MeetingRoomCheckoutSlot, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("create meeting-room checkout interval", () => {
    const startDateTime = `${date}T${
      isMeetingRoomWholeDayReservationDuration(duration) ? "00:00" : "10:00"
    }`;
    const interval = getMeetingRoomReservationInterval(startDateTime, duration);
    assert(interval, "meeting-room test interval could not be created");
    return {
      date: getMeetingRoomReservationDate(interval),
      duration,
      endsAt: interval.endsAt,
      startDateTime,
      startsAt: interval.startsAt,
    } satisfies MeetingRoomCheckoutSlot;
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

const makeCoworkSelectionLabel = (
  entryTier: WorkspaceCoworkProductTier,
  monitorOption: WorkspaceProductMonitorOption | undefined
) =>
  monitorOption
    ? `tier:${entryTier} with monitor:${monitorOption}`
    : `tier:${entryTier}`;

const getTouchedDates = (slot: MeetingRoomCheckoutSlot) => {
  const dates = [slot.date];
  const endDate = getMeetingRoomAvailabilityToDate(slot);
  if (endDate !== slot.date) dates.push(endDate);
  return dates;
};
