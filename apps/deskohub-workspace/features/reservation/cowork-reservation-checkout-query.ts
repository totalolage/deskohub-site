import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getWorkspaceProductByTier,
  isWorkspaceCoworkCurrentProductTier,
  type WorkspaceCoworkCurrentTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type CoworkReservationInput,
  coworkReservationDefaultValues,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import {
  decodeReservationCheckoutCustomer,
  getTrimmedSearchParam,
  hasReservationSelectionSearchParams,
  type ReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import {
  getWorkspaceDate,
  isTodayOrFutureWorkspaceDate,
} from "@/features/reservation/reservation-date";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import type { SupportedSearchParams } from "@/shared/utils";

const reservationCheckoutQueryFields = [
  "entryTier",
  "date",
  "coffee",
  "monitorOption",
  "name",
  "email",
  "phone",
] as const;

type ReservationCheckoutQueryField =
  (typeof reservationCheckoutQueryFields)[number];

type ReservationCheckoutQueryValues = Pick<
  CoworkReservationInput,
  ReservationCheckoutQueryField
>;
const queryBooleanSchema = Schema.toStandardSchemaV1(
  Schema.Literals(["true", "false"] as const)
);
const queryDateSchema = Schema.toStandardSchemaV1(
  Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
    Schema.makeFilter(isTodayOrFutureWorkspaceDate)
  )
);
const queryTierSchema = Schema.toStandardSchemaV1(
  Schema.Literals(workspaceCoworkCurrentTiers)
);
// `none` turns the workstation off, which an absent parameter can't say: the
// parser fills a missing option from the customer's last reservation.
const noMonitorQueryValue = "none";
const queryMonitorOptionSchema = Schema.toStandardSchemaV1(
  Schema.Literals([...workspaceProductMonitorOptions, noMonitorQueryValue])
);

const decodeReservationCheckoutQuery = (
  searchParams: SupportedSearchParams
): Partial<ReservationCheckoutQueryValues> => {
  const requestedTier =
    getTrimmedSearchParam(searchParams, "entryTier") ??
    getTrimmedSearchParam(searchParams, "tier");

  const entryTier = decodeStandardSchema(queryTierSchema, requestedTier);

  const date = decodeStandardSchema(
    queryDateSchema,
    getTrimmedSearchParam(searchParams, "date")
  );

  const coffee = decodeStandardSchema(
    queryBooleanSchema,
    getTrimmedSearchParam(searchParams, "coffee")
  );

  const monitorOption = decodeStandardSchema(
    queryMonitorOptionSchema,
    getTrimmedSearchParam(searchParams, "monitorOption")
  );

  return {
    ...(entryTier !== undefined && { entryTier }),
    ...(date !== undefined && { date }),
    ...(coffee !== undefined && { coffee: coffee === "true" }),
    ...(monitorOption !== undefined && {
      monitorOption:
        monitorOption === noMonitorQueryValue ? undefined : monitorOption,
    }),
    ...decodeReservationCheckoutCustomer(searchParams),
  };
};

/**
 * Cowork form values from a link. The customer's last cowork reservation
 * fills the offer options the link leaves open; a link naming another tier
 * replaces the whole remembered offer.
 */
export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  lastReservation?: CustomerLastReservationForKind<"cowork">
): CoworkReservationInput => {
  const query = decodeReservationCheckoutQuery(searchParams);
  const values: CoworkReservationInput = {
    ...coworkReservationDefaultValues,
    ...(lastReservation &&
      (query.entryTier === undefined ||
        query.entryTier === lastReservation.entryTier) && {
        entryTier: lastReservation.entryTier,
        coffee: lastReservation.coffee,
        monitorOption: lastReservation.monitorOption,
      }),
    ...query,
    marketingConsent: false,
  };

  const product = getWorkspaceProductByTier(values.entryTier);

  return {
    ...values,
    ...(product.coffeeAddon === "included" && { coffee: true }),
    ...(product.workstationAddon === "unavailable" && {
      monitorOption: undefined,
    }),
  };
};

/** The cowork selection as the link parameters the parser above reads. */
export const getCoworkReservationSelectionSearchParams = (
  selection: Pick<
    CoworkReservationInput,
    "entryTier" | "date" | "coffee" | "monitorOption"
  >
): ReservationSelectionSearchParams => ({
  entryTier: selection.entryTier,
  date: selection.date || undefined,
  coffee: String(selection.coffee),
  monitorOption:
    selection.monitorOption ??
    (getWorkspaceProductByTier(selection.entryTier).workstationAddon ===
    "optional"
      ? noMonitorQueryValue
      : undefined),
});

/**
 * A stored cowork reservation's selection as link parameters, so a retried
 * checkout reopens the form on the same offer and date. A historical tier
 * can't be booked again and gives no selection.
 */
export const getStoredCoworkReservationSelectionSearchParams = (
  reservation: StoredCoworkReservationDetails & {
    readonly reservedFrom: Temporal.Instant;
  }
): ReservationSelectionSearchParams | undefined =>
  isWorkspaceCoworkCurrentProductTier(reservation.entryTier)
    ? getCoworkReservationSelectionSearchParams({
        entryTier: reservation.entryTier,
        date: getWorkspaceDate(reservation.reservedFrom).toString(),
        coffee: reservation.coffee,
        monitorOption: reservation.monitorOption,
      })
    : undefined;

/**
 * A link to a cowork tier, optionally on a date, that leaves the add-ons for
 * the parser to fill from the customer's last reservation of the tier.
 */
export const getCoworkOfferSearchParams = (offer: {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly date?: string;
}): ReservationSelectionSearchParams => ({
  entryTier: offer.entryTier,
  date: offer.date,
});

export const getReservationDefaultValuesFromPayState = (
  reservation: NormalizedCoworkReservationOrder
): CoworkReservationInput => {
  if (!isWorkspaceCoworkCurrentProductTier(reservation.entryTier)) {
    throw new Error(
      "Historical cowork tiers cannot be restored into the reservation form.",
      { cause: reservation.entryTier }
    );
  }

  return {
    entryTier: reservation.entryTier,
    date: reservation.date,
    coffee: reservation.coffee,
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone,
    billing: reservation.billing,
    ...(reservation.monitorOption !== undefined && {
      monitorOption: reservation.monitorOption,
    }),
    marketingConsent: false,
  };
};

/**
 * The form values for a signed cowork restoration, with the selection the
 * customer edited into the URL after returning from Pay.
 */
export const getCoworkRestoredReservationValues = (
  reservation: NormalizedCoworkReservationOrder,
  searchParams: SupportedSearchParams
): CoworkReservationInput => {
  const restoredValues = getReservationDefaultValuesFromPayState(reservation);
  if (
    !hasReservationSelectionSearchParams(searchParams, [
      "entryTier",
      "tier",
      "date",
      "coffee",
      "monitorOption",
    ])
  ) {
    return restoredValues;
  }

  const { entryTier, date, coffee, monitorOption } =
    getReservationDefaultValuesFromSearchParams(searchParams);
  return { ...restoredValues, entryTier, date, coffee, monitorOption };
};
