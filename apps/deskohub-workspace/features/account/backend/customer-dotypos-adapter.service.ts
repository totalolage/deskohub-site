import {
  customerLifecycle,
  type DotyposConditionalWriteFailure,
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposCustomerProfile,
  type DotyposCustomerWriteRecord,
  DotyposService,
  type FindCustomerResult,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Option, Schedule } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { MissingDotyposId } from "@/shared/backend/missing-dotypos-id";
import type { CustomerProfile, CustomerProfileSave } from "../contracts";

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

type BillingInput = CustomerProfileSave["billing"];

type StoredBilling = NonNullable<CustomerProfile["billing"]>;

const businessBillingOf = (billing: BillingInput) =>
  billing?.kind === "business" ? billing : undefined;

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

const toCustomerBilling = (
  customer: DotyposCustomerWriteRecord
): StoredBilling | null => {
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

const toCustomerProfile = (
  customer: DotyposCustomerWriteRecord
): CustomerProfile => ({
  firstName: nonEmpty(customer.firstName) ?? "",
  lastName: nonEmpty(customer.lastName),
  phone: nonEmpty(customer.phone),
  billing: toCustomerBilling(customer),
});

/**
 * The provider profile write, with every editable field explicit: optional
 * fields the user cleared send the provider's clearing value instead of being
 * omitted, which would leave the previous provider state in place. The
 * contract decodes any nonblank phone to a phone number, so a blank phone
 * here is the customer's explicit clearing.
 */
const toProviderProfile = (
  input: CustomerProfileSave
): DotyposCustomerProfile => ({
  firstName: input.firstName,
  lastName: input.lastName ?? "",
  phone: input.phone ?? "",
  ...toProviderText(billingAddressFields, input.billing),
  ...toProviderText(businessBillingFields, businessBillingOf(input.billing)),
});

const toCustomerDetails = (input: {
  readonly email: string;
  readonly profile: CustomerProfileSave;
}) => ({
  firstName: input.profile.firstName,
  lastName: input.profile.lastName ?? "",
  email: input.email,
  phone: input.profile.phone || undefined,
  ...toProviderText(billingAddressFields, input.profile.billing),
  ...toProviderText(
    businessBillingFields,
    businessBillingOf(input.profile.billing)
  ),
});

/**
 * Refreshes an account write once after a genuine version conflict: each
 * attempt calls the package write afresh, which rereads the ETag and sends
 * the write again. The customer's own profile and lifecycle writes win over a
 * concurrent change, which is the account's policy, not the package default.
 * An uncertain write is never retried, because it may already have landed.
 */
const refreshOnceOnVersionConflict = <A>(
  write: () => Effect.Effect<A, DotyposConditionalWriteFailure>
) =>
  Effect.suspend(write).pipe(
    Effect.retry({
      schedule: Schedule.recurs(1),
      while: (failure) => failure._tag === "DotyposVersionConflict",
    })
  );

interface ICustomerDotyposAdapter {
  readonly classifyExactEmailCustomers: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, DotyposCustomerError>;
  readonly readCustomerProfile: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerProfile | null, DotyposCustomerError>;
  readonly createCustomerProfile: (input: {
    readonly email: string;
    readonly profile: CustomerProfileSave;
  }) => Effect.Effect<CreatedCustomerProfile, DotyposCustomerError>;
  readonly updateCustomerProfile: (
    customerId: DotyposCustomerId,
    profile: CustomerProfileSave
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
        readonly profile: CustomerProfileSave;
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

        return {
          kind: "matched",
          state:
            customerLifecycle(customer, new Date()) === "expired"
              ? "expired"
              : "active",
          customerId: customer.id,
          customer,
        };
      };

      /** A customer that must exist; a missing one fails DotyposCustomerMissing. */
      const requireExisting =
        (customerId: DotyposCustomerId) =>
        (customer: Option.Option<DotyposCustomer>) =>
          Option.isSome(customer)
            ? Effect.void
            : Effect.fail(new DotyposCustomerMissing({ customerId }));

      const updateCustomerProfile = Effect.fn(
        "CustomerDotyposAdapter.updateCustomerProfile"
      )((customerId: DotyposCustomerId, profile: CustomerProfileSave) =>
        refreshOnceOnVersionConflict(() =>
          dotypos.updateCustomerProfile(customerId, toProviderProfile(profile))
        ).pipe(Effect.flatMap(requireExisting(customerId)))
      );

      const expireCustomer = Effect.fn("CustomerDotyposAdapter.expireCustomer")(
        (customerId: DotyposCustomerId) =>
          refreshOnceOnVersionConflict(() => dotypos.expireCustomer(customerId))
      );

      const reactivateCustomer = Effect.fn(
        "CustomerDotyposAdapter.reactivateCustomer"
      )((customerId: DotyposCustomerId) =>
        refreshOnceOnVersionConflict(() =>
          dotypos.reactivateCustomer(customerId)
        ).pipe(Effect.flatMap(requireExisting(customerId)))
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
