import { expect, test } from "bun:test";
import { applyDiscountCodeForm } from "./checkout-actions";

test("checkout visual action is unavailable and returns no application", async () => {
  const rendererGlobal = globalThis as typeof globalThis & {
    __accountVisualCheckoutActionCalls?: number;
  };
  rendererGlobal.__accountVisualCheckoutActionCalls = 0;

  const result = await applyDiscountCodeForm();

  expect(result).toEqual({
    serverError:
      "Unavailable in component renderer: checkout action was not executed.",
  });
  expect(result).not.toHaveProperty("data");
  expect(rendererGlobal.__accountVisualCheckoutActionCalls).toBe(1);
});
