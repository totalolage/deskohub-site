import {
  customerInputParseOptions,
  customerProfileSchemas,
} from "@deskohub/workspace-customer-api";
import { Option, Schema } from "effect";
import type { CustomerInvoiceSummary } from "@/features/accounting/customer-invoice";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/*
 * The profile schemas are the customer API's, so the account forms and the
 * mobile app validate a profile identically. A phone typed without a country
 * calling code reads in the default region of the visitor's locale. The forms
 * submit the phone number they read in the page's locale, so an action whose
 * locale has since moved to a saved preference still saves that number.
 */
export {
  type CustomerProfile,
  type CustomerProfileCompletionInput,
  type CustomerProfileCompletionSave,
  type CustomerProfileInput,
  type CustomerProfileSave,
  customerProfileBusinessBillingFields,
  type ProfileCompletionReferralOutcome,
} from "@deskohub/workspace-customer-api";

const customerProfileContracts = (locale: Locale) =>
  customerProfileSchemas(defaultPhoneRegion(locale));

/** The profile save a visitor in `locale` submits. */
export const updateCustomerProfileSchema = (locale: Locale) =>
  customerProfileContracts(locale).save;

/** The first-time completion a visitor in `locale` submits. */
export const completeCustomerProfileSchema = (locale: Locale) =>
  customerProfileContracts(locale).completionSave;

/** The profile save the update action reads from a request in `locale`. */
export const updateCustomerProfileStandardSchema = (locale: Locale) =>
  Schema.toStandardSchemaV1(updateCustomerProfileSchema(locale), {
    parseOptions: customerInputParseOptions,
  });

/** The completion save the completion action reads from a request in `locale`. */
export const completeCustomerProfileStandardSchema = (locale: Locale) =>
  Schema.toStandardSchemaV1(completeCustomerProfileSchema(locale), {
    parseOptions: customerInputParseOptions,
  });

export type CustomerReservationStatus =
  | "cancelled"
  | "confirmed"
  | "pending"
  | "requires-attention";

export type CustomerReservationProduct =
  | { readonly kind: "cowork"; readonly tier: WorkspaceCoworkProductTier }
  | { readonly kind: "meeting-room" }
  | { readonly kind: "office" }
  | { readonly kind: "other" };

/**
 * The other party of a reservation in the account history: the customer the
 * account booked it for, or the account that booked it for the account's own
 * customer. A name that could not be read is null, and a deleted author is
 * never named.
 */
export type CustomerReservationParty =
  | { readonly kind: "booked-for"; readonly customerName: string | null }
  | { readonly kind: "booked-by"; readonly authorName: string | null }
  | { readonly kind: "booked-by-deleted-account" };

export type CustomerReservationSummary = {
  readonly id: string;
  readonly workspaceReservationId?: WorkspaceReservationId;
  /**
   * Marks a review account's sample or simulated hold: it has a status page
   * but never an access code.
   */
  readonly reviewSandbox?: true;
  /** Absent when the account's own customer booked it for itself. */
  readonly party?: CustomerReservationParty;
  readonly product: CustomerReservationProduct;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  readonly setupStartsAt?: string;
  readonly seats: number | null;
  readonly status: CustomerReservationStatus;
};

export type CustomerReservationGroups = {
  readonly current: readonly CustomerReservationSummary[];
  readonly past: readonly CustomerReservationSummary[];
  readonly unavailable: readonly CustomerReservationSummary[];
};

export type CustomerReservationHistory =
  | { readonly kind: "available"; readonly groups: CustomerReservationGroups }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "email-unverified"
        | "link-required"
        | "provider-unavailable";
    };

/**
 * One issued invoice as the account shows it: its facts, the same facts
 * formatted on the server in the page's locale, and its PDF download.
 */
export interface CustomerInvoiceHistoryItem {
  readonly invoice: CustomerInvoiceSummary;
  readonly display: {
    readonly issuedOn: string;
    readonly total: string;
    readonly status: string;
    /** `null` while the invoice requests no payment. */
    readonly dueDate: string | null;
  };
  readonly pdfPath: string;
}

/**
 * The account's issued invoices: `unavailable` when the session has no
 * active account whose invoices it may see, `failed` when they couldn't be
 * read.
 */
export type CustomerInvoiceHistory =
  | {
      readonly kind: "populated";
      readonly invoices: readonly CustomerInvoiceHistoryItem[];
      readonly exportPath: string;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" };

export type CustomerAvatarPresentation =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "available";
      readonly avatar: {
        readonly url: string;
        readonly version?: number;
      } | null;
    };

/**
 * Whether the account page offers deletion: `pending` once it is requested
 * and retryable, `withheld` for a review account or while that can't be
 * ruled out.
 */
export type AccountDeletion = "offered" | "pending" | "withheld";

const parseInstant = Option.liftThrowable((value: string) =>
  Temporal.Instant.from(value)
);

/**
 * Groups a customer's reservations for the account history. Cancelled
 * reservations always count as past, a reservation is current until its exact
 * end instant, and a missing or unparseable end date leaves the reservation
 * undated in the unavailable group instead of crashing the page.
 */
export const groupCustomerReservations = (
  reservations: readonly CustomerReservationSummary[],
  now: Temporal.Instant = Temporal.Now.instant()
): CustomerReservationGroups => {
  const current: CustomerReservationSummary[] = [];
  const past: CustomerReservationSummary[] = [];
  const unavailable: CustomerReservationSummary[] = [];

  for (const reservation of reservations) {
    const end = reservation.endsAt
      ? Option.getOrNull(parseInstant(reservation.endsAt))
      : null;
    if (!end) {
      unavailable.push(reservation);
    } else if (
      reservation.status === "cancelled" ||
      Temporal.Instant.compare(end, now) <= 0
    ) {
      past.push(reservation);
    } else {
      current.push(reservation);
    }
  }
  return { current, past, unavailable };
};
