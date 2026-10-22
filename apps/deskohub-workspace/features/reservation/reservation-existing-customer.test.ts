import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  getAccountContactValues,
  getReservationCheckoutCustomerForm,
  getReservationExistingCustomerForm,
} from "./reservation-existing-customer";

const contact = {
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777777777",
};

const values = {
  name: "Grace Hopper",
  email: testEmailAddress("grace"),
  phone: "+420606060606",
  coffee: true,
};

describe("getAccountContactValues", () => {
  test("keeps the typed phone only when the account has none", () => {
    expect(getAccountContactValues(contact, "+420606060606")).toEqual(contact);
    expect(
      getAccountContactValues({ ...contact, phone: null }, "+420606060606")
    ).toEqual({ ...contact, phone: "+420606060606" });
  });
});

describe("getReservationExistingCustomerForm", () => {
  test("opens a plain visit on the account card", () => {
    const empty = { name: "", email: "", phone: "", coffee: true };

    expect(
      getReservationExistingCustomerForm({
        contact,
        hasMarketingConsent: false,
        queryMode: undefined,
        restored: false,
        values: empty,
      })
    ).toEqual({
      existingCustomer: {
        contact,
        hasMarketingConsent: false,
        initialMode: "account",
        otherContact: { name: "", email: "", phone: "" },
      },
      initialValues: { ...contact, coffee: true },
    });
  });

  test("opens a contact link on the linked contact", () => {
    expect(
      getReservationExistingCustomerForm({
        contact,
        hasMarketingConsent: false,
        queryMode: "contact",
        restored: false,
        values,
      })
    ).toEqual({
      existingCustomer: {
        contact,
        hasMarketingConsent: false,
        initialMode: "contact",
        otherContact: {
          name: values.name,
          email: values.email,
          phone: values.phone,
        },
      },
      initialValues: values,
    });
  });

  test("books an account link as the account and keeps its contact for someone else", () => {
    const form = getReservationExistingCustomerForm({
      contact: { ...contact, phone: null },
      hasMarketingConsent: false,
      queryMode: "account",
      restored: false,
      values,
    });

    expect(form.existingCustomer.initialMode).toBe("account");
    expect(form.existingCustomer.otherContact).toEqual({
      name: values.name,
      email: values.email,
      phone: values.phone,
    });
    expect(form.initialValues).toEqual({
      ...values,
      name: contact.name,
      email: contact.email,
    });
  });

  test("reopens a restored checkout in the mode it was submitted in", () => {
    const restoredAccount = getReservationExistingCustomerForm({
      contact,
      hasMarketingConsent: false,
      queryMode: undefined,
      restored: true,
      values: {
        ...values,
        ...contact,
        email: testEmailAddress("ada").toUpperCase(),
      },
    });
    expect(restoredAccount.existingCustomer).toMatchObject({
      initialMode: "account",
      otherContact: { name: "", email: "", phone: "" },
    });

    const restoredContact = getReservationExistingCustomerForm({
      contact,
      hasMarketingConsent: false,
      queryMode: "account",
      restored: true,
      values,
    });
    expect(restoredContact.existingCustomer.initialMode).toBe("contact");
    expect(restoredContact.initialValues).toEqual(values);
  });
});

describe("getReservationCheckoutCustomerForm", () => {
  const typed = {
    name: "Sam Typed",
    email: testEmailAddress("sam"),
    phone: "+420777000333",
    billing: {
      purpose: "business" as const,
      invoice: "required" as const,
      buyer: {
        kind: "business" as const,
        legalName: "Typed s.r.o.",
        companyId: "12345678",
        address: {
          line1: "Typed 1",
          city: "Praha",
          postalCode: "110 00",
          country: "CZ",
        },
      },
    },
    marketingConsent: true,
  };
  const linked = {
    status: "linked" as const,
    customer: { contact, hasMarketingConsent: false },
  };

  test("refills a signed-out form with the details typed before leaving it", () => {
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: { status: "signed-out" },
        checkoutContact: typed,
        queryMode: undefined,
        restored: false,
        values,
      });

    expect(checkoutCustomer).toEqual({ status: "signed-out" });
    expect(initialValues).toEqual({ ...values, ...typed });
  });

  test("books an account without a profile on its own email and continues a verified contact", () => {
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: {
          status: "profile-missing",
          email: typed.email.toUpperCase(),
        },
        checkoutContact: typed,
        queryMode: undefined,
        restored: false,
        values,
      });

    expect(checkoutCustomer).toEqual({
      status: "profile-missing",
      email: typed.email.toUpperCase(),
      continuesCheckout: true,
    });
    expect(initialValues).toMatchObject({
      name: typed.name,
      email: typed.email.toUpperCase(),
      phone: typed.phone,
      billing: typed.billing,
    });
  });

  test("doesn't continue details typed for another email than the account's", () => {
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: { status: "profile-missing", email: contact.email },
        checkoutContact: typed,
        queryMode: undefined,
        restored: false,
        values,
      });

    expect(checkoutCustomer).toMatchObject({ continuesCheckout: false });
    expect(initialValues.email).toBe(contact.email);
  });

  test("keeps a saved profile and offers the typed details, minus the email, for someone else", () => {
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: linked,
        checkoutContact: typed,
        queryMode: "contact",
        restored: false,
        values,
      });

    expect(checkoutCustomer).toMatchObject({
      status: "linked",
      replacesTypedContact: true,
      existingCustomer: {
        initialMode: "account",
        otherContact: { name: typed.name, email: "", phone: typed.phone },
      },
    });
    expect(initialValues).toMatchObject({
      name: contact.name,
      email: contact.email,
      billing: typed.billing,
    });
  });

  test("opens a carried-in contact for someone else with its email confirmed", () => {
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: linked,
        checkoutContact: undefined,
        queryMode: "contact",
        restored: false,
        values,
      });

    expect(checkoutCustomer).toMatchObject({
      replacesTypedContact: false,
      existingCustomer: { initialMode: "contact" },
    });
    expect(initialValues).toMatchObject({
      email: values.email,
      emailConfirmation: values.email,
    });
  });

  test("books a review account only as itself, on its synthetic contact", () => {
    const reviewContact = {
      name: "App Review",
      email: testEmailAddress("reviewer"),
      phone: "+44 20 7946 0123",
    };
    const { checkoutCustomer, initialValues } =
      getReservationCheckoutCustomerForm({
        account: { status: "review-account", contact: reviewContact },
        checkoutContact: typed,
        queryMode: "contact",
        restored: false,
        values,
      });

    expect(checkoutCustomer).toMatchObject({
      status: "review-account",
      existingCustomer: {
        contact: reviewContact,
        hasMarketingConsent: true,
        initialMode: "account",
      },
    });
    expect(initialValues).toMatchObject(reviewContact);
  });

  test("keeps the form's values while the account can't be read", () => {
    expect(
      getReservationCheckoutCustomerForm({
        account: { status: "unavailable" },
        checkoutContact: undefined,
        queryMode: undefined,
        restored: false,
        values,
      })
    ).toEqual({
      checkoutCustomer: { status: "unavailable" },
      initialValues: values,
    });
  });
});
