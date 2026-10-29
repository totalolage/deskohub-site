import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getWorkspaceProductByTier,
  isWorkspaceCoworkCurrentProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type CoworkReservationInput,
  coworkReservationDefaultValues,
} from "@/features/reservation/cowork-reservation";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import {
  decodeReservationCheckoutCustomer,
  getTrimmedSearchParam,
} from "@/features/reservation/reservation-checkout-query";
import {
  getWorkspaceDate,
  isTodayOrFutureWorkspaceDate,
} from "@/features/reservation/reservation-date";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import { defineSelectionLink } from "@/features/reservation/selection-link";
import type { SupportedSearchParams } from "@/shared/utils";

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

/**
 * A cowork link names its add-ons together, or leaves both open for the
 * customer's last reservation of the tier to fill.
 */
type CoworkSelection = Pick<CoworkReservationInput, "entryTier"> &
  Partial<Pick<CoworkReservationInput, "date">> &
  (
    | Pick<CoworkReservationInput, "coffee" | "monitorOption">
    | { readonly coffee?: undefined; readonly monitorOption?: undefined }
  );

const decodeCoworkQuery = (
  searchParams: SupportedSearchParams
): Partial<CoworkReservationInput> => {
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
 * The cowork reservation page's link. A historical tier can't be booked
 * again, so a stored reservation of one gives no link.
 */
export const coworkSelectionLink = defineSelectionLink({
  kind: "cowork",
  params: ["entryTier", "date", "coffee", "monitorOption"],
  // Older links named the tier `tier`.
  legacyParams: ["tier"],
  /**
   * The customer's last cowork reservation fills the offer options the link
   * leaves open; a link naming another tier replaces the whole remembered
   * offer.
   */
  read: (
    searchParams: SupportedSearchParams,
    {
      lastReservation,
    }: {
      readonly lastReservation?: CustomerLastReservationForKind<"cowork">;
    } = {}
  ): CoworkReservationInput => {
    const query = decodeCoworkQuery(searchParams);
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
  },
  write: (selection: CoworkSelection) => ({
    entryTier: selection.entryTier,
    date: selection.date || undefined,
    ...(selection.coffee === undefined
      ? { coffee: undefined, monitorOption: undefined }
      : {
          coffee: String(selection.coffee),
          monitorOption:
            selection.monitorOption ??
            (getWorkspaceProductByTier(selection.entryTier).workstationAddon ===
            "optional"
              ? noMonitorQueryValue
              : undefined),
        }),
  }),
  /** The stored offer and date, with its add-ons. */
  fromStored: (
    reservation: StoredCoworkReservationDetails & {
      readonly reservedFrom: Temporal.Instant;
    }
  ): CoworkSelection | undefined =>
    isWorkspaceCoworkCurrentProductTier(reservation.entryTier)
      ? {
          entryTier: reservation.entryTier,
          date: getWorkspaceDate(reservation.reservedFrom).toString(),
          coffee: reservation.coffee,
          monitorOption: reservation.monitorOption,
        }
      : undefined,
});
