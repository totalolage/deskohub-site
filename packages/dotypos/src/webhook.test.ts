import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  parseDotyposWebhookPayload,
  verifyDotyposWebhookRequest,
} from "./webhook";

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

  test("classifies reservation records when optional fields drift", async () => {
    const payload = await Effect.runPromise(
      parseDotyposWebhookPayload([
        { ...reservationRecord, created: null, note: 123 },
      ])
    );

    expect(payload.kind).toBe("reservation");
    expect(payload.records[0]?.reservationid).toBe(321);
    expect(payload.records[0]?.created).toBeUndefined();
    expect(payload.records[0]?.note).toBeUndefined();
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

describe("verifyDotyposWebhookRequest", () => {
  const request = (body: BodyInit, secret = "webhook-secret") =>
    new Request(
      `https://example.test/dotypos${secret ? `?secret=${secret}` : ""}`,
      { method: "POST", body }
    );

  test("verifies the secret and parses reservation records", async () => {
    const payload = await Effect.runPromise(
      verifyDotyposWebhookRequest(
        request(JSON.stringify([reservationRecord])),
        {
          requireSecret: true,
          secret: "webhook-secret",
        }
      )
    );

    expect(payload.kind).toBe("reservation");
    expect(payload.records[0]?.reservationid).toBe(321);
  });

  test("rejects missing or invalid secrets", async () => {
    for (const secret of ["", "wrong-secret"]) {
      const result = await Effect.runPromise(
        verifyDotyposWebhookRequest(
          request(JSON.stringify([reservationRecord]), secret),
          {
            requireSecret: true,
            secret: "webhook-secret",
          }
        ).pipe(Effect.result)
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("DotyposWebhookAuthError");
      }
    }
  });

  test("skips secret checks when not required", async () => {
    const payload = await Effect.runPromise(
      verifyDotyposWebhookRequest(
        request(JSON.stringify([reservationRecord]), ""),
        {
          requireSecret: false,
          secret: "unused-test-secret",
        }
      )
    );

    expect(payload.kind).toBe("reservation");
  });

  test("rejects invalid JSON", async () => {
    const result = await Effect.runPromise(
      verifyDotyposWebhookRequest(request("not json"), {
        requireSecret: true,
        secret: "webhook-secret",
      }).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("DotyposWebhookPayloadError");
      expect(result.failure.message).toBe("Failed to parse request body");
    }
  });
});
