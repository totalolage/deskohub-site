import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import {
  getWorkspaceProductByTier,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  isTodayOrFuturePragueDate,
  RESERVATION_VALIDATION,
  type ReservationInput,
  reservationDefaultValues,
} from "@/features/reservation/schemas/reservation";
import {
  parseWorkspaceAvailabilityQuery,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/schemas/workspace-availability";
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
  ReservationInput,
  ReservationCheckoutQueryField
>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  Schema.String.check(
    Schema.isMinLength(RESERVATION_VALIDATION.name.min),
    Schema.isMaxLength(RESERVATION_VALIDATION.name.max)
  )
);
const queryEmailSchema = Schema.toStandardSchemaV1(
  Schema.String.check(
    Schema.isMaxLength(RESERVATION_VALIDATION.email.max),
    Schema.isPattern(emailPattern)
  )
);
const queryPhoneSchema = Schema.toStandardSchemaV1(
  Schema.String.check(
    Schema.isMaxLength(RESERVATION_VALIDATION.phone.max),
    Schema.makeFilter((phone) => isValidPhoneNumber(phone, "CZ"))
  )
);
const queryMessageSchema = Schema.toStandardSchemaV1(
  Schema.String.check(Schema.isMaxLength(RESERVATION_VALIDATION.message.max))
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
  const decoded: Partial<Mutable<ReservationCheckoutQueryValues>> = {};
  const requestedTier =
    getTrimmedSearchParam(searchParams, "entryTier") ??
    getTrimmedSearchParam(searchParams, "tier");

  const entryTier = decodeStandardSchema(queryTierSchema, requestedTier);
  if (entryTier !== undefined) {
    decoded.entryTier = entryTier;
  }

  const date = decodeStandardSchema(
    queryDateSchema,
    getTrimmedSearchParam(searchParams, "date")
  );
  if (date !== undefined) {
    decoded.date = date;
  }

  const coffee = decodeStandardSchema(
    queryBooleanSchema,
    getTrimmedSearchParam(searchParams, "coffee")
  );
  if (coffee !== undefined) {
    decoded.coffee = coffee === "true";
  }

  const monitorOption = decodeStandardSchema(
    queryMonitorOptionSchema,
    getTrimmedSearchParam(searchParams, "monitorOption")
  );
  if (monitorOption !== undefined) {
    decoded.monitorOption = monitorOption;
  }

  const name = decodeStandardSchema(
    queryNameSchema,
    getTrimmedSearchParam(searchParams, "name")
  );
  if (name !== undefined) {
    decoded.name = name;
  }

  const email = decodeStandardSchema(
    queryEmailSchema,
    getTrimmedSearchParam(searchParams, "email")
  );
  if (email !== undefined) {
    decoded.email = email;
  }

  const phone = decodeStandardSchema(
    queryPhoneSchema,
    getTrimmedSearchParam(searchParams, "phone")
  );
  if (phone !== undefined) {
    decoded.phone = phone;
  }

  const message = decodeStandardSchema(
    queryMessageSchema,
    getTrimmedSearchParam(searchParams, "message")
  );
  if (message !== undefined) {
    decoded.message = message;
  }

  return decoded;
};

export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams
): ReservationInput => {
  const values: Mutable<ReservationInput> = {
    ...reservationDefaultValues,
    ...decodeReservationCheckoutQuery(searchParams),
    legalConsent: false,
  };

  if (
    values.entryTier &&
    getWorkspaceProductByTier(values.entryTier).requiresCoffee
  ) {
    values.coffee = true;
  }

  if (
    values.entryTier &&
    !getWorkspaceProductByTier(values.entryTier).requiresMonitorOption
  ) {
    values.monitorOption = undefined;
  }

  return values;
};

export const getWorkspaceAvailabilityQueryFromReservationSearchParams = (
  searchParams: SupportedSearchParams
): WorkspaceAvailabilityQuery => {
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

  return parseWorkspaceAvailabilityQuery(availabilitySearchParams);
};
