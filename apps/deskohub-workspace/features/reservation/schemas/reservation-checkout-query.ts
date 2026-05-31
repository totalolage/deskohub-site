import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const queryEmailSchema = z
  .string()
  .max(RESERVATION_VALIDATION.email.max)
  .pipe(z.email());

const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

const decodeBooleanParam = (value: string | undefined) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const isSafeDateParam = (value: string | undefined) => {
  if (!value || !datePattern.test(value)) return false;

  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    value === parsed.toISOString().slice(0, 10) &&
    isTodayOrFuturePragueDate(value)
  );
};

const isValidNameParam = (value: string) =>
  value.length >= RESERVATION_VALIDATION.name.min &&
  value.length <= RESERVATION_VALIDATION.name.max;

const isValidEmailParam = (value: string) =>
  queryEmailSchema.safeParse(value).success;

const isValidPhoneParam = (value: string) =>
  value.length <= RESERVATION_VALIDATION.phone.max &&
  isValidPhoneNumber(value, "CZ");

const isValidMessageParam = (value: string) =>
  value.length <= RESERVATION_VALIDATION.message.max;

export const decodeReservationCheckoutQuery = (
  searchParams: SupportedSearchParams
): Partial<ReservationCheckoutQueryValues> => {
  const decoded: Partial<ReservationCheckoutQueryValues> = {};
  const requestedTier =
    getTrimmedSearchParam(searchParams, "entryTier") ??
    getTrimmedSearchParam(searchParams, "tier");

  if (isWorkspaceProductTier(requestedTier)) {
    decoded.entryTier = requestedTier;
  }

  const date = getTrimmedSearchParam(searchParams, "date");
  if (isSafeDateParam(date)) {
    decoded.date = date;
  }

  const coffee = decodeBooleanParam(
    getTrimmedSearchParam(searchParams, "coffee")
  );
  if (coffee !== undefined) {
    decoded.coffee = coffee;
  }

  const monitorOption = getTrimmedSearchParam(searchParams, "monitorOption");
  if (isWorkspaceProductMonitorOption(monitorOption)) {
    decoded.monitorOption = monitorOption;
  }

  const name = getTrimmedSearchParam(searchParams, "name");
  if (name !== undefined && isValidNameParam(name)) {
    decoded.name = name;
  }

  const email = getTrimmedSearchParam(searchParams, "email");
  if (email !== undefined && isValidEmailParam(email)) {
    decoded.email = email;
  }

  const phone = getTrimmedSearchParam(searchParams, "phone");
  if (phone !== undefined && isValidPhoneParam(phone)) {
    decoded.phone = phone;
  }

  const message = getTrimmedSearchParam(searchParams, "message");
  if (message !== undefined && isValidMessageParam(message)) {
    decoded.message = message;
  }

  return decoded;
};

export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams
): ReservationInput => {
  const values = {
    ...reservationDefaultValues,
    ...decodeReservationCheckoutQuery(searchParams),
    legalConsent: false,
  } satisfies ReservationInput;

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
