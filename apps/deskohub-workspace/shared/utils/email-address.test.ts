import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { maskEmailAddress } from "./email-address";

const adaEmailAddress = testEmailAddress("ada");
const adaEmailDomain = adaEmailAddress.slice(adaEmailAddress.lastIndexOf("@"));

describe("maskEmailAddress", () => {
  test("keeps the first local-part character and the full domain", () => {
    expect(maskEmailAddress(adaEmailAddress)).toBe(`a•••${adaEmailDomain}`);
  });

  test("uses the last @ as the separator", () => {
    expect(maskEmailAddress(`ada@sub${adaEmailDomain}`)).toBe(
      `a•••${adaEmailDomain}`
    );
  });

  test("returns strings without @ or with a leading @ unchanged", () => {
    expect(maskEmailAddress("no-separator")).toBe("no-separator");
    expect(maskEmailAddress("@not-an-email")).toBe("@not-an-email");
  });

  test("masks a one-character local part", () => {
    const oneCharacterEmail = testEmailAddress("a");
    const domain = oneCharacterEmail.slice(oneCharacterEmail.lastIndexOf("@"));

    expect(maskEmailAddress(oneCharacterEmail)).toBe(`a•••${domain}`);
  });
});
