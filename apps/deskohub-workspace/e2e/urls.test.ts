import { expect, test } from "bun:test";
import { isExpectedCheckoutStatusUrl } from "./urls";

test("requires checkout status returns to use the expected preview host", () => {
  const expectedHost = "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app";

  expect(
    isExpectedCheckoutStatusUrl(
      `https://${expectedHost}/en-US/checkout/status/order-1`,
      expectedHost
    )
  ).toBe(true);
  expect(
    isExpectedCheckoutStatusUrl(
      "https://deskohub-workspace-git-feature-deskohub-bar.vercel.app/en-US/checkout/status/order-1",
      expectedHost
    )
  ).toBe(false);
  expect(
    isExpectedCheckoutStatusUrl(
      `https://${expectedHost}/en-US/contact`,
      expectedHost
    )
  ).toBe(false);
  expect(isExpectedCheckoutStatusUrl("not a URL", expectedHost)).toBe(false);
});
