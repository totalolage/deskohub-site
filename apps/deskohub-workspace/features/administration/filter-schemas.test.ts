import { describe, expect, test } from "bun:test";
import {
  bookingFilterSchema,
  operationFilterSchema,
  orderFilterSchema,
  reservationFilterSchema,
} from "./filter-schemas";

describe("administration filter schemas", () => {
  test("accepts optional order dates and rejects non-calendar dates", async () => {
    const valid = await orderFilterSchema["~standard"].validate({
      from: "2026-08-01",
      to: "",
    });
    const invalid = await orderFilterSchema["~standard"].validate({
      from: "2026-02-30",
      to: "2026-08-10",
    });

    expect(valid.issues).toBeUndefined();
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  test("requires a valid booking date", async () => {
    const valid = await bookingFilterSchema["~standard"].validate({
      date: "2026-08-10",
      sort: "status",
      direction: "desc",
    });
    const invalid = await bookingFilterSchema["~standard"].validate({
      date: "",
      sort: "status",
      direction: "desc",
    });

    expect(valid.issues).toBeUndefined();
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  test("accepts the exact operation filter values and rejects unknown ones", async () => {
    const valid = await operationFilterSchema["~standard"].validate({
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "BACKOFFICE",
      operationType: "REFUND",
    });
    const invalid = await operationFilterSchema["~standard"].validate({
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "OTHER",
      operationType: "REFUND",
    });

    expect(valid.issues).toBeUndefined();
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  test("supports parser reservation statuses and all three reservation types", async () => {
    const valid = await reservationFilterSchema["~standard"].validate({
      status: "complete",
      type: "office",
      from: "",
      to: "2026-08-10",
      customerId: "customer-one",
      sort: "status",
      direction: "asc",
    });
    const invalid = await reservationFilterSchema["~standard"].validate({
      status: "pending",
      type: "office",
      from: "",
      to: "2026-08-10",
      customerId: "customer-one",
      sort: "status",
      direction: "asc",
    });

    expect(valid.issues).toBeUndefined();
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  test("accepts absent and explicitly undefined reservation customers", async () => {
    const base = {
      status: "",
      type: "",
      from: "",
      to: "",
      sort: "created",
      direction: "desc",
    };
    const absent = await reservationFilterSchema["~standard"].validate(base);
    const explicitlyUndefined = await reservationFilterSchema[
      "~standard"
    ].validate({ ...base, customerId: undefined });

    expect(absent.issues).toBeUndefined();
    expect(explicitlyUndefined.issues).toBeUndefined();
  });
});
