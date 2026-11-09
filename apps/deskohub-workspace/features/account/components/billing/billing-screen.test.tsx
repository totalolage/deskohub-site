import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { buttonVariants } = await import("@/shared/components/ui/button");
const { BillingScreen } = await import("./billing-screen");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("adding a payment card is a disabled tile action until cards are supported", () => {
  const view = render(
    <BillingScreen locale="en-US">
      <p>Billing details</p>
    </BillingScreen>
  );
  const addCard = view.getByRole("button", {
    name: m.accountBillingAddPaymentCard({}, { locale: "en-US" }),
  });

  expect(addCard).toHaveProperty("disabled", true);
  expect(addCard.getAttribute("type")).toBe("button");
  expect(addCard.className).toBe(buttonVariants({ variant: "tile" }));
});
