import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getWorkspaceProductByTier,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type CoworkReservationInput,
  coworkReservationDefaultValues,
} from "@/features/reservation/cowork-reservation";
import {
  reservationCustomerEmailSchema,
  reservationCustomerMessageSchema,
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import { isTodayOrFuturePragueDate } from "@/features/reservation/reservation-date";
import {
  type CoworkWorkspaceAvailabilityQuery,
  parseWorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

const reservationCheckoutQueryFields = [
  "entryTier",
  "date",
  "coffee",
  "monitorOption",
  "name",
  "email",
  "phone",
  "message",
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
    Schema.makeFilter(isTodayOrFuturePragueDate)
  )
);
const queryTierSchema = Schema.toStandardSchemaV1(
  Schema.Literals(workspaceCoworkProductTiers)
);
const queryMonitorOptionSchema = Schema.toStandardSchemaV1(
  Schema.Literals(workspaceProductMonitorOptions)
);
const queryNameSchema = Schema.toStandardSchemaV1(
  reservationCustomerNameSchema
);
const queryEmailSchema = Schema.toStandardSchemaV1(
  reservationCustomerEmailSchema
);
const queryPhoneSchema = Schema.toStandardSchemaV1(
  reservationCustomerPhoneSchema
);
const queryMessageSchema = Schema.toStandardSchemaV1(
  reservationCustomerMessageSchema
);

const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

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

  const name = decodeStandardSchema(
    queryNameSchema,
    getTrimmedSearchParam(searchParams, "name")
  );

  const email = decodeStandardSchema(
    queryEmailSchema,
    getTrimmedSearchParam(searchParams, "email")
  );

  const phone = decodeStandardSchema(
    queryPhoneSchema,
    getTrimmedSearchParam(searchParams, "phone")
  );

  const message = decodeStandardSchema(
    queryMessageSchema,
    getTrimmedSearchParam(searchParams, "message")
  );
  return {
    ...(entryTier !== undefined && { entryTier }),
    ...(date !== undefined && { date }),
    ...(coffee !== undefined && { coffee: coffee === "true" }),
    ...(monitorOption !== undefined && { monitorOption }),
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(phone !== undefined && { phone }),
    ...(message !== undefined && { message }),
  };
};

export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams
): CoworkReservationInput => {
  const values: CoworkReservationInput = {
    ...coworkReservationDefaultValues,
    ...decodeReservationCheckoutQuery(searchParams),
    legalConsent: false,
  };

  const product = getWorkspaceProductByTier(values.entryTier);

  return {
    ...values,
    ...(product.requiresCoffee && { coffee: true }),
    ...(!product.requiresMonitorOption && { monitorOption: undefined }),
  };
};

export const getWorkspaceAvailabilityQueryFromReservationSearchParams = (
  searchParams: SupportedSearchParams
): CoworkWorkspaceAvailabilityQuery => {
  const defaultValues =
    getReservationDefaultValuesFromSearchParams(searchParams);
  const availabilitySearchParams = new URLSearchParams();

  if (defaultValues.date) {
    availabilitySearchParams.set("date", defaultValues.date);
  }
  if (defaultValues.entryTier) {
    availabilitySearchParams.set("entryTier", defaultValues.entryTier);
  }
  if (defaultValues.monitorOption) {
    availabilitySearchParams.set("monitorOption", defaultValues.monitorOption);
  }

  const query = parseWorkspaceAvailabilityQuery(availabilitySearchParams);

  if (query._tag !== "cowork") {
    throw new Error("Cowork checkout query produced a meeting-room query.");
  }

  return query;
};
