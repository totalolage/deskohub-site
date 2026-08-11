import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservationId,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Match, Schema } from "effect";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { officeReservationQuoteSchema } from "@/features/checkout/reservation-quote-office";
import type { Locale } from "@/features/i18n";
import { officeReservationDetailsSchema } from "@/features/reservation/office-reservation";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

export const accountingSnapshotKeyIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Z][A-Z0-9_]{2,31}$/)
)
  .pipe(Schema.brand("AccountingSnapshotKeyId"))
  .annotate({
    identifier: "AccountingSnapshotKeyId",
    description: "Identifier selecting an accounting snapshot encryption key.",
  });

export type AccountingSnapshotKeyId = typeof accountingSnapshotKeyIdSchema.Type;

export const companyRegistrationIdSchema = Schema.Trim.check(
  Schema.isNonEmpty()
)
  .pipe(Schema.brand("CompanyRegistrationId"))
  .annotate({
    identifier: "CompanyRegistrationId",
    description: "Company registration identifier used on accounting records.",
  });
export type CompanyRegistrationId = typeof companyRegistrationIdSchema.Type;

export const vatRegistrationIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("VatRegistrationId"))
  .annotate({
    identifier: "VatRegistrationId",
    description: "VAT registration identifier used on accounting records.",
  });
export type VatRegistrationId = typeof vatRegistrationIdSchema.Type;

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
  companyId: companyRegistrationIdSchema,
  vatId: Schema.optionalKey(vatRegistrationIdSchema),
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
  companyId: companyRegistrationIdSchema,
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
  workspaceReservationId: workspaceReservationIdSchema,
  dotyposReservationId: DotyposReservationIdSchema,
  dotyposCustomerId: DotyposCustomerIdSchema,
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

const officeAccountingDocumentSnapshotSchema = Schema.Struct({
  ...accountingSnapshotIdentitySchema.fields,
  reservation: officeReservationDetailsSchema,
  quote: officeReservationQuoteSchema,
});

export const accountingDocumentSnapshotSchema = Schema.Union([
  coworkAccountingDocumentSnapshotSchema,
  meetingRoomAccountingDocumentSnapshotSchema,
  officeAccountingDocumentSnapshotSchema,
]).annotate({
  identifier: "AccountingDocumentSnapshot",
  description:
    "Immutable billing and accepted-price facts used to issue an accounting document.",
});

export type AccountingDocumentSnapshot =
  typeof accountingDocumentSnapshotSchema.Type;

const supplier: typeof accountingSupplierSchema.Type = {
  legalName: workspaceSiteConstants.brand.legalName,
  companyId: companyRegistrationIdSchema.make(
    workspaceSiteConstants.company.identificationNumber
  ),
  vatStatus: workspaceSiteConstants.company.vatStatus,
  address: {
    ...workspaceSiteConstants.location.address,
    country: "CZ",
  },
  contactEmail: workspaceSiteConstants.contact.infoEmail,
};

export const makeAccountingDocumentSnapshot = (input: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
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
      office: ({ quote, reservation }) => ({
        ...identity,
        reservation: {
          kind: "office" as const,
          startsOn: reservation.startsOn,
          endsOn: reservation.endsOn,
          seats: reservation.seats,
        },
        quote,
      }),
    })
  );
};
