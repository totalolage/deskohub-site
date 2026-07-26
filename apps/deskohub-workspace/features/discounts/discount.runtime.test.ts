import "@/shared/testing/workspace-test-env";
import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { DiscountService } from "./discount.service";

mock.module("server-only", () => ({}));

test("memoizes the production Discount service across runtime layer builds", async () => {
  const { DiscountServiceLiveWithDependencies } = await import(
    "./discount.runtime"
  );
  const acquireDiscountService = Effect.gen(function* () {
    return yield* DiscountService;
  }).pipe(Effect.provide(DiscountServiceLiveWithDependencies));

  const first = await Effect.runPromise(acquireDiscountService);
  const second = await Effect.runPromise(acquireDiscountService);

  expect(second).toBe(first);
});
