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
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

export const reservationCheckoutQueryFields = [
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

export type ReservationCheckoutQueryValues = Pick<
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
const queryMessageSchema = z
  .string()
  .max(RESERVATION_VALIDATION.message.max);

const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

const decodeQueryParam = <T>(schema: z.ZodType<T>, value: string | undefined) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export const decodeReservationCheckoutQuery = (
  searchParams: SupportedSearchParams
): Partial<ReservationCheckoutQueryValues> => {
  const decoded: Partial<ReservationCheckoutQueryValues> = {};
  const requestedTier =
    getTrimmedSearchParam(searchParams, "entryTier") ??
    getTrimmedSearchParam(searchParams, "tier");

  const entryTier = decodeQueryParam(queryTierSchema, requestedTier);
  if (entryTier !== undefined) {
    decoded.entryTier = entryTier;
  }

  const date = decodeQueryParam(
    queryDateSchema,
    getTrimmedSearchParam(searchParams, "date")
  );
  if (date !== undefined) {
    decoded.date = date;
  }

  const coffee = decodeQueryParam(
    queryBooleanSchema,
    getTrimmedSearchParam(searchParams, "coffee")
  );
  if (coffee !== undefined) {
    decoded.coffee = coffee;
  }

  const monitorOption = decodeQueryParam(
    queryMonitorOptionSchema,
    getTrimmedSearchParam(searchParams, "monitorOption")
  );
  if (monitorOption !== undefined) {
    decoded.monitorOption = monitorOption;
  }

  const name = decodeQueryParam(
    queryNameSchema,
    getTrimmedSearchParam(searchParams, "name")
  );
  if (name !== undefined) {
    decoded.name = name;
  }

  const email = decodeQueryParam(
    queryEmailSchema,
    getTrimmedSearchParam(searchParams, "email")
  );
  if (email !== undefined) {
    decoded.email = email;
  }

  const phone = decodeQueryParam(
    queryPhoneSchema,
    getTrimmedSearchParam(searchParams, "phone")
  );
  if (phone !== undefined) {
    decoded.phone = phone;
  }

  const message = decodeQueryParam(
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
