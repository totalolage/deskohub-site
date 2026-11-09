import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { sampleWorkspaceData } from "../../customer-api/testing/sample-fixtures";
import {
  type DetailsDraft,
  detailsAccess,
  detailsFieldOf,
  emptyDetailsDraft,
  type SelfContact,
  validateDetails,
  withRejectedSavedFields,
} from "./details-form";

const linkedAccount = (
  profile: Partial<Extract<CustomerAccountState, { kind: "linked" }>["profile"]>
): CustomerAccountState => {
  const account = sampleWorkspaceData("linked").account;
  if (account.kind !== "linked") throw new Error("sample isn't linked");
  return { ...account, profile: { ...account.profile, ...profile } };
};

const profileSelf: SelfContact = {
  email: testEmailAddress("booker"),
  name: Option.some("Synthetic Booker"),
  phone: Option.some("+420 700 000 000"),
};

const draft = (patch: Partial<DetailsDraft> = {}): DetailsDraft => ({
  ...emptyDetailsDraft,
  ...patch,
});

const address = {
  line1: " Vodičkova 1 ",
  line2: "",
  city: "Praha",
  postalCode: "110 00",
  country: "cz",
};

const problemsOf = (self: SelfContact, form: DetailsDraft) => {
  const validation = validateDetails(self, form);
  return validation._tag === "Invalid" ? validation.problems : {};
};

describe("detailsAccess", () => {
  test("a linked profile books as itself, asking for a phone it lacks", () => {
    const access = detailsAccess(
      linkedAccount({ firstName: " Jana ", lastName: "Nováková", phone: null })
    );
    expect(access._tag).toBe("Ready");
    if (access._tag !== "Ready") return;
    expect(access.self.name).toEqual(Option.some("Jana Nováková"));
    expect(Option.isNone(access.self.phone)).toBe(true);
  });

  test("an invalid saved phone is asked for again", () => {
    const access = detailsAccess(linkedAccount({ phone: "12" }));
    expect(access._tag === "Ready" && Option.isNone(access.self.phone)).toBe(
      true
    );
  });

  test("an account without a profile enters its name and phone", () => {
    const access = detailsAccess(
      sampleWorkspaceData("completion-required").account
    );
    expect(access._tag).toBe("Ready");
    if (access._tag !== "Ready") return;
    expect(Option.isNone(access.self.name)).toBe(true);
    expect(Option.isNone(access.self.phone)).toBe(true);
  });

  test("support and deletion states can't book", () => {
    expect(
      detailsAccess(sampleWorkspaceData("support-required").account)
    ).toEqual({
      _tag: "Unavailable",
      reason: "support-required",
    });
    expect(
      detailsAccess(sampleWorkspaceData("deletion-pending").account)._tag
    ).toBe("Unavailable");
  });
});

describe("validateDetails", () => {
  test("self with a full profile sends the profile's contact and no invoice", () => {
    expect(validateDetails(profileSelf, draft())).toEqual({
      _tag: "Valid",
      details: {
        bookingFor: "self",
        contact: {
          name: "Synthetic Booker",
          email: testEmailAddress("booker"),
          phone: "+420 700 000 000",
        },
        billing: { purpose: "personal", invoice: "none" },
      },
    });
  });

  test("marketing consent is sent only when ticked, and only for oneself", () => {
    const ticked = validateDetails(
      profileSelf,
      draft({ marketingConsent: true })
    );
    expect(ticked._tag === "Valid" && ticked.details.marketingConsent).toBe(
      true
    );
    const forSomeoneElse = validateDetails(
      profileSelf,
      draft({
        bookingFor: "someone-else",
        marketingConsent: true,
        someoneElse: {
          name: "Guest Person",
          email: testEmailAddress("guest"),
          emailRepeat: testEmailAddress("guest").toUpperCase(),
          phone: "777 123 456",
        },
      })
    );
    expect(forSomeoneElse._tag).toBe("Valid");
    if (forSomeoneElse._tag !== "Valid") return;
    expect("marketingConsent" in forSomeoneElse.details).toBe(false);
    expect(forSomeoneElse.details.contact.email).toBe(
      testEmailAddress("guest")
    );
  });

  test("a missing self phone is required, then checked", () => {
    const noPhone = { ...profileSelf, phone: Option.none() };
    expect(problemsOf(noPhone, draft())).toEqual({ phone: "required" });
    expect(
      problemsOf(noPhone, draft({ self: { name: "", phone: "12ab" } }))
    ).toEqual({ phone: "invalid_phone" });
    const entered = validateDetails(
      noPhone,
      draft({ self: { name: "", phone: " 777 123 456 " } })
    );
    expect(entered._tag === "Valid" && entered.details.contact.phone).toBe(
      "777 123 456"
    );
  });

  test("an unprofiled account must name itself", () => {
    const unprofiled = {
      email: testEmailAddress("new"),
      name: Option.none(),
      phone: Option.none(),
    };
    expect(
      problemsOf(unprofiled, draft({ self: { name: "J", phone: "777123456" } }))
    ).toEqual({ name: "too_short" });
  });

  test("someone else needs every field and the same email twice", () => {
    expect(
      problemsOf(profileSelf, draft({ bookingFor: "someone-else" }))
    ).toEqual({
      name: "required",
      email: "required",
      emailRepeat: "required",
      phone: "required",
    });
    expect(
      problemsOf(
        profileSelf,
        draft({
          bookingFor: "someone-else",
          someoneElse: {
            name: "Guest Person",
            email: "guest@example",
            emailRepeat: testEmailAddress("other"),
            phone: "777123456",
          },
        })
      )
    ).toEqual({ email: "invalid_email", emailRepeat: "emails_differ" });
  });

  test("a personal invoice needs an address, sent trimmed with the country uppercased", () => {
    expect(
      problemsOf(profileSelf, draft({ billing: "personal-invoice" }))
    ).toEqual({
      "address.line1": "required",
      "address.city": "required",
      "address.postalCode": "required",
    });
    const valid = validateDetails(
      profileSelf,
      draft({ billing: "personal-invoice", address })
    );
    expect(valid._tag === "Valid" && valid.details.billing).toEqual({
      purpose: "personal",
      invoice: "requested",
      address: {
        line1: "Vodičkova 1",
        city: "Praha",
        postalCode: "110 00",
        country: "CZ",
      },
    });
  });

  test("a business invoice needs the buyer; the VAT id is optional and capped", () => {
    expect(
      problemsOf(profileSelf, draft({ billing: "business", address }))
    ).toEqual({ "buyer.legalName": "required", "buyer.companyId": "required" });
    expect(
      problemsOf(
        profileSelf,
        draft({
          billing: "business",
          address: { ...address, country: "Czechia" },
          buyer: {
            legalName: "Firma s.r.o.",
            companyId: "1".repeat(65),
            vatId: "",
          },
        })
      )
    ).toEqual({
      "address.country": "invalid_country",
      "buyer.companyId": "too_long",
    });
    const valid = validateDetails(
      profileSelf,
      draft({
        billing: "business",
        address,
        buyer: { legalName: "Firma s.r.o.", companyId: "12345678", vatId: "" },
      })
    );
    expect(valid._tag === "Valid" && valid.details.billing).toEqual({
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Firma s.r.o.",
        companyId: "12345678",
        address: {
          line1: "Vodičkova 1",
          city: "Praha",
          postalCode: "110 00",
          country: "CZ",
        },
      },
    });
  });
});

describe("withRejectedSavedFields", () => {
  test("a saved phone the server rejected is asked for and sent as entered", () => {
    const rejected = withRejectedSavedFields(profileSelf, new Set(["phone"]));
    expect(rejected.name).toEqual(profileSelf.name);
    expect(problemsOf(rejected, draft())).toEqual({ phone: "required" });
    const corrected = validateDetails(
      rejected,
      draft({ self: { name: "", phone: "+420 777 123 456" } })
    );
    expect(corrected._tag === "Valid" && corrected.details.contact.phone).toBe(
      "+420 777 123 456"
    );
  });

  test("a rejected saved name is asked for too", () => {
    const rejected = withRejectedSavedFields(profileSelf, new Set(["name"]));
    expect(Option.isNone(rejected.name)).toBe(true);
    expect(rejected.phone).toEqual(profileSelf.phone);
  });
});

describe("detailsFieldOf", () => {
  test("maps the server's field paths onto the form's fields", () => {
    expect(detailsFieldOf(Option.some("contact.phone"))).toEqual(
      Option.some("phone")
    );
    expect(detailsFieldOf(Option.some("billing.buyer.address.city"))).toEqual(
      Option.some("address.city")
    );
    expect(detailsFieldOf(Option.some("billing.address.country"))).toEqual(
      Option.some("address.country")
    );
    expect(Option.isNone(detailsFieldOf(Option.some("billing")))).toBe(true);
    expect(Option.isNone(detailsFieldOf(Option.some("constructor")))).toBe(
      true
    );
    expect(Option.isNone(detailsFieldOf(Option.none()))).toBe(true);
  });
});
