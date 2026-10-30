import { expect, test } from "bun:test";
import {
  EMAIL_TEST_DOMAIN,
  isTestEmailAddress,
  testEmailAddress,
} from "@deskohub/test-email";
import { routeEmailMessage } from "./email-routing";
import { isTestEmailRecipient } from "./test-recipients";

// These edge cases intentionally differ until auth and delivery policy is decided.
test.each([
  { address: testEmailAddress("recipient"), delivery: true, auth: true },
  {
    address: ` ${testEmailAddress("recipient")} `,
    delivery: true,
    auth: false,
  },
  { address: `@${EMAIL_TEST_DOMAIN}`, delivery: true, auth: false },
  {
    address: testEmailAddress("recipient").toUpperCase(),
    delivery: true,
    auth: true,
  },
  {
    address: testEmailAddress("recipient") + ".invalid",
    delivery: false,
    auth: false,
  },
])(
  "preserves recipient predicates for $address",
  ({ address, delivery, auth }) => {
    expect(isTestEmailRecipient(address)).toBe(delivery);
    expect(isTestEmailAddress(address)).toBe(auth);
    expect(routeEmailMessage({ to: { email: address } })).toBe(
      delivery ? "console" : "resend"
    );
  }
);
