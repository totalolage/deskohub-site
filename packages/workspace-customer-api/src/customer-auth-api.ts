import { Schema, SchemaTransformation } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { CustomerAccountId } from "./customer-session";

/**
 * The Better Auth (1.7.2) endpoints a signed-in customer's client calls
 * directly, as Better Auth serves them under `/api/auth`. Client-only: the
 * Workspace never serves this API through `HttpApiBuilder`, and the
 * Workspace checks these paths against Better Auth's own endpoints.
 *
 * Responses decode leniently: Better Auth plugins add fields, and only the
 * fields declared here are read.
 */

/** Why Better Auth refused a request. `code` is Better Auth's fixed code. */
export class CustomerAuthRejected extends Schema.TaggedErrorClass<CustomerAuthRejected>()(
  "CustomerAuthRejected",
  {
    reason: Schema.Literals([
      "invalid-request",
      "unauthorized",
      "forbidden",
      "not-found",
      "rate-limited",
    ]),
    code: Schema.optional(Schema.String),
  }
) {}

type CustomerAuthRejectionReason = CustomerAuthRejected["reason"];

/**
 * Better Auth answers `{ code, message }`, its OAuth endpoints answer
 * `{ error, error_description }`, and some refusals have no body. Only the
 * fixed code is kept; messages stay out.
 */
const BetterAuthErrorBody = Schema.Struct({
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

type RejectionStatus =
  | "BadRequest"
  | "Unauthorized"
  | "Forbidden"
  | "NotFound"
  | "TooManyRequests";

const rejectionWithBody = (
  reason: CustomerAuthRejectionReason,
  status: RejectionStatus
) =>
  BetterAuthErrorBody.pipe(
    Schema.decodeTo(
      Schema.toType(CustomerAuthRejected),
      SchemaTransformation.transform({
        decode: (body) => {
          const code = body.code ?? body.error;
          return new CustomerAuthRejected(
            code === undefined ? { reason } : { reason, code }
          );
        },
        encode: (error) =>
          error.code === undefined ? {} : { code: error.code },
      })
    ),
    HttpApiSchema.status(status)
  );

const rejectionWithoutBody = (
  reason: CustomerAuthRejectionReason,
  status: RejectionStatus
) =>
  CustomerAuthRejected.pipe(
    HttpApiSchema.asNoContent({
      decode: () => new CustomerAuthRejected({ reason }),
    }),
    HttpApiSchema.status(status)
  );

const rejection = (
  reason: CustomerAuthRejectionReason,
  status: RejectionStatus
) => [rejectionWithBody(reason, status), rejectionWithoutBody(reason, status)];

const customerAuthRejections = [
  ...rejection("invalid-request", "BadRequest"),
  ...rejection("unauthorized", "Unauthorized"),
  ...rejection("forbidden", "Forbidden"),
  ...rejection("not-found", "NotFound"),
  ...rejection("rate-limited", "TooManyRequests"),
];

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

export const CustomerAuthSession = Schema.Struct({
  session: Schema.Struct({
    id: Schema.String,
    userId: CustomerAccountId,
    expiresAt: isoInstant,
  }),
  user: Schema.Struct({
    id: CustomerAccountId,
    email: Schema.String,
    emailVerified: Schema.Boolean,
    name: Schema.String,
    image: Schema.optional(Schema.NullOr(Schema.String)),
    /**
     * The account's saved language, null or absent when it has none. Any
     * locale tag, so a locale added later never fails an older client's
     * decoding.
     */
    locale: Schema.optional(
      Schema.NullOr(Schema.String).annotate({
        description:
          "The account's saved locale tag, or null when none is saved. Clients ignore tags they don't support.",
      })
    ),
  }),
}).annotate({ identifier: "CustomerAuthSession" });
export type CustomerAuthSession = typeof CustomerAuthSession.Type;

const CustomerAuthPasskey = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: isoInstant,
}).annotate({ identifier: "CustomerAuthPasskey" });

const ById = Schema.Struct({ id: Schema.String });

export const CustomerAuthEndpoints = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("getSession", "/get-session", {
      /** Null when the request carries no valid session. */
      success: Schema.NullOr(CustomerAuthSession),
      error: customerAuthRejections,
    })
  )
  .add(
    HttpApiEndpoint.post("signOut", "/sign-out", {
      success: Schema.Struct({ success: Schema.Boolean }),
      error: customerAuthRejections,
    })
  )
  .add(
    HttpApiEndpoint.post("updatePasskey", "/passkey/update-passkey", {
      payload: Schema.Struct({
        id: Schema.String,
        name: Schema.Trim.check(Schema.isNonEmpty()),
      }),
      success: Schema.Struct({ passkey: CustomerAuthPasskey }),
      error: customerAuthRejections,
    })
  )
  .add(
    HttpApiEndpoint.post("deletePasskey", "/passkey/delete-passkey", {
      payload: ById,
      success: Schema.Struct({ status: Schema.Boolean }),
      error: customerAuthRejections,
    })
  )
  .add(
    /** Disconnects an AI assistant: `id` is the consent's. */
    HttpApiEndpoint.post("deleteConsent", "/oauth2/delete-consent", {
      payload: ById,
      success: HttpApiSchema.Empty(200),
      error: customerAuthRejections,
    })
  )
  .prefix("/api/auth");

export const CustomerAuthApi = HttpApi.make("customerAuthApi").add(
  CustomerAuthEndpoints
);
