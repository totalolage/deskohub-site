import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const { createContactEmailPreviews } = await import(
  "./create-contact-email-previews"
);

describe("createContactEmailPreviews", () => {
  test("renders the business notice and the customer confirmation", async () => {
    const { business, confirmation } = await createContactEmailPreviews(
      "en-US"
    ).pipe(Effect.runPromise);

    expect(business).toContain("Ada Lovelace");
    expect(business).toContain(testEmailAddress("customer"));
    expect(confirmation).toContain("<html");
    expect(confirmation).not.toBe(business);
  });

  test("renders each locale's emails separately", async () => {
    const [czech, english] = await Promise.all([
      createContactEmailPreviews("cs-CZ").pipe(Effect.runPromise),
      createContactEmailPreviews("en-US").pipe(Effect.runPromise),
    ]);

    expect(czech.confirmation).not.toBe(english.confirmation);
  });
});
