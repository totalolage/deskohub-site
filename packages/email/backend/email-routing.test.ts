import { describe, expect, test } from "bun:test";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import {
  addressesOnlyTestRecipients,
  internalRecipientForOrigin,
  staffEmailSubject,
} from "./email-routing";
import { isTestEmailRecipient } from "./test-recipients";

const testRecipient = { email: testEmailAddress("ada") };
// Resend's simulator is a real destination, never a test recipient.
const realRecipient = { email: resendSimulatorAddress("delivered", "ada") };

describe("isTestEmailRecipient", () => {
  test("accepts any address on the test domain", () => {
    expect(isTestEmailRecipient(testRecipient.email)).toBe(true);
    expect(
      isTestEmailRecipient(` ${testEmailAddress("Workspace").toUpperCase()} `)
    ).toBe(true);
  });

  test("rejects Resend simulator, look-alike, and empty addresses", () => {
    for (const outcome of ["delivered", "bounced", "complained"] as const) {
      expect(isTestEmailRecipient(resendSimulatorAddress(outcome))).toBe(false);
    }
    expect(isTestEmailRecipient(`${testRecipient.email}.evil`)).toBe(false);
    expect(isTestEmailRecipient(testRecipient.email.replace("@", "@not"))).toBe(
      false
    );
    expect(isTestEmailRecipient("")).toBe(false);
  });
});

describe("addressesOnlyTestRecipients", () => {
  test("holds for mail addressed only to test recipients", () => {
    expect(addressesOnlyTestRecipients({ to: testRecipient })).toBe(true);
    expect(
      addressesOnlyTestRecipients({
        to: [testRecipient, { email: testEmailAddress("internal") }],
      })
    ).toBe(true);
  });

  test("fails for mail reaching any other recipient", () => {
    expect(addressesOnlyTestRecipients({ to: realRecipient })).toBe(false);
    expect(
      addressesOnlyTestRecipients({ to: [testRecipient, realRecipient] })
    ).toBe(false);
    expect(
      addressesOnlyTestRecipients({ to: testRecipient, cc: realRecipient })
    ).toBe(false);
    expect(
      addressesOnlyTestRecipients({ to: testRecipient, bcc: [realRecipient] })
    ).toBe(false);
  });
});

describe("internalRecipientForOrigin", () => {
  const mailbox = {
    real: {
      email: resendSimulatorAddress("delivered", "staff"),
      name: "Staff",
    },
    testLocalPart: "staff",
  };

  test("keeps staff copies of test-recipient requests on the test domain", () => {
    expect(internalRecipientForOrigin(testRecipient.email, mailbox)).toEqual({
      email: testEmailAddress("staff"),
      name: "Staff",
    });
  });

  test("sends staff copies of other requests to the real mailbox", () => {
    expect(internalRecipientForOrigin(realRecipient.email, mailbox)).toBe(
      mailbox.real
    );
  });
});
