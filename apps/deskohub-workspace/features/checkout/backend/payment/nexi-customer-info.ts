import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type HostedPaymentCustomer,
  NexiCustomerReferenceSchema,
} from "@deskohub/nexi";
import { type PhoneNumber, phoneNumberParts } from "@deskohub/phone-number";
import { Option } from "effect";

/** The customer a hosted payment page prefills; without a phone it has no mobile phone. */
export const getNexiHostedPaymentCustomer = (input: {
  readonly id: DotyposCustomerId;
  readonly name: string;
  readonly email: string;
  readonly phone: Option.Option<PhoneNumber>;
}): HostedPaymentCustomer => ({
  id: NexiCustomerReferenceSchema.make(input.id),
  name: input.name,
  email: input.email,
  ...Option.match(input.phone, {
    onNone: () => ({}),
    onSome: (phone) => ({ mobilePhone: phoneNumberParts(phone) }),
  }),
});
