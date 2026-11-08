import { describe, expect, test } from "bun:test";
import type { CustomerProfile } from "@deskohub/workspace-customer-api";
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
  ...profileDraftOf(sampleProfile),
  ...draft,
});

const invalidFields = (draft: ProfileDraft) =>
  Result.match(validateProfileDraft(draft), {
    onSuccess: () => undefined,
    onFailure: (invalid) => invalid,
  });

describe("profileDraftOf", () => {
  test("keeps every stored business field", () => {
    expect(profileDraftOf(sampleProfile)).toEqual({
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
    expect(profileDraftOf(personalProfile)).toMatchObject({
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
      profileDraftOf({ ...personalProfile, billing: null }).billingKind
    ).toBe("none");
  });
});

describe("validateProfileDraft", () => {
  test("submits the complete stored profile unchanged", () => {
    expect(validateProfileDraft(validDraft())).toEqual(
      Result.succeed({
        firstName: "Alex",
        lastName: "Sample",
        phone: "+420 600 000 000",
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
      validateProfileDraft(validDraft({ firstName: "Alexa" }))
    );
    expect(input.firstName).toBe("Alexa");
    expect(input.billing).toMatchObject({
      kind: "business",
      companyName: "Sample Studio s.r.o.",
      vatId: "CZ00000000",
      city: "Sampletown",
    });
    expect(input.phone).toBe("+420 600 000 000");
  });

  test("editing only billing keeps the name and phone", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ city: "Othertown" }))
    );
    expect(input).toMatchObject({
      firstName: "Alex",
      lastName: "Sample",
      phone: "+420 600 000 000",
    });
    expect(input.billing?.city).toBe("Othertown");
  });

  test("trims entered text and leaves blank optional text out", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(
        validDraft({ firstName: "  Alex ", lastName: "   ", phone: "" })
      )
    );
    expect(input.firstName).toBe("Alex");
    expect(input.lastName).toBeUndefined();
    expect(input.phone).toBeUndefined();
  });

  test("no billing details sends no billing", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ billingKind: "none" }))
    );
    expect(input.billing).toBeUndefined();
  });

  test("personal billing sends no company fields", () => {
    const input = Result.getOrThrow(
      validateProfileDraft(validDraft({ billingKind: "personal" }))
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
          validDraft({ billingKind: "personal", companyName: "" })
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
      Result.getOrThrow(validateCompletionDraft(draft, "FRIEND-1"))
    ).toMatchObject({
      firstName: "Jordan",
      referralCode: "FRIEND-1",
      prefilledReferralCode: "FRIEND-1",
    });
  });

  test("an emptied referral code is left out", () => {
    const draft = { ...completionDraftOf(undefined), firstName: "Jordan" };
    const input = Result.getOrThrow(validateCompletionDraft(draft, undefined));
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
      Result.match(validateCompletionDraft(draft, undefined), {
        onSuccess: () => undefined,
        onFailure: (invalid) => invalid,
      })
    ).toEqual({
      fields: { referralCode: "invalid", country: "invalid" },
      first: Option.some("referralCode"),
    });
  });
});

describe("drafts", () => {
  test("compares by value", () => {
    expect(sameDraft(validDraft(), validDraft())).toBe(true);
    expect(sameDraft(validDraft(), validDraft({ zip: "111 11" }))).toBe(false);
  });

  test("a phone counts as the number the Workspace stores for it", () => {
    const stored = validDraft({ phone: "+420600000000" });
    expect(sameDraft(validDraft({ phone: "600 000 000" }), stored)).toBe(true);
    expect(sameDraft(validDraft({ phone: "+420 600 000 000" }), stored)).toBe(
      true
    );
    expect(sameDraft(validDraft({ phone: "600 000 001" }), stored)).toBe(false);
    expect(sameDraft(validDraft({ phone: "" }), stored)).toBe(false);
  });

  test("a phone without a number compares as entered", () => {
    const stored = validDraft({ phone: "legacy" });
    expect(sameDraft(validDraft({ phone: "legacy" }), stored)).toBe(true);
    expect(sameDraft(validDraft({ phone: "other" }), stored)).toBe(false);
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
