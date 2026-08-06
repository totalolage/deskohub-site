import type { HostedPaymentCustomer } from "@deskohub/nexi";
import { parsePhoneNumber } from "libphonenumber-js";

export const getNexiHostedPaymentCustomer = (input: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}): HostedPaymentCustomer => {
  const phone = parsePhoneNumber(input.phone, "CZ");
  return {
    id: input.id,
    name: input.name,
    email: input.email,
    mobilePhone: {
      countryCallingCode: phone.countryCallingCode,
      nationalNumber: phone.nationalNumber,
    },
  };
};
