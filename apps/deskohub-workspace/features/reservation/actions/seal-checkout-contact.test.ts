import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Option } from "effect";
import type { Locale } from "@/features/i18n";
import type { ReservationCheckoutContact } from "@/features/reservation/reservation-checkout-contact";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";

mock.module("server-only", () => ({}));

type SealHandler = (
  input: ReservationCheckoutContact,
  context: { readonly locale: Locale }
) => Effect.Effect<{ readonly token: string }>;

type SealOptions = {
  readonly schema: (
    locale: Locale
  ) => StandardSchemaV1<unknown, ReservationCheckoutContact>;
};

let defined:
  | { readonly options: SealOptions; readonly handler: SealHandler }
  | undefined;

// The action pipeline, including building the schema for the action's
// locale, is covered by the workspace action tests; here the action's own
// schema and handler run directly.
mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction: (options: SealOptions, handler: SealHandler) => {
    defined = { options, handler };
    return async () => undefined;
  },
}));

await import("./seal-checkout-contact");
const { checkoutContactReturnState } = await import(
  "@/features/reservation/backend/checkout-contact-return-state"
);

const action = () => {
  if (!defined) throw new Error("The seal action was not defined");
  return defined;
};

const contactWithPhone = (phone: string): ReservationCheckoutContact => ({
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone,
  billing: { purpose: "personal", invoice: "none" },
  marketingConsent: true,
});

const validate = async (
  locale: Locale,
  input: ReservationCheckoutContact & { readonly locale?: Locale }
) => await action().options.schema(locale)["~standard"].validate(input);

const sealUnder = async (locale: Locale, phone: string) => {
  const result = await validate(locale, contactWithPhone(phone));
  if (result.issues) return { sealed: false as const };
  const { token } = await Effect.runPromise(
    action().handler(result.value, { locale })
  );
  return { sealed: true as const, token };
};

const reopen = (token: string, pageLocale: Locale) =>
  Effect.runPromise(
    checkoutContactReturnState
      .open(token, pageLocale)
      .pipe(Effect.option, Effect.provide(TestSealedStateKeys))
  ).then(Option.getOrUndefined);

describe("sealing a checkout contact", () => {
  test.each([
    ["de-DE", "0151 23456789", "cs-CZ"],
    ["uk-UA", "050 123 4567", "cs-CZ"],
  ] as const)(
    "seals a %s national number (%s) that %s rejects",
    async (locale, phone, otherLocale) => {
      expect(await sealUnder(locale, phone)).toMatchObject({ sealed: true });
      expect(await sealUnder(otherLocale, phone)).toEqual({ sealed: false });
    }
  );

  test.each(["cs-CZ", "en-US", "de-DE", "uk-UA"] as const)(
    "seals a number with a country calling code under %s",
    async (locale) => {
      expect(await sealUnder(locale, "+420 777 123 456")).toMatchObject({
        sealed: true,
      });
    }
  );

  test("seals the action's locale, so the phone reopens in its region", async () => {
    const sealed = await sealUnder("de-DE", "0151 23456789");
    if (!sealed.sealed) throw new Error("Expected the contact to seal");

    expect(await reopen(sealed.token, "de-DE")).toEqual(
      contactWithPhone("0151 23456789")
    );
    // A cs-CZ page doesn't read the number as a Czech one.
    expect(await reopen(sealed.token, "cs-CZ")).toEqual(
      contactWithPhone("+49 1512 3456789")
    );
  });

  test("rejects a property the contact doesn't have", async () => {
    const result = await validate("cs-CZ", {
      ...contactWithPhone("+420 777 123 456"),
      locale: "de-DE",
    });

    expect(result.issues?.length).toBeGreaterThan(0);
  });
});
