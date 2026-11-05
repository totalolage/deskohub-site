import { describe, expect, test } from "bun:test";
import {
  type Customer as DotyposCustomer,
  DotyposService,
} from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { AdministrationCustomerSearchResult } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  getAdminDiscountCodeUsage,
  makeDiscountAdministrationReads,
  toAdminDotyposCustomer,
} from "./discount-administration-reads";

describe("discount administration read models", () => {
  test("counts reserved and redeemed claims against capacity but excludes releases", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 5,
        states: ["reserved", "redeemed", "released", "released"],
      })
    ).toEqual({
      reservedUses: 1,
      redeemedUses: 1,
      releasedUses: 2,
      remainingUses: 3,
    });
  });

  test("keeps unlimited capacity and floors exhausted codes at zero", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: null,
        states: ["redeemed"],
      }).remainingUses
    ).toBeNull();
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 1,
        states: ["reserved", "redeemed"],
      }).remainingUses
    ).toBe(0);
  });
});

describe("discount administration customers", () => {
  const unnamed = { id: "dotypos-customer" } as DotyposCustomer;

  test("signals a customer without a name or contact detail", () => {
    expect(toAdminDotyposCustomer(unnamed)).toMatchObject({
      displayName: "Unnamed customer",
      hasName: false,
    });
    expect(
      toAdminDotyposCustomer({ ...unnamed, phone: " +420 123 456 789 " })
    ).toMatchObject({ displayName: "+420 123 456 789", hasName: true });
  });

  test("keeps the administration API customer shape unchanged", () => {
    const encoded = Schema.encodeSync(AdministrationCustomerSearchResult)({
      kind: "matched",
      customers: [toAdminDotyposCustomer(unnamed)],
    });

    expect(encoded.customers[0]).toEqual({
      id: "dotypos-customer",
      displayName: "Unnamed customer",
      email: null,
      phone: null,
      discountGroupId: null,
    });
  });
});

describe("discount administration customer search", () => {
  const searchCustomers = async (found: readonly DotyposCustomer[]) => {
    const recording = await makeRecordingWorkspaceDatabase();
    const queries: string[] = [];
    const result = await Effect.gen(function* () {
      const reads = yield* makeDiscountAdministrationReads;
      return yield* reads.searchCustomers({ query: "novak" });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          recording.layer,
          Layer.mock(GoogleCalendarService, {}),
          Layer.mock(DotyposService, {
            searchCustomers: (query) => {
              queries.push(query);
              return Effect.succeed([...found]);
            },
          }),
          Layer.mock(CalendarResourceConfig, {
            salesCalendarId: "sales-calendar" as never,
          })
        )
      ),
      Effect.runPromise
    );
    return { queries, result };
  };
  const customer = (id: string, overrides: Partial<DotyposCustomer> = {}) =>
    ({ id, firstName: "Jana", lastName: id, ...overrides }) as DotyposCustomer;

  test("reports no match when every found customer is deleted", async () => {
    const { queries, result } = await searchCustomers([
      customer("deleted", { deleted: true }),
      customer("also-deleted", { deleted: true }),
    ]);

    expect(queries).toEqual(["novak"]);
    expect(result).toEqual({ kind: "not-found", customers: [] });
  });

  test("matches a single active customer", async () => {
    const { result } = await searchCustomers([
      customer("deleted", { deleted: true }),
      customer("active"),
    ]);

    expect(result.kind).toBe("matched");
    expect(result.customers.map(({ id }) => id)).toEqual(["active"]);
  });

  test("lists at most fifty customers of an ambiguous search in Dotypos order", async () => {
    const found = Array.from({ length: 52 }, (_, index) =>
      customer(`customer-${index}`)
    );
    const { result } = await searchCustomers(found);

    expect(result.kind).toBe("ambiguous");
    expect(result.customers.map(({ id }) => id)).toEqual(
      found.slice(0, 50).map(({ id }) => id)
    );
  });
});
