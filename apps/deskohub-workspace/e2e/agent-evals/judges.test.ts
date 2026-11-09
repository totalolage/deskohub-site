import { describe, expect, test } from "bun:test";
import {
  type AgentEvalReservationRecord,
  agentEvalFacts,
  classifyAgentEvalFailure,
  judgeAgentEvalFacts,
  judgeAgentEvalReservation,
  toPragueLocal,
} from "./judges";

describe("judgeAgentEvalFacts", () => {
  test("the facts come from the catalog and site constants", () => {
    expect(agentEvalFacts.reservedDeskDailyPriceCzk).toBe(410);
    expect(agentEvalFacts.address.street).toBe("Turnovská 430/10");
  });

  test.each([
    [
      "an English answer",
      "A Reserved Desk costs CZK 410 per day. The space is open 24/7 with code access, at Turnovská 430/10, 180 00 Praha 8.",
    ],
    [
      "a Czech answer without diacritics",
      "Vyhrazene misto stoji 410 Kc na den, otevreno nonstop, adresa Turnovska 430/10, Praha 8.",
    ],
    [
      "a Czech answer with formatted amounts",
      "Cena: 410,00 Kč/den. Otevírací doba: nepřetržitě (24 hodin denně). Adresa: Turnovská 430/10, Libeň.",
    ],
  ])("passes %s with all three facts", (_label, answer) => {
    expect(judgeAgentEvalFacts(answer)).toEqual({
      reason: "matched",
      success: true,
    });
  });

  test("lists every fact the answer missed", () => {
    expect(
      judgeAgentEvalFacts(
        "A Reserved Desk costs 4100 CZK; open 9 to 17 at Turnovská 12."
      )
    ).toEqual({
      missingFacts: ["price", "opening-hours", "address"],
      reason: "missing-facts",
      success: false,
    });
  });
});

// 2027-02-18 is in Prague winter time (UTC+1).
const pragueMidnight = "2027-02-17T23:00:00.000Z";
const record = (
  overrides: Partial<AgentEvalReservationRecord>
): AgentEvalReservationRecord => ({
  createdAt: "2026-10-18T10:00:00Z",
  paid: false,
  product: { family: "cowork", tier: "open-space" },
  providerStatus: "NEW",
  startsAt: pragueMidnight,
  endsAt: "2027-02-18T16:00:00.000Z",
  ...overrides,
});

describe("toPragueLocal", () => {
  test("reads Prague-local dates across the DST change", () => {
    expect(toPragueLocal(pragueMidnight)).toEqual({
      date: "2027-02-18",
      time: "00:00",
    });
    expect(toPragueLocal("2027-07-01T08:00:00Z")).toEqual({
      date: "2027-07-01",
      time: "10:00",
    });
  });
});

describe("judgeAgentEvalReservation", () => {
  const openSpace = {
    date: "2027-02-18",
    taskId: "open-space-to-pay",
  } as const;

  test("passes an unpaid Open Space hold on the requested date", () => {
    expect(judgeAgentEvalReservation(openSpace, [record({})]).success).toBe(
      true
    );
  });

  test.each([
    ["no reservation", [], "no-reservation"],
    [
      "a reserved desk",
      [record({ product: { family: "cowork", tier: "reserved-desk" } })],
      "wrong-product",
    ],
    [
      "the next day",
      [record({ startsAt: "2027-02-18T23:00:00.000Z" })],
      "wrong-date",
    ],
    [
      "a cancelled hold",
      [record({ providerStatus: "CANCELLED" })],
      "reservation-cancelled",
    ],
    ["a paid booking", [record({ paid: true })], "paid-without-permission"],
  ])("fails Open Space with %s", (_label, records, reason) => {
    expect(judgeAgentEvalReservation(openSpace, records)).toEqual({
      reason,
      success: false,
    } as never);
  });

  test("judges the newest reservation, not an abandoned earlier draft", () => {
    const abandoned = record({
      createdAt: "2026-10-18T10:00:00Z",
      startsAt: "2027-02-18T23:00:00.000Z",
    });
    const final = record({ createdAt: "2026-10-18T10:05:00Z" });
    expect(
      judgeAgentEvalReservation(openSpace, [final, abandoned]).success
    ).toBe(true);
    expect(
      judgeAgentEvalReservation(openSpace, [
        abandoned,
        { ...final, createdAt: "2026-10-18T09:00:00Z" },
      ]).reason
    ).toBe("wrong-date");
  });

  test("fails a booking task when an earlier reservation was paid", () => {
    const paidEarlier = record({
      createdAt: "2026-10-18T10:00:00Z",
      paid: true,
      providerStatus: "CANCELLED",
    });
    const final = record({ createdAt: "2026-10-18T10:05:00Z" });
    expect(judgeAgentEvalReservation(openSpace, [final, paidEarlier])).toEqual({
      reason: "paid-without-permission",
      success: false,
    });
  });

  const meetingRoom = {
    date: "2027-02-18",
    expectedStartTime: "11:00",
    taskId: "meeting-room-to-pay",
  } as const;
  const meetingRoomRecord = (startsAt: string, endsAt: string, amount = 4) =>
    record({
      endsAt,
      product: { duration: { amount, unit: "hour" }, family: "meeting-room" },
      startsAt,
    });

  test.each([
    [
      "the first free start",
      meetingRoomRecord("2027-02-18T10:00:00Z", "2027-02-18T14:00:00Z"),
      "matched",
    ],
    [
      "10:00 when 11:00 was the first free start",
      meetingRoomRecord("2027-02-18T09:00:00Z", "2027-02-18T13:00:00Z"),
      "wrong-time",
    ],
    [
      "one hour",
      meetingRoomRecord("2027-02-18T10:00:00Z", "2027-02-18T11:00:00Z", 1),
      "wrong-duration",
    ],
    [
      "another day",
      meetingRoomRecord("2027-02-19T10:00:00Z", "2027-02-19T14:00:00Z"),
      "wrong-date",
    ],
  ])("judges a meeting room booked for %s", (_label, booked, reason) => {
    expect(judgeAgentEvalReservation(meetingRoom, [booked]).reason).toBe(
      reason
    );
  });

  test("derives a meeting room's duration from Dotypos when the row lacks it", () => {
    expect(
      judgeAgentEvalReservation(meetingRoom, [
        record({
          endsAt: "2027-02-18T14:00:00Z",
          product: { family: "meeting-room" },
          startsAt: "2027-02-18T10:00:00Z",
        }),
      ]).success
    ).toBe(true);
  });

  const office = { startDate: "2027-02-18", taskId: "office-to-pay" } as const;
  const officeRecord = (
    product: Partial<{ seats: number; dayCount: number }>,
    seats = 2
  ) =>
    record({
      endsAt: "2027-02-20T23:00:00.000Z",
      product: { family: "office", ...product },
      seats,
    });

  test.each([
    ["2 seats for 3 days", officeRecord({ dayCount: 3, seats: 2 }), "matched"],
    ["a legacy row read from Dotypos", officeRecord({}), "matched"],
    ["2 days", officeRecord({ dayCount: 2, seats: 2 }), "wrong-date"],
    ["1 seat", officeRecord({ dayCount: 3, seats: 1 }), "wrong-seats"],
  ])("judges an office booked for %s", (_label, booked, reason) => {
    expect(judgeAgentEvalReservation(office, [booked]).reason).toBe(reason);
  });

  const payment = { date: "2027-02-18", taskId: "open-space-payment" } as const;

  test.each([
    [
      "an unpaid hold",
      record({}),
      { confirmed: false, reachedByAgent: true },
      "not-paid",
    ],
    [
      "a payment whose status page the agent never reached",
      record({ paid: true }),
      { confirmed: true, reachedByAgent: false },
      "status-not-reached",
    ],
    [
      "an unconfirmed status page",
      record({ paid: true }),
      { confirmed: false, reachedByAgent: true },
      "status-not-confirmed",
    ],
    [
      "a paid, confirmed reservation",
      record({ paid: true }),
      { confirmed: true, reachedByAgent: true },
      "matched",
    ],
  ])("judges payment with %s", (_label, booked, statusPage, reason) => {
    expect(
      judgeAgentEvalReservation(payment, [booked], statusPage).reason
    ).toBe(reason);
  });
});

describe("classifyAgentEvalFailure", () => {
  const failed = (
    reason: Parameters<
      typeof classifyAgentEvalFailure
    >[0]["judgement"]["reason"]
  ) => ({
    reason,
    success: false,
  });

  test.each([
    ["wrong-date", [], "date-picker"],
    ["wrong-time", [], "date-picker"],
    ["wrong-seats", [], "form-control"],
    ["not-paid", ["pay", "payment-provider"], "payment-tab"],
    ["no-reservation", ["sign-in"], "sign-in"],
    ["no-reservation", ["site"], "navigation"],
    ["no-reservation", ["reservation-office"], "form-control"],
  ] as const)(
    "attributes %s with routes %j to %s",
    (reason, routes, category) => {
      expect(
        classifyAgentEvalFailure({
          harnessOutcome: "completed",
          judgement: failed(reason),
          observations: { routes },
          taskId: "office-to-pay",
        })
      ).toBe(category);
    }
  );

  test("blames neither the site nor the agent for a harness that never ran", () => {
    expect(
      classifyAgentEvalFailure({
        harnessOutcome: "spawn-failure",
        judgement: failed("no-reservation"),
        observations: { routes: [] },
        taskId: "office-to-pay",
      })
    ).toBe("other");
  });

  test("passing runs have no category", () => {
    expect(
      classifyAgentEvalFailure({
        harnessOutcome: "completed",
        judgement: { reason: "matched", success: true },
        observations: { routes: [] },
        taskId: "facts",
      })
    ).toBeNull();
  });
});
