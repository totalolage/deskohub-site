import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  ExternalAPIError,
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
  | {
      readonly kind: "matched";
      readonly state: "active" | "expired";
      readonly customerId: DotyposCustomerId;
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

export const toCustomerProfile = (
  customer: DotyposCustomer
): CustomerProfile => {
  const companyName = nonEmpty(customer.companyName);
  const companyId = nonEmpty(customer.companyId);
  const vatId = nonEmpty(customer.vatId);
  const billing: CustomerProfileBilling = {
    kind: companyName || companyId || vatId ? "business" : "personal",
    addressLine1: nonEmpty(customer.addressLine1),
    addressLine2: nonEmpty(customer.addressLine2),
    city: nonEmpty(customer.city),
    zip: nonEmpty(customer.zip),
    country: nonEmpty(customer.country),
    companyName,
    companyId,
    vatId,
  };

  return {
    firstName: customer.firstName?.trim() || "",
    lastName: nonEmpty(customer.lastName),
    phone: nonEmpty(customer.phone),
    billing,
  };
};

const toUpdateRequest = (
  input: CustomerProfileInput
): UpdateCustomerRequest => {
  const billing = input.billing;
  const business = billing?.kind === "business" ? billing : undefined;
  const personal = billing?.kind === "personal" ? billing : undefined;
  const address = billing ? billing : undefined;

  let companyName: string | undefined;
  let companyId: string | undefined;
  let vatId: string | undefined;
  if (business) {
    companyName = business.companyName;
    companyId = business.companyId ?? "";
    vatId = business.vatId ?? "";
  } else if (personal) {
    companyName = "";
    companyId = "";
    vatId = "";
  }

  return {
    firstName: input.firstName,
    lastName: input.lastName,
    phone:
      input.phone === undefined
        ? undefined
        : normalizePhoneNumber(input.phone) || "",
    addressLine1: address ? (address.addressLine1 ?? "") : undefined,
    addressLine2: address ? (address.addressLine2 ?? "") : undefined,
    city: address ? (address.city ?? "") : undefined,
    zip: address ? (address.zip ?? "") : undefined,
    country: address ? (address.country ?? "") : undefined,
    companyName,
    companyId,
    vatId,
  };
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
  }) => Effect.Effect<DotyposCustomerId, DotyposCustomerError>;
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
        dotypos
          .findCustomer({ firstName: "", email }, { lookupFields: ["email"] })
          .pipe(
            Effect.map((result): ExactEmailCustomerMatch => {
              if (result._tag === "NotFound") return { kind: "not-found" };
              if (result._tag === "Ambiguous") return { kind: "ambiguous" };

              const customer = result.customer;
              if (!customer.id) return { kind: "ambiguous" };

              return {
                kind: "matched",
                state: isCustomerProfileExpired(customer)
                  ? "expired"
                  : "active",
                customerId: customer.id,
              };
            })
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
        if (customer.id) return customer.id;

        const reread = yield* classifyExactEmailCustomers(input.email);
        if (reread.kind === "matched") return reread.customerId;

        return yield* new ExternalAPIError({
          service: "Dotypos",
          operation: "createCustomer",
          message: "Dotypos returned a created customer without an id.",
          statusCode: 502,
        });
      });

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

          return yield* Effect.fail(error);
        }

        if (lastError && isUncertainDotyposError(lastError)) {
          const finalReread = yield* readCustomer(input.customerId);
          if (input.isApplied(finalReread)) return;
        }

        return yield* Effect.fail(lastError!);
      });

      const updateCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.updateCustomerProfile"
      )((customerId: DotyposCustomerId, profile: CustomerProfileInput) =>
        patchWithReread({
          customerId,
          payload: toUpdateRequest(profile),
          isApplied: (customer) =>
            customer != null &&
            customer.firstName?.trim() === profile.firstName,
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
            customer == null ||
            (!customer.deleted && !isCustomerProfileExpired(customer)),
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
