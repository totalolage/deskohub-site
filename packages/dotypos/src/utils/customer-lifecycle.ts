import type { Customer } from "../generated";

type LifecycleCustomer = Pick<Customer, "deleted" | "expireDate">;

export type DotyposCustomerLifecycle = "active" | "expired" | "deleted";

/**
 * A customer's lifecycle at `now`. Deleted wins over expired. A customer
 * expires once its expiry date is at or before `now`; an expiry date that
 * doesn't parse leaves the customer active. Compute it when you read the
 * record, because the same record expires as time passes.
 */
export const customerLifecycle = (
  customer: LifecycleCustomer,
  now: Date
): DotyposCustomerLifecycle => {
  if (customer.deleted) return "deleted";
  return customer.expireDate != null && new Date(customer.expireDate) <= now
    ? "expired"
    : "active";
};
