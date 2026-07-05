import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { getConfirmedDotyposCustomerDiscount } from "./dotypos-customer-policy";

describe("getConfirmedDotyposCustomerDiscount", () => {
  test("fails closed when Dotypos customer lookup is ambiguous", async () => {
    const error = await getConfirmedDotyposCustomerDiscount({
      entryTier: "basic",
      date: "2026-07-01",
      coffee: false,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    }).pipe(
      Effect.provide(
        Layer.succeed(DotyposService, {
          findCustomer: mock(() => Effect.succeed({ _tag: "Ambiguous" })),
          getCustomerDiscount: mock(() => Effect.die("unused")),
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error._tag).toBe("AmbiguousDotyposCustomerError");
  });
});
