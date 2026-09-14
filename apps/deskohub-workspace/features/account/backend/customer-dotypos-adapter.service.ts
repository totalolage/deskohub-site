import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  ExternalAPIError,
  type FindCustomerResult,
  type NetworkError,
  normalizePhoneNumber,
  type ValidationError,
} from "@deskohub/dotypos";
import type { UpdateCustomerRequest } from "@deskohub/dotypos/generated";
import { Context, Effect, Layer, Result } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { CustomerProfileInput } from "../contracts";

export type DotyposCustomerError =
  | ValidationError
  | ExternalAPIError
  | NetworkError;

export type CustomerProfileBilling = {
  readonly kind: "personal" | "business";
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly zip: string | null;
  readonly country: string | null;
  readonly companyName: string | null;
  readonly companyId: string | null;
  readonly vatId: string | null;
};

export type CustomerProfile = {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly billing: CustomerProfileBilling | null;
};

/**
 * Closed classification of the exact-email Dotypos candidates for a verified
 * login email. Provider customer shapes never escape the adapter.
 */
export type ExactEmailCustomerMatch =
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unusable" }
  | {
      readonly kind: "matched";
      readonly state: "active" | "expired";
      readonly customerId: DotyposCustomerId;
    };

/**
 * Adapter-internal classification that retains the decoded provider row for
 * the matched candidate so callers inside the adapter can map it without a
 * second provider read.
 */
type ExactEmailCustomerRowMatch =
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unusable" }
  | {
      readonly kind: "matched";
      readonly state: "active" | "expired";
      readonly customerId: DotyposCustomerId;
      readonly customer: DotyposCustomer;
    };

/**
 * The provider's create response, closed as the created link id plus the
 * app-level profile mapped from that same decoded response.
 */
export type CreatedCustomerProfile = {
  readonly customerId: DotyposCustomerId;
  readonly profile: CustomerProfile;
};

export const isCustomerProfileExpired = (
  customer: DotyposCustomer,
  now: Date = new Date()
): boolean =>
  customer.expireDate != null && new Date(customer.expireDate) <= now;

const isUncertainDotyposError = (error: DotyposCustomerError): boolean => {
  if (error._tag === "NetworkError") return true;
  if (error._tag === "ExternalAPIError") {
    const status = error.statusCode;
    return status != null && (status === 429 || status >= 500);
  }
  return false;
};

const isEtagConflictError = (error: DotyposCustomerError): boolean =>
  error._tag === "ExternalAPIError" &&
  (error.statusCode === 409 || error.statusCode === 412);

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const hasInputBillingData = (
  billing: NonNullable<CustomerProfileInput["billing"]>
): boolean =>
  billing.kind === "business" ||
  nonEmpty(billing.addressLine1) != null ||
  nonEmpty(billing.addressLine2) != null ||
  nonEmpty(billing.city) != null ||
  nonEmpty(billing.zip) != null ||
  nonEmpty(billing.country) != null;

export const toCustomerProfile = (
  customer: DotyposCustomer
): CustomerProfile => {
  const companyName = nonEmpty(customer.companyName);
  const companyId = nonEmpty(customer.companyId);
  const vatId = nonEmpty(customer.vatId);
  const addressLine1 = nonEmpty(customer.addressLine1);
  const addressLine2 = nonEmpty(customer.addressLine2);
  const city = nonEmpty(customer.city);
  const zip = nonEmpty(customer.zip);
  const country = nonEmpty(customer.country);
  const hasBillingData =
    addressLine1 !== null ||
    addressLine2 !== null ||
    city !== null ||
    zip !== null ||
    country !== null ||
    companyName !== null ||
    companyId !== null ||
    vatId !== null;

  return {
    firstName: customer.firstName?.trim() || "",
    lastName: nonEmpty(customer.lastName),
    phone: nonEmpty(customer.phone),
    billing: hasBillingData
      ? {
          kind: companyName || companyId || vatId ? "business" : "personal",
          addressLine1,
          addressLine2,
          city,
          zip,
          country,
          companyName,
          companyId,
          vatId,
        }
      : null,
  };
};

/**
 * Builds the provider PATCH payload so every editable field carries an
 * explicit value: optional fields the user cleared send the provider's
 * clearing value instead of being omitted, which would leave the previous
 * provider state in place.
 */
const toUpdateRequest = (
  input: CustomerProfileInput
): UpdateCustomerRequest => {
  const billing = input.billing;
  const business = billing?.kind === "business" ? billing : undefined;
  const address = billing ?? null;

  return {
    firstName: input.firstName,
    lastName: input.lastName ?? "",
    phone: normalizePhoneNumber(input.phone) ?? "",
    addressLine1: address?.addressLine1 ?? "",
    addressLine2: address?.addressLine2 ?? "",
    city: address?.city ?? "",
    zip: address?.zip ?? "",
    country: address?.country ?? "",
    companyName: business?.companyName ?? "",
    companyId: business?.companyId ?? "",
    vatId: business?.vatId ?? "",
  };
};

/**
 * Decides whether a provider profile reflects every requested editable
 * field, including optional-only changes. Used after uncertain provider
 * responses, where a partial comparison would report a dropped field as
 * applied. Clearing to no billing counts as applied once the stored profile
 * carries no billing data either.
 */
export const customerProfileAppliesInput = (
  customer: DotyposCustomer,
  input: CustomerProfileInput
): boolean => {
  if (customer.deleted) return false;
  const stored = toCustomerProfile(customer);

  if (stored.firstName !== input.firstName) return false;
  if ((stored.lastName ?? "") !== (input.lastName ?? "")) return false;
  if ((stored.phone ?? "") !== (normalizePhoneNumber(input.phone) ?? "")) {
    return false;
  }

  const storedBilling = stored.billing;
  const billing = input.billing;

  if (!billing || !hasInputBillingData(billing)) {
    return storedBilling == null;
  }
  if (storedBilling == null) return false;
  if (storedBilling.kind !== billing.kind) return false;

  const addressMatches =
    (storedBilling.addressLine1 ?? "") === (billing.addressLine1 ?? "") &&
    (storedBilling.addressLine2 ?? "") === (billing.addressLine2 ?? "") &&
    (storedBilling.city ?? "") === (billing.city ?? "") &&
    (storedBilling.zip ?? "") === (billing.zip ?? "") &&
    (storedBilling.country ?? "") === (billing.country ?? "");

  if (billing.kind === "personal") return addressMatches;

  return (
    addressMatches &&
    (storedBilling.companyName ?? "") === billing.companyName &&
    (storedBilling.companyId ?? "") === (billing.companyId ?? "") &&
    (storedBilling.vatId ?? "") === (billing.vatId ?? "")
  );
};

const toCustomerDetails = (input: {
  readonly email: string;
  readonly profile: CustomerProfileInput;
}) => ({
  firstName: input.profile.firstName,
  lastName: input.profile.lastName ?? "",
  email: input.email,
  phone: input.profile.phone
    ? normalizePhoneNumber(input.profile.phone) || undefined
    : undefined,
  addressLine1: input.profile.billing?.addressLine1 ?? "",
  addressLine2: input.profile.billing?.addressLine2 ?? "",
  city: input.profile.billing?.city ?? "",
  zip: input.profile.billing?.zip ?? "",
  country: input.profile.billing?.country ?? "",
  companyName:
    input.profile.billing?.kind === "business"
      ? input.profile.billing.companyName
      : "",
  companyId:
    input.profile.billing?.kind === "business"
      ? (input.profile.billing.companyId ?? "")
      : "",
  vatId:
    input.profile.billing?.kind === "business"
      ? (input.profile.billing.vatId ?? "")
      : "",
});

const expirationPatch = (expired: boolean): UpdateCustomerRequest => ({
  expireDate: expired ? new Date(Date.now() - 60_000).toISOString() : null,
});

interface ICustomerDotyposAdapter {
  readonly classifyExactEmailCustomers: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, DotyposCustomerError>;
  readonly readCustomerProfile: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerProfile | null, DotyposCustomerError>;
  readonly createCustomerProfile: (input: {
    readonly email: string;
    readonly profile: CustomerProfileInput;
  }) => Effect.Effect<CreatedCustomerProfile, DotyposCustomerError>;
  readonly updateCustomerProfile: (
    customerId: DotyposCustomerId,
    profile: CustomerProfileInput
  ) => Effect.Effect<void, DotyposCustomerError>;
  readonly expireCustomer: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, DotyposCustomerError>;
  readonly reactivateCustomer: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, DotyposCustomerError>;
}

export class CustomerDotyposAdapter extends Context.Service<
  CustomerDotyposAdapter,
  ICustomerDotyposAdapter
>()("@deskohub-workspace/account/CustomerDotyposAdapter") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      const readCustomer = (customerId: DotyposCustomerId) =>
        dotypos
          .getCustomer(customerId)
          .pipe(
            Effect.catchTag("ExternalAPIError", (error) =>
              error.statusCode === 404
                ? Effect.succeed(null)
                : Effect.fail(error)
            )
          );

      const classifyExactEmailCustomers = Effect.fn(
        "CustomerDotyposAdapter.classifyExactEmailCustomers"
      )((email: string) =>
        Effect.map(
          findExactEmailCustomer(email),
          (result): ExactEmailCustomerMatch => {
            const match = classifyExactEmailResult(result);
            return match.kind === "matched"
              ? {
                  kind: "matched",
                  state: match.state,
                  customerId: match.customerId,
                }
              : match;
          }
        )
      );

      const readCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.readCustomerProfile"
      )((customerId: DotyposCustomerId) =>
        Effect.map(readCustomer(customerId), (customer) =>
          customer && !customer.deleted ? toCustomerProfile(customer) : null
        )
      );

      const createCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.createCustomerProfile"
      )(function* (input: {
        readonly email: string;
        readonly profile: CustomerProfileInput;
      }) {
        const customer = yield* dotypos.createCustomer(
          toCustomerDetails(input)
        );
        if (customer.id) {
          return {
            customerId: customer.id,
            profile: toCustomerProfile(customer),
          };
        }

        const reread = yield* Effect.map(
          findExactEmailCustomer(input.email),
          classifyExactEmailResult
        );
        if (reread.kind === "matched") {
          return {
            customerId: reread.customerId,
            profile: toCustomerProfile(reread.customer),
          };
        }

        return yield* new ExternalAPIError({
          service: "Dotypos",
          operation: "createCustomer",
          message: "Dotypos returned a created customer without an id.",
          statusCode: 502,
        });
      });

      const findExactEmailCustomer = (email: string) =>
        dotypos.findCustomer(
          { firstName: "", email },
          { lookupFields: ["email"] }
        );

      const classifyExactEmailResult = (
        result: FindCustomerResult
      ): ExactEmailCustomerRowMatch => {
        if (result._tag === "NotFound") return { kind: "not-found" };
        if (result._tag === "Ambiguous") return { kind: "ambiguous" };
        if (result._tag === "Deleted") return { kind: "unusable" };

        const customer = result.customer;
        if (!customer.id) return { kind: "ambiguous" };

        return {
          kind: "matched",
          state: isCustomerProfileExpired(customer) ? "expired" : "active",
          customerId: customer.id,
          customer,
        };
      };

      const patchWithReread = Effect.fn(
        "CustomerDotyposAdapter.patchWithReread"
      )(function* (input: {
        readonly customerId: DotyposCustomerId;
        readonly payload: UpdateCustomerRequest;
        readonly isApplied: (customer: DotyposCustomer | null) => boolean;
      }) {
        let lastError: DotyposCustomerError | undefined;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const outcome = yield* dotypos
            .patchCustomer(input.customerId, input.payload)
            .pipe(Effect.asVoid, Effect.result);
          if (Result.isSuccess(outcome)) return;

          const error = outcome.failure as DotyposCustomerError;
          lastError = error;

          if (isEtagConflictError(error) && attempt === 0) continue;

          if (isUncertainDotyposError(error)) {
            const reread = yield* readCustomer(input.customerId);
            if (input.isApplied(reread)) return;
            continue;
          }

          return yield* error;
        }

        if (lastError && isUncertainDotyposError(lastError)) {
          const finalReread = yield* readCustomer(input.customerId);
          if (input.isApplied(finalReread)) return;
        }

        return yield* lastError!;
      });

      const updateCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.updateCustomerProfile"
      )((customerId: DotyposCustomerId, profile: CustomerProfileInput) =>
        patchWithReread({
          customerId,
          payload: toUpdateRequest(profile),
          isApplied: (customer) =>
            customer != null && customerProfileAppliesInput(customer, profile),
        })
      );

      const expireCustomer = Effect.fn("CustomerDotyposAdapter.expireCustomer")(
        (customerId: DotyposCustomerId) =>
          patchWithReread({
            customerId,
            payload: expirationPatch(true),
            isApplied: (customer) =>
              customer != null &&
              (customer.deleted || isCustomerProfileExpired(customer)),
          })
      );

      const reactivateCustomer = Effect.fn(
        "CustomerDotyposAdapter.reactivateCustomer"
      )((customerId: DotyposCustomerId) =>
        patchWithReread({
          customerId,
          payload: expirationPatch(false),
          isApplied: (customer) =>
            customer != null &&
            !customer.deleted &&
            !isCustomerProfileExpired(customer),
        })
      );

      return {
        classifyExactEmailCustomers,
        createCustomerProfile,
        expireCustomer,
        readCustomerProfile,
        reactivateCustomer,
        updateCustomerProfile,
      } satisfies ICustomerDotyposAdapter;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDotyposLayer));
}
