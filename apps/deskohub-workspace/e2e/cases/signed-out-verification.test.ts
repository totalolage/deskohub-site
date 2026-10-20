import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import {
  makeCoworkCheckoutData,
  withCheckoutContactEmail,
} from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState } from "../types";
import {
  assertSavedCheckoutProfile,
  getSignedOutContactPrompt,
  isVerifiedContactReturnUrl,
  planSignedOutVerificationCase,
  signedOutVerificationCaseId,
} from "./signed-out-verification";

const config: WorkspaceE2EConfig = {
  baseUrl: "https://workspace.example.test",
  bypassSecret: undefined,
  expectedHost: "workspace.example.test",
  timeouts: workspaceE2ETimeouts,
};

const recipient = testEmailAddress("delivered+run-sov-account");

test("plans the signed-out checkout on its own date and requires binding", async () => {
  const flowStates: CheckoutFlowState[] = [
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-01") },
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-02") },
  ];
  const planned = await Effect.runPromise(
    planSignedOutVerificationCase({
      allocation: {
        fromOffsetDays: 0,
        shardCount: 1,
        shardIndex: 0,
        toOffsetDays: 0,
      },
      availableBasicDates: ["2099-08-01", "2099-08-02", "2099-08-03"],
      config,
      flowStates,
    })
  );

  expect(planned.id).toBe(signedOutVerificationCaseId);
  expect(planned.checkoutStates.map(({ data }) => data.date)).toEqual([
    "2099-08-03",
  ]);
  expect(flowStates.at(-1)).toBe(planned.checkoutStates[0]);
  const exit = await Effect.runPromiseExit(
    planned.execute({
      runStep: (step) => step.execute,
      session: "session",
    }) as Effect.Effect<void, unknown>
  );
  expect(Exit.isFailure(exit)).toBe(true);
});

test("types the run-scoped recipient at the contact step", () => {
  const planned = makeCoworkCheckoutData(
    config.baseUrl,
    "2099-08-03",
    signedOutVerificationCaseId
  );
  const bound = withCheckoutContactEmail(planned, recipient);
  const url = new URL(bound.checkoutUrl);

  expect(bound.email).toBe(recipient);
  expect(url.searchParams.get("email")).toBe(recipient);
  expect(url.searchParams.get("name")).toBe(planned.name);
  expect(url.searchParams.get("phone")).toBe(planned.phone);
  expect(bound.name).toBe(planned.name);
  expect(bound.phone).toBe(planned.phone);
});

test("expects the localized sign-in prompt on the signed-out contact step", () => {
  expect(getSignedOutContactPrompt("en-US")).toEqual({
    signInLabel: "Sign in",
    signInPathname: "/en-US/auth/sign-in",
    text: "Already a customer? Sign in",
  });
  const czech = getSignedOutContactPrompt("cs-CZ");
  expect(czech.text).toBe("Už u nás máš účet? Přihlas se");
  expect(czech.signInLabel).toBe("Přihlas se");
  expect(czech.signInPathname.startsWith("/cs-CZ/")).toBe(true);
});

test("recognizes the verified return to the same reservation contact step", () => {
  const checkoutUrl = `${config.baseUrl}/en-US/reservation/cowork?date=2099-08-03&email=x`;
  const returned = new URL(checkoutUrl);
  returned.searchParams.set("step", "contact");
  returned.searchParams.set("contact", "sealed");

  expect(isVerifiedContactReturnUrl(returned.toString(), checkoutUrl)).toBe(
    true
  );

  const withoutContact = new URL(returned);
  withoutContact.searchParams.delete("contact");
  const selectionStep = new URL(returned);
  selectionStep.searchParams.delete("step");
  const otherPage = new URL(returned);
  otherPage.pathname = "/en-US/auth/callback";
  for (const url of [withoutContact, selectionStep, otherPage]) {
    expect(isVerifiedContactReturnUrl(url.toString(), checkoutUrl)).toBe(false);
  }
  expect(isVerifiedContactReturnUrl("not a url", checkoutUrl)).toBe(false);
});

const contact = {
  email: recipient,
  name: "Workspace E2E checkout-signed-out-verification 20991019 01",
  phone: "+420712345601",
};

const savedProfile = {
  email: recipient,
  firstName: "Workspace",
  lastName: "E2E checkout-signed-out-verification 20991019 01",
  phone: "+420 712 345 601",
};

test("accepts the profile the verified checkout saved and linked", () => {
  expect(() =>
    assertSavedCheckoutProfile({
      contact,
      customerId: "customer",
      linkedCustomerId: "customer",
      profile: savedProfile,
    })
  ).not.toThrow();
});

test("rejects a booked profile the verified account is not linked to or that differs from the typed contact", () => {
  const cases = [
    { linkedCustomerId: undefined, profile: savedProfile },
    { linkedCustomerId: "other", profile: savedProfile },
    {
      linkedCustomerId: "customer",
      profile: { ...savedProfile, firstName: "Workspace E2E" },
    },
    {
      linkedCustomerId: "customer",
      profile: { ...savedProfile, phone: "+420700000000" },
    },
    {
      linkedCustomerId: "customer",
      profile: { ...savedProfile, email: testEmailAddress("someone") },
    },
  ];
  for (const { linkedCustomerId, profile } of cases) {
    expect(() =>
      assertSavedCheckoutProfile({
        contact,
        customerId: "customer",
        linkedCustomerId,
        profile,
      })
    ).toThrow();
  }
});
