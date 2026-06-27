import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { parseDotyposWebhookPayload } from "./webhook";

const reservationRecord = {
  branchid: 123,
  cloudid: "123456789",
  created: 1782552480000,
  customerid: 456,
  deleted: 0,
  employeeid: 789,
  enddate: 1782638880000,
  flags: 0,
  note: null,
  reservationid: 321,
  seats: 1,
  startdate: 1782552480000,
  status: 1,
  tableid: 654,
  taglist: null,
  versiondate: 1782552480000,
};

describe("parseDotyposWebhookPayload", () => {
  test("classifies captured reservation record arrays", async () => {
    const payload = await Effect.runPromise(
      parseDotyposWebhookPayload([reservationRecord])
    );

    expect(payload.kind).toBe("reservation");
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]?.reservationid).toBe(321);
  });

  test("accepts unknown Dotypos record arrays without classifying them", async () => {
    const payload = await Effect.runPromise(
      parseDotyposWebhookPayload([{ productid: 123, name: "Coffee" }])
    );

    expect(payload).toMatchObject({ kind: "unknown" });
  });

  test("rejects non-array payloads", async () => {
    const result = await Effect.runPromiseExit(
      parseDotyposWebhookPayload({ reservationid: 321 })
    );

    expect(result._tag).toBe("Failure");
  });
});
