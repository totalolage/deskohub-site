import { decodeStandardSchema } from "@deskohub/standard-schema";
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  workspaceProductMonitorOptions,
  workspaceProductTiers,
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

const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const queryDateSchema = z.iso.date().refine(isTodayOrFuturePragueDate);
const queryTierSchema = z.enum(workspaceProductTiers);
const queryMonitorOptionSchema = z.enum(workspaceProductMonitorOptions);
const queryNameSchema = z
  .string()
  .min(RESERVATION_VALIDATION.name.min)
  .max(RESERVATION_VALIDATION.name.max);
const queryEmailSchema = z
  .string()
  .max(RESERVATION_VALIDATION.email.max)
  .pipe(z.email());
const queryPhoneSchema = z
  .string()
  .max(RESERVATION_VALIDATION.phone.max)
  .refine((phone) => isValidPhoneNumber(phone, "CZ"));
const queryMessageSchema = z.string().max(RESERVATION_VALIDATION.message.max);

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
  const decoded: Partial<ReservationCheckoutQueryValues> = {};
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
    decoded.coffee = coffee;
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
  const values: ReservationInput = {
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
