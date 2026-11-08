import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { signInStep } from "./sign-in-step";

describe("signInStep", () => {
  const email = testEmailAddress("ada");

  test("asks for the email until one is sent", () => {
    expect(signInStep(undefined, undefined)).toBe("email");
  });

  test("asks for the code when the email carries one", () => {
    expect(signInStep(undefined, { email, signInCode: true })).toBe("code");
  });

  test("points to the link alone when the email carries no code", () => {
    expect(signInStep(undefined, { email, signInCode: false })).toBe("link");
  });

  test("offers to continue a fresh session first", () => {
    expect(signInStep(email, undefined)).toBe("continue");
    expect(signInStep(email, { email, signInCode: false })).toBe("continue");
  });
});
