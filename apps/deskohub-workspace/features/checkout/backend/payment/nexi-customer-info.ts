import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type HostedPaymentCustomer,
  NexiCustomerReferenceSchema,
} from "@deskohub/nexi";
import { parsePhoneNumber } from "libphonenumber-js";

export const getNexiHostedPaymentCustomer = (input: {
  readonly id: DotyposCustomerId;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}): HostedPaymentCustomer => {
  const phone = parsePhoneNumber(input.phone, "CZ");
  return {
    id: NexiCustomerReferenceSchema.make(input.id),
    name: input.name,
    email: input.email,
    mobilePhone: {
      countryCallingCode: phone.countryCallingCode,
      nationalNumber: phone.nationalNumber,
    },
  };
};
