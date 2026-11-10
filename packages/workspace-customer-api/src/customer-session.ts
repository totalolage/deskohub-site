import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi";
import type { CustomerLocale } from "./customer-locale";

/**
 * The header every customer API request carries. A browser can't send a
 * custom header cross-site without a CORS preflight the API never grants, so
 * the origin check refuses any request without it.
 */
export const customerApiClientHeader = {
  name: "x-deskohub-client",
  value: "workspace-customer-api",
} as const;

/**
 * The referral code the client remembers from a shared link, which the web
 * keeps in a cookie. Optional on the requests that read or settle it; the
 * client forgets the code once a response reports it settled.
 */
export const customerReferralCodeHeader = "x-deskohub-referral-code";

export const CustomerAccountId = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255)
)
  .pipe(Schema.brand("CustomerAccountId"))
  .annotate({
    identifier: "CustomerAccountId",
    description: "Opaque identifier assigned by Better Auth.",
  });
export type CustomerAccountId = typeof CustomerAccountId.Type;

/** The verified customer the request's Better Auth session belongs to. */
export type CustomerSession = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  /** The account's saved language; null when it has none. */
  readonly locale: CustomerLocale | null;
};

export class CurrentCustomerSession extends Context.Service<
  CurrentCustomerSession,
  CustomerSession
>()("@deskohub/workspace-customer-api/CurrentCustomerSession") {}

/** No verified Better Auth session: sign in again. */
export class CustomerSessionRequired extends Schema.TaggedErrorClass<CustomerSessionRequired>()(
  "CustomerSessionRequired",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Unauthorized"));
}

/**
 * The request came from another site, or without the customer API client
 * header.
 */
export class CustomerRequestRejected extends Schema.TaggedErrorClass<CustomerRequestRejected>()(
  "CustomerRequestRejected",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Forbidden"));
}

/** The account spent its request budget; retry later. */
export class CustomerRateLimited extends Schema.TaggedErrorClass<CustomerRateLimited>()(
  "CustomerRateLimited",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("TooManyRequests"));
}

/**
 * A provider or store the request needs is unavailable or not configured;
 * the request changed nothing it can't retry.
 */
export class CustomerServiceUnavailable extends Schema.TaggedErrorClass<CustomerServiceUnavailable>()(
  "CustomerServiceUnavailable",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("ServiceUnavailable"));
}

/**
 * Refuses cross-site requests and requests without the client header before
 * any session lookup. Implemented by the Workspace.
 */
export class CustomerRequestOriginCheck extends HttpApiMiddleware.Service<CustomerRequestOriginCheck>()(
  "@deskohub/workspace-customer-api/CustomerRequestOriginCheck",
  { error: CustomerRequestRejected.schema }
) {}

/**
 * Resolves the verified customer from the request's Better Auth session
 * cookie and spends the account's request budget. Implemented by the
 * Workspace.
 */
export class CustomerSessionAuthentication extends HttpApiMiddleware.Service<
  CustomerSessionAuthentication,
  { provides: CurrentCustomerSession }
>()("@deskohub/workspace-customer-api/CustomerSessionAuthentication", {
  error: [
    CustomerSessionRequired.schema,
    CustomerRateLimited.schema,
    CustomerServiceUnavailable.schema,
  ],
}) {}
