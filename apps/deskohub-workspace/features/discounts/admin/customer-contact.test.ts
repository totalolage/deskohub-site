import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { m } from "@/features/administration/i18n";
import { formatDiscountAdminCustomerContact } from "./customer-contact";

const locale = "en-US";
const email = testEmailAddress("customer-contact");
const phone = "+420 123 456 789";

describe("customer contact", () => {
  test("joins the email and phone Dotypos holds", () => {
    expect(formatDiscountAdminCustomerContact({ email, phone }, locale)).toBe(
      `${email} · ${phone}`
    );
    expect(
      formatDiscountAdminCustomerContact({ email: null, phone }, locale)
    ).toBe(phone);
  });

  test("notes a customer without contact details", () => {
    expect(
      formatDiscountAdminCustomerContact({ email: null, phone: null }, locale)
    ).toBe(m.discountsCustomerNoContactDetails({}, { locale }));
  });
});
