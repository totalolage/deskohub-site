import { describe, expect, test } from "bun:test";
import { formatPhoneNumber, parsePhoneNumber } from "@deskohub/phone-number";
import {
  accountPhoneRegion,
  type CustomerProfile,
} from "@deskohub/workspace-customer-api";
import { Option, Result } from "effect";
import { sampleProfile } from "../../customer-api/testing/sample-fixtures";
import {
  billingFieldsOf,
  completionDraftOf,
  emptyProfileDraft,
  type ProfileDraft,
  profileDraftOf,
  sameDraft,
  validateCompletionDraft,
  validateProfileDraft,
} from "./profile-draft";

/** The phone region of an account without a saved language: Czech. */
const phoneRegion = accountPhoneRegion(null);

const personalProfile: CustomerProfile = {
  firstName: "Jordan",
  lastName: null,
  phone: null,
  billing: {
    kind: "personal",
    addressLine1: "Example Street 2",
    addressLine2: null,
    city: "Sampletown",
    zip: "000 00",
    country: "CZ",
    companyName: null,
    companyId: null,
    vatId: null,
  },
};

const validDraft = (draft: Partial<ProfileDraft> = {}): ProfileDraft => ({
  ...profileDraftOf(sampleProfile, phoneRegion),
  ...draft,
});

const invalidFields = (draft: ProfileDraft) =>
  Result.match(validateProfileDraft(draft, phoneRegion), {
    onSuccess: () => undefined,
    onFailure: (invalid) => invalid,
  });

describe("profileDraftOf", () => {
  test("keeps every stored business field", () => {
    expect(profileDraftOf(sampleProfile, phoneRegion)).toEqual({
      firstName: "Alex",
      lastName: "Sample",
      phone: "+420 600 000 000",
      billingKind: "business",
      companyName: "Sample Studio s.r.o.",
      companyId: "00000000",
      vatId: "CZ00000000",
      addressLine1: "Example Street 1",
      addressLine2: "",
      city: "Sampletown",
      zip: "000 00",
      country: "CZ",
    });
  });

  test("reads personal billing and empty stored values", () => {
    expect(profileDraftOf(personalProfile, phoneRegion)).toMatchObject({
      firstName: "Jordan",
      lastName: "",
      phone: "",
      billingKind: "personal",
      addressLine1: "Example Street 2",
      companyName: "",
    });
  });

  test("reads a profile without billing as no billing details", () => {
    expect(
      profileDraftOf({ ...personalProfile, billing: null }, phoneRegion)
        .billingKind
    ).toBe("none");
  });

  test("shows a stored phone number in international format", () => {
    const stored = Option.getOrThrow(parsePhoneNumber("600 000 001", "CZ"));
    const draft = profileDraftOf(
      { ...sampleProfile, phone: stored },
      phoneRegion
    );
    expect(draft.phone).toBe(formatPhoneNumber(stored));
    expect(draft.phone).not.toBe(stored);
    expect(parsePhoneNumber(draft.phone, "CZ")).toEqual(Option.some(stored));
  });

  test.each(["not a phone", "tel. 600 000 001"])(
    "shows stored text that isn't just a phone number as stored: %p",
    (stored) => {
      expect(
        profileDraftOf({ ...sampleProfile, phone: stored }, phoneRegion).phone
      ).toBe(stored);
    }
  );

  test("counts the stored number as unchanged however it was typed", () => {
    const stored = Option.getOrThrow(parsePhoneNumber("600 000 001", "CZ"));
    const saved = profileDraftOf(
      { ...sampleProfile, phone: stored },
      phoneRegion
    );
    expect(
      sameDraft({ ...saved, phone: "600000001" }, saved, phoneRegion)
    ).toBe(true);
    expect(sameDraft({ ...saved, phone: stored }, saved, phoneRegion)).toBe(
      true
    );
  });
});

describe("validateProfileDraft", () => {
  test("submits the complete stored profile, its phone as the number", () => {
    expect<Result.Result<unknown, unknown>>(
      validateProfileDraft(validDraft(), phoneRegion)
    ).toEqual(
      Result.succeed({
        firstName: "Alex",
        lastName: "Sample",
        phone: "+420600000000",
        billing: {
          kind: "business",
          companyName: "Sample Studio s.r.o.",
          companyId: "00000000",
          vatId: "CZ00000000",
          addressLine1: "Example Street 1",
          addressLine2: undefined,
          city: "Sampletown",
          zip: "000 00",
          country: "CZ",
        },
      })
    );
  });

  test("editing only the name keeps every billing field", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ firstName: "Alexa" }), phoneRegion)
    );
    expect(input.firstName).toBe("Alexa");
    expect(input.billing).toMatchObject({
      kind: "business",
      companyName: "Sample Studio s.r.o.",
      vatId: "CZ00000000",
      city: "Sampletown",
    });
    expect<string | undefined>(input.phone).toBe("+420600000000");
  });

  test("editing only billing keeps the name and phone", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ city: "Othertown" }), phoneRegion)
    );
    expect(input).toMatchObject({
      firstName: "Alex",
      lastName: "Sample",
      phone: "+420600000000",
    });
    expect(input.billing?.city).toBe("Othertown");
  });

  test("trims entered text and leaves blank optional text out", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(
        validDraft({ firstName: "  Alex ", lastName: "   ", phone: "" }),
        phoneRegion
      )
    );
    expect(input.firstName).toBe("Alex");
    expect(input.lastName).toBeUndefined();
    expect(input.phone).toBeUndefined();
  });

  test("no billing details sends no billing", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ billingKind: "none" }), phoneRegion)
    );
    expect(input.billing).toBeUndefined();
  });

  test("personal billing sends no company fields", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ billingKind: "personal" }), phoneRegion)
    );
    expect(input.billing).toEqual({
      kind: "personal",
      addressLine1: "Example Street 1",
      addressLine2: undefined,
      city: "Sampletown",
      zip: "000 00",
      country: "CZ",
    });
  });

  test("maps a blank first name to the field and focuses it", () => {
    expect(invalidFields(validDraft({ firstName: " " }))).toEqual({
      fields: { firstName: "required" },
      first: Option.some("firstName"),
    });
  });

  test("maps an unparsable phone to the phone field", () => {
    expect(invalidFields(validDraft({ phone: "not a phone" }))?.fields).toEqual(
      { phone: "invalid-phone" }
    );
  });

  test("maps nested billing issues to the flat fields, first in screen order", () => {
    expect(
      invalidFields(
        validDraft({ companyName: "", country: "CZE", zip: "1".repeat(21) })
      )
    ).toEqual({
      fields: { companyName: "required", zip: "invalid", country: "invalid" },
      first: Option.some("companyName"),
    });
  });

  test("reports identity fields before billing fields", () => {
    expect(
      invalidFields(validDraft({ country: "CZE", lastName: "x".repeat(101) }))
        ?.first
    ).toEqual(Option.some("lastName"));
  });

  test("ignores hidden company fields of personal billing", () => {
    expect(
      Result.isSuccess(
        validateProfileDraft(
          validDraft({ billingKind: "personal", companyName: "" }),
          phoneRegion
        )
      )
    ).toBe(true);
  });
});

describe("validateCompletionDraft", () => {
  test("sends the referral code and the invitation it came from", () => {
    const draft = {
      ...completionDraftOf("FRIEND-1"),
      firstName: "Jordan",
    };
    expect(
      Result.getOrThrow(validateCompletionDraft(draft, "FRIEND-1", phoneRegion))
    ).toMatchObject({
      firstName: "Jordan",
      referralCode: "FRIEND-1",
      prefilledReferralCode: "FRIEND-1",
    });
  });

  test("an emptied referral code is left out", () => {
    const draft = { ...completionDraftOf(undefined), firstName: "Jordan" };
    const input = Result.getOrThrow(
      validateCompletionDraft(draft, undefined, phoneRegion)
    );
    expect(input.referralCode).toBeUndefined();
    expect(input.prefilledReferralCode).toBeUndefined();
  });

  test("orders the referral code after identity and before billing", () => {
    const draft = {
      ...completionDraftOf(undefined),
      firstName: "Jordan",
      referralCode: "x".repeat(65),
      billingKind: "personal" as const,
      country: "CZE",
    };
    expect(
      Result.match(validateCompletionDraft(draft, undefined, phoneRegion), {
        onSuccess: () => undefined,
        onFailure: (invalid) => invalid,
      })
    ).toEqual({
      fields: { referralCode: "invalid", country: "invalid" },
      first: Option.some("referralCode"),
    });
  });
});

describe("an account with a saved language", () => {
  const german = accountPhoneRegion("de-DE");
  const nationalNumber = "0151 23456789";

  test("submits a phone without a country calling code as its region's number", () => {
    const draft = validDraft({ phone: nationalNumber });
    expect<Result.Result<string | undefined, unknown>>(
      Result.map(validateProfileDraft(draft, german), ({ phone }) => phone)
    ).toEqual(Result.succeed("+4915123456789"));
    expect(
      Result.isSuccess(
        validateCompletionDraft(
          { ...draft, referralCode: "" },
          undefined,
          german
        )
      )
    ).toBe(true);
    expect(invalidFields(draft)?.fields).toEqual({ phone: "invalid-phone" });
  });

  test("counts its stored number as unchanged as typed in that region", () => {
    const saved = profileDraftOf(
      { ...sampleProfile, phone: "+4915123456789" },
      german
    );
    expect(sameDraft({ ...saved, phone: nationalNumber }, saved, german)).toBe(
      true
    );
  });
});

describe("drafts", () => {
  test("compares by value", () => {
    expect(sameDraft(validDraft(), validDraft(), phoneRegion)).toBe(true);
    expect(
      sameDraft(validDraft(), validDraft({ zip: "111 11" }), phoneRegion)
    ).toBe(false);
  });

  test("a phone counts as the number the Workspace stores for it", () => {
    const stored = validDraft({ phone: "+420600000000" });
    expect(
      sameDraft(validDraft({ phone: "600 000 000" }), stored, phoneRegion)
    ).toBe(true);
    expect(
      sameDraft(validDraft({ phone: "+420 600 000 000" }), stored, phoneRegion)
    ).toBe(true);
    expect(
      sameDraft(validDraft({ phone: "600 000 001" }), stored, phoneRegion)
    ).toBe(false);
    expect(sameDraft(validDraft({ phone: "" }), stored, phoneRegion)).toBe(
      false
    );
  });

  test("a phone without a number compares as entered", () => {
    const stored = validDraft({ phone: "legacy" });
    expect(
      sameDraft(validDraft({ phone: "legacy" }), stored, phoneRegion)
    ).toBe(true);
    expect(sameDraft(validDraft({ phone: "other" }), stored, phoneRegion)).toBe(
      false
    );
  });

  test("each billing choice shows its own fields", () => {
    expect(billingFieldsOf("none")).toEqual([]);
    expect(billingFieldsOf("personal")).not.toContain("companyName");
    expect(billingFieldsOf("business")).toContain("companyName");
  });

  test("the empty draft has no billing details", () => {
    expect(emptyProfileDraft.billingKind).toBe("none");
  });
});
