import {
  type AdministrationCustomerDetail,
  EmailCustomerField,
  type EmailCustomerSelection,
  type EmailCustomerSelectionInvalid,
  type EmailValueDefinition,
  EmailValueSnapshot,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  emailValueSnapshotForDefinition,
  selectedEmailCustomerShape as selectedEmailCustomerFields,
  validateEmailCustomerSelection,
} from "@deskohub/workspace-admin-api";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Predicate,
  Schema,
} from "effect";
import { AdministrationService } from "@/features/administration/administration.service";
import { DiscountAdministration } from "@/features/discounts/admin/discount-administration.service";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import {
  CustomerValueMissing,
  CustomerValueRejected,
  CustomerValueSource,
} from "./customer-value-source.service";

type CustomerValueFailure = Effect.Error<
  ReturnType<CustomerValueSource["Service"]["profile"]>
>;
type CustomerValueInput = {
  readonly customerId: DotyposCustomerId;
  readonly definition: EmailValueDefinition & {
    readonly source: EmailCustomerSelection;
  };
  readonly locale: string;
};

interface ICustomerValues {
  /** Only current lookups run here. Preparation replays persisted snapshots before calling this. */
  readonly resolve: (
    input: CustomerValueInput
  ) => Effect.Effect<
    Schema.Json,
    CustomerValueFailure | EmailCustomerSelectionInvalid
  >;
}

const sameFields = Schema.toEquivalence(EmailCustomerField);
const sortKeySchema = Schema.NullOr(
  Schema.Union([Schema.Finite, Schema.String, Schema.Boolean])
);
type SortKey = typeof sortKeySchema.Type;

export class CustomerValues extends Context.Service<
  CustomerValues,
  ICustomerValues
>()("@deskohub-workspace/emails/CustomerValues") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const source = yield* CustomerValueSource;
      const sources: Readonly<
        Record<
          string,
          (input: {
            readonly customerId: DotyposCustomerId;
          }) => Effect.Effect<unknown, CustomerValueFailure>
        >
      > = {
        profile: source.profile,
        activity: source.activity,
      } satisfies Record<
        keyof AdministrationCustomerDetail,
        (input: {
          readonly customerId: DotyposCustomerId;
        }) => Effect.Effect<unknown, CustomerValueFailure>
      >;
      return {
        resolve: Effect.fn("CustomerValues.resolve")(
          (input: CustomerValueInput) => {
            const selection: Effect.Effect<
              EmailCustomerField,
              EmailCustomerSelectionInvalid
            > = validateEmailCustomerSelection(input.definition.source);
            return selection.pipe(
              Effect.tap(() => validateDefinitionHistory(input.definition)),
              Effect.andThen(() =>
                Effect.succeed(
                  sources[input.definition.source.path[0] ?? ""]
                ).pipe(
                  Effect.filterOrFail(
                    (load): load is NonNullable<typeof load> =>
                      load !== undefined,
                    () =>
                      new CustomerValueRejected({
                        reason: "incompatible-shape",
                      })
                  ),
                  Effect.flatMap((load) =>
                    load({ customerId: input.customerId })
                  )
                )
              ),
              Effect.flatMap((customer) =>
                Schema.decodeUnknownEffect(Schema.Json)(customer).pipe(
                  Effect.mapError(
                    () => new CustomerValueRejected({ reason: "invalid-data" })
                  )
                )
              ),
              Effect.map((customer) =>
                valueAtPath(customer, input.definition.source.path.slice(1))
              ),
              Effect.filterOrFail(
                (value): value is Schema.Json =>
                  value !== null && value !== undefined,
                () => new CustomerValueMissing({ reason: "field-absent" })
              ),
              Effect.flatMap((value) =>
                selectCustomerValue(value, input.definition.source)
              ),
              Effect.flatMap((value) =>
                EmailValueSnapshot.members[0].makeEffect({ value }).pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      emailValueSnapshotForDefinition(
                        input.definition,
                        input.locale
                      )
                    )
                  ),
                  Effect.mapError(
                    () =>
                      new CustomerValueRejected({
                        reason: "incompatible-shape",
                      })
                  ),
                  Effect.as(value)
                )
              )
            );
          }
        ),
      } satisfies ICustomerValues;
    })
  );

  /** Administrator reads, for previews of a real customer. */
  static Live = this.Default.pipe(Layer.provide(CustomerValueSource.Live));

  // The variants below build `Default` fresh: layers memoize by reference, so
  // sharing it would let one runtime reuse the administrator-checked build.

  /** Trusted server-side reads for recipient preparation; see `CustomerValueSource.Delivery`. */
  static Delivery = Layer.fresh(this.Default).pipe(
    Layer.provide(CustomerValueSource.Delivery)
  );

  static DeliveryLive = this.Delivery.pipe(
    Layer.provide(
      Layer.mergeAll(DiscountAdministration.Live, AdministrationService.Live)
    )
  );

  /** Resolves against a synthetic customer, so a sample reads no customer data. */
  static Synthetic = (customer: AdministrationCustomerDetail) =>
    Layer.fresh(this.Default).pipe(
      Layer.provide(
        Layer.succeed(CustomerValueSource, {
          profile: () =>
            Effect.fromNullishOr(customer.profile).pipe(
              Effect.mapError(
                () => new CustomerValueMissing({ reason: "customer-not-found" })
              )
            ),
          activity: () => Effect.succeed(customer.activity),
        })
      )
    );
}

/** Whether a definition's frozen output no longer matches the catalogue. */
const hasIncompatibleFrozenFields = (
  definition: EmailValueDefinition,
  fields: ReturnType<typeof selectedEmailCustomerFields>
) =>
  Boolean(
    definition["customerShape"] &&
      (!fields || !sameFields(definition["customerShape"], fields))
  );

/** The catalogue's current field at a list selection's sort path. */
const currentSortField = (
  selection: EmailCustomerSelection,
  sortPath: readonly string[]
) => {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    selection.path,
    { inheritPresence: false }
  );
  return selected?.kind === "list"
    ? emailCustomerFieldAtPath(selected.element, sortPath)
    : undefined;
};

/** The sort field a definition froze, on its own or in its projected output. */
const frozenSortField = (
  definition: EmailValueDefinition,
  sortPath: readonly string[]
) => {
  const frozenOutput = definition["customerShape"];
  return (
    definition["customerSortShape"] ??
    (frozenOutput?.kind === "list"
      ? emailCustomerFieldAtPath(frozenOutput.element, sortPath)
      : undefined)
  );
};

const validateDefinitionHistory = (
  definition: EmailValueDefinition & { readonly source: EmailCustomerSelection }
): Effect.Effect<void, CustomerValueRejected> => {
  const selection = definition.source;
  if (
    hasIncompatibleFrozenFields(
      definition,
      selectedEmailCustomerFields(selection)
    )
  )
    return Effect.fail(
      new CustomerValueRejected({ reason: "incompatible-shape" })
    );
  if (!selection.sort) return Effect.void;
  const current = currentSortField(selection, selection.sort.path);
  const frozenSort = frozenSortField(definition, selection.sort.path);
  // An unprojected historical sort field needs its own frozen descriptor.
  return Effect.void.pipe(
    Effect.filterOrFail(
      () =>
        current !== undefined &&
        frozenSort !== undefined &&
        sameFields(frozenSort, current),
      () => new CustomerValueRejected({ reason: "incompatible-sort" })
    )
  );
};

const selectCustomerValue = (
  value: Schema.Json,
  selection: EmailCustomerSelection
) => {
  if (!Arr.isArray<Schema.Json>(value))
    return Effect.succeed(projectFields(value, selection.fields));
  return Effect.succeed(value).pipe(
    Effect.flatMap((items) =>
      selection.sort
        ? Effect.forEach(items, (item) =>
            Schema.decodeUnknownEffect(sortKeySchema)(
              valueAtPath(item, selection.sort?.path ?? []) ?? null
            ).pipe(
              Effect.map((key) => ({ item, key })),
              Effect.mapError(
                () => new CustomerValueRejected({ reason: "invalid-data" })
              )
            )
          ).pipe(
            Effect.map((keyed) =>
              keyed
                .toSorted((left, right) =>
                  compareSortKeys(
                    left.key,
                    right.key,
                    selection.sort?.direction ?? "asc"
                  )
                )
                .map(({ item }) => item)
            )
          )
        : Effect.succeed(items)
    ),
    Effect.map((items) =>
      items
        .slice(0, selection.limit)
        .map((item) => projectFields(item, selection.fields))
    )
  );
};

/** Sorting/limits apply to the administration's bounded history, never the customer's complete history. */
export const compareSortKeys = (
  left: SortKey,
  right: SortKey,
  direction: "asc" | "desc"
): number => {
  if (left === right) return 0;
  // Null and missing sort keys stay last in both directions; ties preserve source order.
  if (left === null) return 1;
  if (right === null) return -1;
  const compared = comparePresentKeys(left, right);
  return direction === "asc" ? compared : -compared;
};

const comparePresentKeys = (
  left: Exclude<SortKey, null>,
  right: Exclude<SortKey, null>
): number => {
  if (Predicate.isBoolean(left) && Predicate.isBoolean(right))
    return Number(left) - Number(right);
  if (Predicate.isNumber(left) && Predicate.isNumber(right))
    return left - right;
  if (Predicate.isString(left) && Predicate.isString(right))
    return left < right ? -1 : 1;
  return sortKeyTypeRank(left) - sortKeyTypeRank(right);
};

/** Mixed sort data orders booleans, then numbers, then strings. */
const sortKeyTypeRank = (value: Exclude<SortKey, null>) => {
  if (Predicate.isBoolean(value)) return 0;
  if (Predicate.isNumber(value)) return 1;
  return 2;
};

/** The JSON value at a record path, or undefined when a segment is missing or not a record. */
export const valueAtPath = (
  root: Schema.Json,
  path: readonly string[]
): Schema.Json | undefined => {
  let value: Schema.Json | undefined = root;
  for (const part of path) {
    if (
      value === null ||
      !Predicate.isObjectKeyword(value) ||
      Arr.isArray<Schema.Json>(value) ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = value[part];
  }
  return value;
};

const projectFields = (
  value: Schema.Json,
  paths: readonly (readonly string[])[] | undefined
): Schema.Json => {
  if (
    !paths ||
    value === null ||
    !Predicate.isObjectKeyword(value) ||
    Arr.isArray<Schema.Json>(value)
  )
    return value;
  return Object.fromEntries(
    [...new Set(paths.flatMap((path) => (path[0] ? [path[0]] : [])))].flatMap(
      (name) => {
        const child = Object.hasOwn(value, name) ? value[name] : undefined;
        if (child === undefined) return [];
        const relative = paths
          .filter((path) => path[0] === name)
          .map((path) => path.slice(1));
        return [
          [
            name,
            relative.some((path) => path.length === 0)
              ? child
              : projectFields(child, relative),
          ],
        ];
      }
    )
  );
};
