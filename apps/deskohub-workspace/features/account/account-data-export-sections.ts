/**
 * The client-safe catalog of the account data export archive: its schema
 * version and the exact, ordered list of archive entries. Both the backend
 * assembler and the account UI consume this module, so it must never import
 * a server-only capability.
 */

/**
 * The version of the exported archive shape. Increase it whenever an
 * exported section's meaning changes, never to flag data freshness.
 */
export const accountDataExportSchemaVersion = 2;

/**
 * The fixed manifest entry name. Every other archive entry must appear in
 * the manifest's section list; no other entry may exist.
 */
export const accountDataExportManifestPath = "manifest.json";

/**
 * One archive section: its fixed file name and the fixed English sentence
 * the manifest uses to describe it. The manifest text is English by design
 * (the archive is a stable machine-readable document); the account UI
 * presents localized section names from the message catalogs instead.
 */
export type AccountDataExportSection = {
  readonly path: string;
  readonly manifestDescription: string;
};

/**
 * The allowlisted archive sections in their fixed order. Everything the ZIP
 * contains comes from these projections; anything not expressible as one of
 * them is excluded and routed to the full manual access path.
 */
export const accountDataExportSections = [
  {
    path: "identity.json",
    manifestDescription:
      "Your account identity: the account identifier, the verified login email, the stored display name, account timestamps, and the deletion-request status.",
  },
  {
    path: "dotypos-profile.json",
    manifestDescription:
      "Your customer profile held by the booking system: names, phone number, and billing details. Null when no profile exists.",
  },
  {
    path: "reservation-history.json",
    manifestDescription:
      "Reservation summaries from the booking system, including current and past reservations: product, times, seats, and status.",
  },
  {
    path: "workspace-reservations.json",
    manifestDescription:
      "The workspace reservation records behind your bookings: product purpose, reservation, payment, and fulfillment state, and lifecycle timestamps.",
  },
  {
    path: "payments.json",
    manifestDescription:
      "Payment attempts for your reservations: provider kind, status, refund state, amount, timestamps, and any late-payment recovery outcome. No payment credentials or provider secrets.",
  },
  {
    path: "discount-applications.json",
    manifestDescription:
      "Discounts applied to your payments: label, the amounts before and after, and when each application was recorded.",
  },
  {
    path: "invoices.json",
    manifestDescription:
      "Metadata of invoices issued to you: invoice number, issue date, and the delivery status of the customer invoice email. The invoice PDF documents themselves are not included.",
  },
  {
    path: "consents.json",
    manifestDescription:
      "Your marketing communication consent record and the legal-acceptance evidence events recorded for your reservations.",
  },
  {
    path: "access-grants.json",
    manifestDescription:
      "Door-access grants for your reservations: grant state and the access interval. No access codes, PINs, or credentials.",
  },
] as const satisfies readonly AccountDataExportSection[];

export type AccountDataExportSectionPath =
  (typeof accountDataExportSections)[number]["path"];

/**
 * The fixed human-readable note carried in the manifest and every archive
 * consumer. It states the snapshot's non-atomic assembly so the reader of
 * the downloaded file cannot mistake it for a single consistent copy.
 */
export const accountDataExportNonAtomicityNote =
  "This archive was assembled during a single request from different systems. It is not an atomic cross-system transaction: data changed concurrently may appear in only some entries.";

/**
 * The fixed human-readable completeness note. The archive is deliberately
 * wider than the raw account record, but it is NOT a claim of full GDPR
 * compliance or completeness; records outside these sections remain
 * available through the full statutory access path.
 */
export const accountDataExportCompletenessNote =
  "This archive is not a complete copy of every record Deskohub holds about you. Credentials, session data, invoice documents, analytics and provider-held logs, and other retained records are excluded here and remain available through a full data-protection request.";
