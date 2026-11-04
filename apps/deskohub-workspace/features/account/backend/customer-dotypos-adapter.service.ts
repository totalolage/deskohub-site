import {
  type DotyposConditionalWriteFailure,
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  type DotyposUncertain,
  type FindCustomerResult,
  normalizePhoneNumber,
} from "@deskohub/dotypos";
import type { UpdateCustomerRequest } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { MissingDotyposId } from "@/shared/backend/missing-dotypos-id";
import type { CustomerProfile, CustomerProfileInput } from "../contracts";

/** A profile update or reactivation addressed a Dotypos customer that does not exist. */
class DotyposCustomerMissing extends Data.TaggedError(
  "DotyposCustomerMissing"
)<{
  readonly customerId: DotyposCustomerId;
}> {}

export type DotyposCustomerError =
  | DotyposConditionalWriteFailure
  | MissingDotyposId
  | DotyposCustomerMissing;

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
type CreatedCustomerProfile = {
  readonly customerId: DotyposCustomerId;
  readonly profile: CustomerProfile;
};

const isCustomerProfileExpired = (
  customer: DotyposCustomer,
  now: Date = new Date()
): boolean =>
  customer.expireDate != null && new Date(customer.expireDate) <= now;

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const billingAddressFields = [
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
] as const;

const businessBillingFields = ["companyName", "companyId", "vatId"] as const;

type BillingTextField =
  | (typeof billingAddressFields)[number]
  | (typeof businessBillingFields)[number];

type BillingInput = CustomerProfileInput["billing"];

type StoredBilling = NonNullable<CustomerProfile["billing"]>;

const businessBillingOf = (billing: BillingInput) =>
  billing?.kind === "business" ? billing : undefined;

const hasInputBillingData = (billing: NonNullable<BillingInput>): boolean =>
  billing.kind === "business" ||
  billingAddressFields.some((field) => nonEmpty(billing[field]) != null);

/**
 * Dotypos clears an optional text field only when it receives an empty
 * string, so every listed field carries an explicit value.
 */
const toProviderText = <Field extends BillingTextField>(
  fields: readonly Field[],
  source: Partial<Record<Field, string>> | undefined
): Record<Field, string> => {
  const values: Partial<Record<Field, string>> = {};
  for (const field of fields) values[field] = source?.[field] ?? "";
  return values as Record<Field, string>;
};

/** Compares stored and requested values, treating absent and empty alike. */
const providerTextMatches = <Field extends BillingTextField>(
  fields: readonly Field[],
  stored: Record<Field, string | null>,
  requested: Partial<Record<Field, string>>
): boolean =>
  fields.every((field) => (stored[field] ?? "") === (requested[field] ?? ""));

const toCustomerBilling = (customer: DotyposCustomer): StoredBilling | null => {
  const billing = {
    addressLine1: nonEmpty(customer.addressLine1),
    addressLine2: nonEmpty(customer.addressLine2),
    city: nonEmpty(customer.city),
    zip: nonEmpty(customer.zip),
    country: nonEmpty(customer.country),
    companyName: nonEmpty(customer.companyName),
    companyId: nonEmpty(customer.companyId),
    vatId: nonEmpty(customer.vatId),
  };
  const isBusiness = businessBillingFields.some(
    (field) => billing[field] !== null
  );
  const hasAddress = billingAddressFields.some(
    (field) => billing[field] !== null
  );
  if (!(isBusiness || hasAddress)) return null;
  return { kind: isBusiness ? "business" : "personal", ...billing };
};

const toCustomerProfile = (customer: DotyposCustomer): CustomerProfile => ({
  firstName: nonEmpty(customer.firstName) ?? "",
  lastName: nonEmpty(customer.lastName),
  phone: nonEmpty(customer.phone),
  billing: toCustomerBilling(customer),
});

/**
 * Builds the provider PATCH payload so every editable field carries an
 * explicit value: optional fields the user cleared send the provider's
 * clearing value instead of being omitted, which would leave the previous
 * provider state in place.
 */
const toUpdateRequest = (
  input: CustomerProfileInput
): UpdateCustomerRequest => ({
  firstName: input.firstName,
  lastName: input.lastName ?? "",
  phone: normalizePhoneNumber(input.phone) ?? "",
  ...toProviderText(billingAddressFields, input.billing),
  ...toProviderText(businessBillingFields, businessBillingOf(input.billing)),
});

const contactAppliesInput = (
  stored: CustomerProfile,
  input: CustomerProfileInput
): boolean =>
  stored.firstName === input.firstName &&
  (stored.lastName ?? "") === (input.lastName ?? "") &&
  (stored.phone ?? "") === (normalizePhoneNumber(input.phone) ?? "");

/** Clearing to no billing applies once the stored profile has none either. */
const billingAppliesInput = (
  stored: StoredBilling | null,
  billing: BillingInput
): boolean => {
  if (!billing || !hasInputBillingData(billing)) return stored == null;
  if (stored == null || stored.kind !== billing.kind) return false;
  return (
    providerTextMatches(billingAddressFields, stored, billing) &&
    (billing.kind === "personal" ||
      providerTextMatches(businessBillingFields, stored, billing))
  );
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
  return (
    contactAppliesInput(stored, input) &&
    billingAppliesInput(stored.billing, input.billing)
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
  ...toProviderText(billingAddressFields, input.profile.billing),
  ...toProviderText(
    businessBillingFields,
    businessBillingOf(input.profile.billing)
  ),
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
  /** None means the Dotypos customer is already missing. */
  readonly expireCustomer: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<Option.Option<DotyposCustomer>, DotyposCustomerError>;
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
        dotypos.getCustomer(customerId).pipe(Effect.map(Option.getOrNull));

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

        return yield* new MissingDotyposId({
          entity: "customer",
          message: "Dotypos returned a created customer without an id.",
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

      /**
       * Patches the customer and settles an uncertain patch by rereading it.
       * At most two patch executions run, each of which the package may
       * replay: a second one follows a version conflict or an uncertain patch
       * the reread shows unapplied. Reread failures carry read tags only, so
       * they are never retried. None means the customer does not exist.
       */
      const patchWithReread = Effect.fn(
        "CustomerDotyposAdapter.patchWithReread"
      )(function* (input: {
        readonly customerId: DotyposCustomerId;
        readonly payload: UpdateCustomerRequest;
        readonly isApplied: (customer: DotyposCustomer) => boolean;
      }) {
        // Each execution sends a fresh patch request.
        const patchOnce = Effect.suspend(() =>
          dotypos.patchCustomer(input.customerId, input.payload)
        );
        // A missing customer is not an applied patch.
        const settle = (uncertain: DotyposUncertain) =>
          dotypos
            .getCustomer(input.customerId)
            .pipe(
              Effect.filterOrFail(
                Option.exists(input.isApplied),
                () => uncertain
              )
            );

        return yield* patchOnce.pipe(
          Effect.catchTags({
            // Re-merge policy: one more conditional attempt, without a reread.
            DotyposVersionConflict: () => patchOnce,
            // The reread shows the patch did not land: one conditional replay.
            DotyposUncertain: (uncertain) =>
              settle(uncertain).pipe(
                Effect.catchTag("DotyposUncertain", () => patchOnce)
              ),
          }),
          // The final settlement read after the second execution.
          Effect.catchTag("DotyposUncertain", settle)
        );
      });

      /** Patches a customer that must exist; a missing one fails DotyposCustomerMissing. */
      const patchExistingWithReread = (input: {
        readonly customerId: DotyposCustomerId;
        readonly payload: UpdateCustomerRequest;
        readonly isApplied: (customer: DotyposCustomer) => boolean;
      }) =>
        patchWithReread(input).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new DotyposCustomerMissing({ customerId: input.customerId })
                ),
              onSome: () => Effect.void,
            })
          )
        );

      const updateCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.updateCustomerProfile"
      )((customerId: DotyposCustomerId, profile: CustomerProfileInput) =>
        patchExistingWithReread({
          customerId,
          payload: toUpdateRequest(profile),
          isApplied: (customer) =>
            customerProfileAppliesInput(customer, profile),
        })
      );

      const expireCustomer = Effect.fn("CustomerDotyposAdapter.expireCustomer")(
        (customerId: DotyposCustomerId) =>
          patchWithReread({
            customerId,
            payload: expirationPatch(true),
            isApplied: (customer) =>
              customer.deleted || isCustomerProfileExpired(customer),
          })
      );

      const reactivateCustomer = Effect.fn(
        "CustomerDotyposAdapter.reactivateCustomer"
      )((customerId: DotyposCustomerId) =>
        patchExistingWithReread({
          customerId,
          payload: expirationPatch(false),
          isApplied: (customer) =>
            !customer.deleted && !isCustomerProfileExpired(customer),
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
