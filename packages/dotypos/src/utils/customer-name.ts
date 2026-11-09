import type { Customer } from "../generated";

type NamedCustomer = Pick<Customer, "firstName" | "lastName" | "companyName">;

/**
 * The name a customer goes by: the trimmed first and last name, or the
 * company name when the customer has no personal name. Undefined when the
 * customer has neither.
 */
export const getCustomerDisplayName = (
  customer: NamedCustomer
): string | undefined =>
  [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") ||
  customer.companyName?.trim() ||
  undefined;
