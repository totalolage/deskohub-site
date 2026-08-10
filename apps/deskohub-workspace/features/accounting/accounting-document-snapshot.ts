import { Match, Schema } from "effect";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const accountingBuyerAddressSchema = Schema.Struct({
  line1: Schema.optionalKey(Schema.NonEmptyString),
  line2: Schema.optionalKey(Schema.NonEmptyString),
  city: Schema.optionalKey(Schema.NonEmptyString),
  postalCode: Schema.optionalKey(Schema.NonEmptyString),
  country: Schema.optionalKey(Schema.NonEmptyString),
});

const personalAccountingBuyerSchema = Schema.Struct({
  kind: Schema.Literal("person"),
  legalName: Schema.NonEmptyString,
  address: Schema.optionalKey(accountingBuyerAddressSchema),
});

const businessAccountingBuyerSchema = Schema.Struct({
  kind: Schema.Literal("business"),
  legalName: Schema.NonEmptyString,
  companyId: Schema.NonEmptyString,
  vatId: Schema.optionalKey(Schema.NonEmptyString),
  address: Schema.Struct({
    line1: Schema.NonEmptyString,
    line2: Schema.optionalKey(Schema.NonEmptyString),
    city: Schema.NonEmptyString,
    postalCode: Schema.NonEmptyString,
    country: Schema.NonEmptyString,
  }),
});

export const accountingBuyerSchema = Schema.Union([
  personalAccountingBuyerSchema,
  businessAccountingBuyerSchema,
]);

export type AccountingBuyer = typeof accountingBuyerSchema.Type;

const accountingSupplierSchema = Schema.Struct({
  legalName: Schema.NonEmptyString,
  companyId: Schema.NonEmptyString,
  vatStatus: Schema.Literal("not-vat-payer"),
  address: Schema.Struct({
    street: Schema.NonEmptyString,
    cityDistrict: Schema.NonEmptyString,
    city: Schema.NonEmptyString,
    postalCode: Schema.NonEmptyString,
    country: Schema.NonEmptyString,
  }),
  contactEmail: Schema.NonEmptyString,
});

const accountingSnapshotIdentitySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  workspaceReservationId: Schema.NonEmptyString,
  dotyposReservationId: Schema.NonEmptyString,
  dotyposCustomerId: Schema.NonEmptyString,
  locale: Schema.Literals(["cs-CZ", "en-US"]),
  supplier: accountingSupplierSchema,
  buyer: accountingBuyerSchema,
});

const coworkAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingSnapshotIdentitySchema.fields,
  reservation: Schema.Struct({
    kind: Schema.Literal("cowork"),
    date: plainDateStringSchema,
  }),
  quote: coworkReservationQuoteSchema,
});

const meetingRoomAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingSnapshotIdentitySchema.fields,
  reservation: Schema.Struct({
    kind: Schema.Literal("meeting-room"),
    startsAt: instantStringSchema,
    endsAt: instantStringSchema,
  }),
  quote: meetingRoomReservationQuoteSchema,
});

export const accountingDocumentSnapshotSchema = Schema.Union([
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
]).annotate({
  identifier: "AccountingDocumentSnapshot",
  description:
    "Immutable billing and accepted-price facts used to issue an accounting document.",
});

export type AccountingDocumentSnapshot =
  typeof accountingDocumentSnapshotSchema.Type;

const supplier: typeof accountingSupplierSchema.Type = {
  legalName: workspaceSiteConstants.brand.legalName,
  companyId: workspaceSiteConstants.company.identificationNumber,
  vatStatus: workspaceSiteConstants.company.vatStatus,
  address: {
    ...workspaceSiteConstants.location.address,
    country: "CZ",
  },
  contactEmail: workspaceSiteConstants.contact.infoEmail,
};

export const makeAccountingDocumentSnapshot = (input: {
  readonly workspaceReservationId: string;
  readonly dotyposReservationId: string;
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly prepared: PreparedCustomerQuote;
  readonly buyer?: AccountingBuyer;
}): AccountingDocumentSnapshot => {
  const identity = {
    schemaVersion: 1 as const,
    workspaceReservationId: input.workspaceReservationId,
    dotyposReservationId: input.dotyposReservationId,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    supplier,
    buyer: input.buyer ?? {
      kind: "person" as const,
      legalName: input.prepared.reservation.name,
    },
  };

  return Match.value(input.prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "cowork" as const,
          date: reservation.date,
        },
        quote,
      }),
      "meeting-room": ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "meeting-room" as const,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
        },
        quote,
      }),
    })
  );
};
