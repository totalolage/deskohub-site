import { describe, expect, test } from "bun:test";
import {
  getAccountContactValues,
  getReservationExistingCustomerForm,
} from "./reservation-existing-customer";

const contact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
};

const values = {
  name: "Grace Hopper",
  email: "grace@example.com",
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
        queryMode: undefined,
        restored: false,
        values: empty,
      })
    ).toEqual({
      existingCustomer: {
        contact,
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
        queryMode: "contact",
        restored: false,
        values,
      })
    ).toEqual({
      existingCustomer: {
        contact,
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
      queryMode: undefined,
      restored: true,
      values: { ...values, ...contact, email: "ADA@example.com" },
    });
    expect(restoredAccount.existingCustomer).toMatchObject({
      initialMode: "account",
      otherContact: { name: "", email: "", phone: "" },
    });

    const restoredContact = getReservationExistingCustomerForm({
      contact,
      queryMode: "account",
      restored: true,
      values,
    });
    expect(restoredContact.existingCustomer.initialMode).toBe("contact");
    expect(restoredContact.initialValues).toEqual(values);
  });
});
