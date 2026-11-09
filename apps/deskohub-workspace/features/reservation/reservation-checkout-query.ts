import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Predicate, Record, Schema } from "effect";
import {
  reservationCustomerEmailSchema,
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import type { ReservationCustomerMode } from "@/features/reservation/reservation-existing-customer";
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

const queryCustomerSchemas = {
  name: Schema.toStandardSchemaV1(reservationCustomerNameSchema),
  email: Schema.toStandardSchemaV1(reservationCustomerEmailSchema),
  phone: Schema.toStandardSchemaV1(reservationCustomerPhoneSchema),
};

export const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

/**
 * A reservation form's selection as the query parameters its link parser
 * reads. A parameter set to `undefined` is removed from the URL.
 *
 * Contact parameters (`name`, `email`, `phone`) and the `customer` mode are
 * never part of a selection: writing them would put personal data into the
 * browser history and analytics.
 */
export type ReservationSelectionSearchParams = Readonly<
  Record<string, string | undefined> &
    Partial<Record<ReservationContactQueryParam, never>>
>;

type ReservationContactQueryParam =
  | keyof typeof queryCustomerSchemas
  | typeof reservationCustomerQueryParam;

/** Whether a URL names any of the given selection parameters. */
export const hasReservationSelectionSearchParams = (
  searchParams: SupportedSearchParams,
  selectionParams: readonly string[]
) =>
  selectionParams.some(
    (name) => getSearchParam(searchParams, name) !== undefined
  );

/**
 * Writes a selection into a URL's search parameters, leaving every parameter
 * outside it, such as `discountCode`, as it is.
 */
export const setReservationSelectionSearchParams = (
  searchParams: URLSearchParams,
  selection: ReservationSelectionSearchParams
) => {
  for (const [name, value] of Object.entries(selection)) {
    if (value === undefined) searchParams.delete(name);
    else searchParams.set(name, value);
  }
};

export const decodeReservationCheckoutCustomer = (
  searchParams: SupportedSearchParams
): { [Key in keyof typeof queryCustomerSchemas]?: string } =>
  Record.filter(
    Record.map(queryCustomerSchemas, (schema, key): string | undefined =>
      decodeStandardSchema(schema, getTrimmedSearchParam(searchParams, key))
    ),
    Predicate.isNotUndefined
  );

/**
 * Query parameter that tells a signed-in visit whether the link prefills the
 * standing customer (`account`) or the exact contact in the link
 * (`contact`).
 */
export const reservationCustomerQueryParam = "customer";

const queryCustomerModeSchema = Schema.toStandardSchemaV1(
  Schema.Literals(["account", "contact"] as const)
);

/**
 * The customer mode a link asks for. An explicit `customer` parameter wins;
 * otherwise, on forms whose links prefill the contact, any contact field
 * asks for that exact contact. A link without either leaves the choice to
 * the page.
 */
export const getReservationCustomerQueryMode = (
  searchParams: SupportedSearchParams,
  { prefillsContact = true }: { readonly prefillsContact?: boolean } = {}
): ReservationCustomerMode | undefined =>
  decodeStandardSchema(
    queryCustomerModeSchema,
    getTrimmedSearchParam(searchParams, reservationCustomerQueryParam)
  ) ??
  (prefillsContact &&
  Record.keys(queryCustomerSchemas).some(
    (key) => getTrimmedSearchParam(searchParams, key) !== undefined
  )
    ? "contact"
    : undefined);
