import { describe, expect, test } from "bun:test";
import { Exit, Schema } from "effect";
import {
  bookingFilterSchema,
  operationFilterSchema,
  orderFilterSchema,
  reservationFilterSchema,
} from "./filter-schemas";

describe("administration filter schemas", () => {
  test("accepts optional order dates and rejects non-calendar dates", () => {
    const valid = Schema.decodeUnknownExit(orderFilterSchema)({
      from: "2026-08-01",
      to: "",
    });
    const invalid = Schema.decodeUnknownExit(orderFilterSchema)({
      from: "2026-02-30",
      to: "2026-08-10",
    });

    expect(Exit.isSuccess(valid)).toBe(true);
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  test("requires a valid booking date", () => {
    const valid = Schema.decodeUnknownExit(bookingFilterSchema)({
      date: "2026-08-10",
      sort: "status",
      direction: "desc",
    });
    const invalid = Schema.decodeUnknownExit(bookingFilterSchema)({
      date: "",
      sort: "status",
      direction: "desc",
    });

    expect(Exit.isSuccess(valid)).toBe(true);
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  test("accepts the exact operation filter values and rejects unknown ones", () => {
    const valid = Schema.decodeUnknownExit(operationFilterSchema)({
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "BACKOFFICE",
      operationType: "REFUND",
    });
    const invalid = Schema.decodeUnknownExit(operationFilterSchema)({
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "OTHER",
      operationType: "REFUND",
    });

    expect(Exit.isSuccess(valid)).toBe(true);
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  test("supports parser reservation statuses and all three reservation types", () => {
    const valid = Schema.decodeUnknownExit(reservationFilterSchema)({
      status: "complete",
      type: "office",
      from: "",
      to: "2026-08-10",
      customerId: "customer-one",
      sort: "status",
      direction: "asc",
    });
    const invalid = Schema.decodeUnknownExit(reservationFilterSchema)({
      status: "pending",
      type: "office",
      from: "",
      to: "2026-08-10",
      customerId: "customer-one",
      sort: "status",
      direction: "asc",
    });

    expect(Exit.isSuccess(valid)).toBe(true);
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  test("accepts absent and explicitly undefined reservation customers", () => {
    const base = {
      status: "",
      type: "",
      from: "",
      to: "",
      sort: "created",
      direction: "desc",
    };
    const absent = Schema.decodeUnknownExit(reservationFilterSchema)(base);
    const explicitlyUndefined = Schema.decodeUnknownExit(
      reservationFilterSchema
    )({ ...base, customerId: undefined });

    expect(Exit.isSuccess(absent)).toBe(true);
    expect(Exit.isSuccess(explicitlyUndefined)).toBe(true);
  });
});
