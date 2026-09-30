import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import {
  accountDataExportManifestPath,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "../account-data-export-sections";
import { customerAccountIdSchema } from "../customer-account";
import { AccountDataExportService } from "./account-data-export.service";
import {
  AccountDataExportRecordBoundExceededError,
  AccountDataExportRecordsRepository,
  accountDataExportRecordBounds,
  type CustomerExportRecords,
  type ExportedAccessGrant,
  type ExportedInvoice,
  type ExportedInvoiceDelivery,
  type ExportedLatePaymentRecovery,
  type ExportedLegalEvidenceEvent,
  type ExportedPaymentAttempt,
  type ExportedWorkspaceReservation,
} from "./account-data-export-records.repository";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";

const account = {
  accountId: customerAccountIdSchema.make("auth-user-export"),
  dotyposCustomerId: "60411",
};

const session = {
  accountId: account.accountId,
  email: "ada@example.test",
  deletionRequested: false,
  displayName: "Ada Lovelace",
  accountCreatedAt: new Date("2026-01-02T03:04:05.000Z"),
  accountUpdatedAt: new Date("2026-02-03T04:05:06.000Z"),
} as const;

const profile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420000000000",
  billing: null,
} as const;

const activeState = { kind: "active", deletionRequestedAt: null } as const;
const summary = {
  id: "reservation-1",
  workspaceReservationId: "wr-1",
  product: { kind: "meeting-room" },
  startsAt: "2026-09-01T09:00:00.000Z",
  endsAt: "2026-09-01T11:00:00.000Z",
  seats: 2,
  status: "confirmed",
} as const;

const emptyRecords: CustomerExportRecords = {
  reservations: [],
  payments: [],
  discountApplications: [],
  invoices: [],
  invoiceDeliveries: [],
  legalEvidenceEvents: [],
  accessGrants: [],
  latePaymentRecoveries: [],
};

const populatedRecords: CustomerExportRecords = {
  reservations: [
    {
      workspaceReservationId: "wr-1",
      dotyposReservationId: "dotypos-1",
      reservationPurpose: null,
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      locale: "en-US",
      reservationCreatedAt: "2026-08-01T00:00:00.000Z",
      reservationConfirmedAt: "2026-08-01T00:05:00.000Z",
      reservationCancelledAt: null,
      paidAt: "2026-08-01T00:06:00.000Z",
      fulfilledAt: "2026-08-01T00:07:00.000Z",
    },
  ],
  payments: [
    {
      workspaceReservationId: "wr-1",
      provider: "nexi",
      state: "paid",
      refundState: "not_required",
      amountValue: 12000,
      amountExponent: 2,
      currency: "CZK",
      createdAt: "2026-08-01T00:05:30.000Z",
      updatedAt: "2026-08-01T00:06:00.000Z",
    },
  ],
  discountApplications: [
    {
      workspaceReservationId: "wr-1",
      sequence: 0,
      publicDiscountId: "discount-1",
      label: "Opening discount",
      subtotalBeforeValue: 12000,
      subtotalBeforeExponent: 2,
      subtotalBeforeCurrency: "CZK",
      appliedAmountValue: 1000,
      appliedAmountExponent: 2,
      appliedAmountCurrency: "CZK",
      subtotalAfterValue: 11000,
      subtotalAfterExponent: 2,
      subtotalAfterCurrency: "CZK",
      createdAt: "2026-08-01T00:05:31.000Z",
    },
  ],
  invoices: [
    {
      invoiceNumber: "2026001",
      issuedAt: "2026-08-02T00:00:00.000Z",
      numberingYear: 2026,
      numberingSequence: 1,
      workspaceReservationId: "wr-1",
      paymentAttemptId: "attempt-1",
      documentSnapshotRecordedAt: "2026-08-02T00:01:00.000Z",
    },
  ],
  invoiceDeliveries: [
    {
      invoiceNumber: "2026001",
      state: "accepted",
      createdAt: "2026-08-02T00:02:00.000Z",
      acceptedAt: "2026-08-02T00:02:10.000Z",
    },
  ],
  legalEvidenceEvents: [
    {
      workspaceReservationId: "wr-1",
      documentKey: "terms",
      accepted: true,
      acceptedAt: "2026-08-01T00:04:00.000Z",
      locale: "en-US",
      source: "checkout",
    },
  ],
  accessGrants: [
    {
      workspaceReservationId: "wr-1",
      state: "issued",
      scheduledAccessStartsAt: "2026-09-01T09:00:00.000Z",
      accessStartsAt: "2026-09-01T08:45:00.000Z",
      accessEndsAt: "2026-09-01T11:15:00.000Z",
      issuedAt: "2026-08-30T00:00:00.000Z",
    },
  ],
  latePaymentRecoveries: [],
};

const makeLayers = (fakes: {
  readonly accountState?: typeof activeState | { kind: "missing" };
  readonly profile?: typeof profile | null;
  readonly profileFailure?: Error;
  readonly historyGroups?: {
    readonly current: readonly unknown[];
    readonly past: readonly unknown[];
    readonly unavailable: readonly unknown[];
  };
  readonly historyFailure?: Error;
  readonly consent?: {
    readonly grantedAt: Temporal.Instant;
    readonly withdrawnAt: Temporal.Instant | null;
    readonly locale: string;
    readonly documentHash: string;
    readonly dotyposCustomerId: string;
  } | null;
  readonly consentFailure?: Error;
  readonly records?: CustomerExportRecords;
  readonly recordsFailure?: Error;
}) => {
  const state =
    fakes.accountState ??
    ({ kind: "active", deletionRequestedAt: null } as const);

  const links = Layer.mock(CustomerAccountLinkRepository, {
    findActivityState: () => Effect.succeed(state),
  } satisfies Partial<CustomerAccountLinkRepository["Service"]>);

  const dotypos = Layer.mock(CustomerDotyposAdapter, {
    readCustomerProfile: () =>
      fakes.profileFailure
        ? Effect.fail(fakes.profileFailure)
        : Effect.succeed(fakes.profile === undefined ? profile : fakes.profile),
  } satisfies Partial<CustomerDotyposAdapter["Service"]>);

  const history = Layer.mock(CustomerReservationHistoryService, {
    load: () =>
      fakes.historyFailure
        ? Effect.fail(fakes.historyFailure)
        : Effect.succeed({
            kind: "available",
            groups: fakes.historyGroups ?? {
              current: [summary],
              past: [],
              unavailable: [],
            },
          } as const),
  } satisfies Partial<CustomerReservationHistoryService["Service"]>);

  const consents = Layer.mock(CustomerMarketingConsentRepository, {
    get: () =>
      fakes.consentFailure
        ? Effect.fail(fakes.consentFailure)
        : Effect.succeed(fakes.consent ?? null),
  } satisfies Partial<CustomerMarketingConsentRepository["Service"]>);

  const exportRecords = Layer.mock(AccountDataExportRecordsRepository, {
    loadCustomerRecords: () =>
      fakes.recordsFailure
        ? Effect.fail(fakes.recordsFailure)
        : Effect.succeed(fakes.records ?? emptyRecords),
  } satisfies Partial<AccountDataExportRecordsRepository["Service"]>);

  return AccountDataExportService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(links, dotypos, history, consents, exportRecords)
    )
  );
};

const buildExport = (layer: Layer.Layer<AccountDataExportService>) =>
  Effect.runPromise(
    Effect.flatMap(AccountDataExportService, (service) =>
      service.build({ account, session })
    ).pipe(Effect.provide(layer), Effect.result)
  );

const forbiddenKeyPattern =
  /token|secret|pin|password|session|hash|credential|cookie|securitytoken|redirect|accesscode/i;

describe("AccountDataExportService", () => {
  test("produces exactly the manifest plus the allowlisted sections in order", async () => {
    const result = await buildExport(
      makeLayers({
        consent: {
          grantedAt: Temporal.Instant.from("2026-03-01T00:00:00Z"),
          withdrawnAt: null,
          locale: "en-US",
          documentHash: "synthetic-document-hash",
          dotyposCustomerId: account.dotyposCustomerId,
        },
        records: populatedRecords,
      })
    );
    if (result.failure) throw result.failure;

    const { entries } = result.success;
    const expectedPaths = [
      accountDataExportManifestPath,
      ...accountDataExportSections.map((section) => section.path),
    ];
    expect(entries.map((entry) => entry.path)).toEqual(expectedPaths);

    const manifest = entries[0]?.content as {
      schemaVersion: number;
      generatedAt: string;
      sections: readonly { path: string; description: string }[];
      assembledDuringRequest: boolean;
      nonAtomicityNote: string;
      completenessNote: string;
    };
    expect(manifest.schemaVersion).toBe(accountDataExportSchemaVersion);
    expect(Number.isFinite(Date.parse(manifest.generatedAt))).toBe(true);
    expect(manifest.assembledDuringRequest).toBe(true);
    expect(manifest.sections.map((section) => section.path)).toEqual(
      accountDataExportSections.map((section) => section.path)
    );
    for (const [index, section] of manifest.sections.entries()) {
      expect(section.description).toBe(
        accountDataExportSections[index]?.manifestDescription
      );
    }
    expect(manifest.nonAtomicityNote).toBe(
      "This archive was assembled during a single request from different systems. It is not an atomic cross-system transaction: data changed concurrently may appear in only some entries."
    );
    expect(manifest.completenessNote).toContain(
      "not a complete copy of every record"
    );
  });

  test("carries the customer-scoped first-party records with literal section keys", async () => {
    const result = await buildExport(
      makeLayers({
        records: populatedRecords,
        consent: {
          grantedAt: Temporal.Instant.from("2026-03-01T00:00:00Z"),
          withdrawnAt: null,
          locale: "en-US",
          documentHash: "synthetic-document-hash",
          dotyposCustomerId: account.dotyposCustomerId,
        },
      })
    );
    if (result.failure) throw result.failure;
    const contentByPath = new Map(
      result.success.entries.map((entry) => [entry.path, entry.content])
    );

    const workspaceReservations = contentByPath.get(
      "workspace-reservations.json"
    ) as readonly ExportedWorkspaceReservation[];
    expect(Object.keys(workspaceReservations[0]!)).toEqual([
      "workspaceReservationId",
      "dotyposReservationId",
      "reservationPurpose",
      "reservationState",
      "paymentState",
      "fulfillmentState",
      "locale",
      "reservationCreatedAt",
      "reservationConfirmedAt",
      "reservationCancelledAt",
      "paidAt",
      "fulfilledAt",
    ]);

    const payments = contentByPath.get("payments.json") as {
      payments: readonly ExportedPaymentAttempt[];
      latePaymentRecoveries: readonly ExportedLatePaymentRecovery[];
    };
    expect(Object.keys(payments.payments[0]!)).toEqual([
      "workspaceReservationId",
      "provider",
      "state",
      "refundState",
      "amountValue",
      "amountExponent",
      "currency",
      "createdAt",
      "updatedAt",
    ]);
    expect(payments.latePaymentRecoveries).toEqual([]);

    const invoices = contentByPath.get("invoices.json") as {
      invoices: readonly ExportedInvoice[];
      customerEmailDeliveries: readonly ExportedInvoiceDelivery[];
    };
    expect(Object.keys(invoices.invoices[0]!)).toEqual([
      "invoiceNumber",
      "issuedAt",
      "numberingYear",
      "numberingSequence",
      "workspaceReservationId",
      "paymentAttemptId",
      "documentSnapshotRecordedAt",
    ]);
    expect(Object.keys(invoices.customerEmailDeliveries[0]!)).toEqual([
      "invoiceNumber",
      "state",
      "createdAt",
      "acceptedAt",
    ]);

    const consents = contentByPath.get("consents.json") as {
      marketingConsent: { grantedAt: string } | null;
      legalEvidenceEvents: readonly ExportedLegalEvidenceEvent[];
    };
    expect(consents.marketingConsent).toEqual({
      grantedAt: "2026-03-01T00:00:00Z",
      withdrawnAt: null,
      locale: "en-US",
    });
    expect(Object.keys(consents.legalEvidenceEvents[0]!)).toEqual([
      "workspaceReservationId",
      "documentKey",
      "accepted",
      "acceptedAt",
      "locale",
      "source",
    ]);

    const accessGrants = contentByPath.get("access-grants.json") as {
      accessGrants: readonly ExportedAccessGrant[];
    };
    expect(Object.keys(accessGrants.accessGrants[0]!)).toEqual([
      "workspaceReservationId",
      "state",
      "scheduledAccessStartsAt",
      "accessStartsAt",
      "accessEndsAt",
      "issuedAt",
    ]);
  });

  test("serializes no secret-shaped key anywhere in the archive", async () => {
    const result = await buildExport(makeLayers({ records: populatedRecords }));
    if (result.failure) throw result.failure;
    // The pattern is applied to every serialized object KEY in the archive
    // (prose in the manifest legitimately names what is excluded), plus the
    // exact stored secret values must never survive as values.
    const serialized = JSON.stringify(result.success.entries);
    const keys = Array.from(
      new Set(
        Array.from(serialized.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":/g)).map(
          (match) => match[1] ?? ""
        )
      )
    );
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(forbiddenKeyPattern.test(key)).toBe(false);
    }
    expect(serialized).not.toContain("synthetic-document-hash");
  });

  test("exports explicit nulls for a missing profile and missing consent, with empty record lists", async () => {
    const result = await buildExport(makeLayers({ profile: null }));
    if (result.failure) throw result.failure;
    const contentByPath = new Map(
      result.success.entries.map((entry) => [entry.path, entry.content])
    );
    expect(contentByPath.get("dotypos-profile.json")).toBeNull();
    expect(contentByPath.get("reservation-history.json")).toEqual([summary]);
    const consents = contentByPath.get("consents.json") as {
      marketingConsent: unknown;
    };
    expect(consents.marketingConsent).toBeNull();
    const identity = contentByPath.get("identity.json") as {
      email: string;
      emailVerified: boolean;
      deletionRequested: boolean;
    };
    expect(identity.email).toBe("ada@example.test");
    expect(identity.emailVerified).toBe(true);
    expect(identity.deletionRequested).toBe(false);
  });

  test("fails the whole export when the profile provider fails", async () => {
    const result = await buildExport(
      makeLayers({ profileFailure: new Error("dotypos down") })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("unavailable");
  });

  test("fails the whole export when reservation history fails", async () => {
    const result = await buildExport(
      makeLayers({ historyFailure: new Error("db down") })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("unavailable");
  });

  test("fails the whole export when the consent store fails", async () => {
    const result = await buildExport(
      makeLayers({ consentFailure: new Error("db down") })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("unavailable");
  });

  test("fails the whole export when the first-party records repository fails", async () => {
    const result = await buildExport(
      makeLayers({ recordsFailure: new Error("db down") })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("unavailable");
  });

  test("fails the whole export closed when a record bound sentinel trips", async () => {
    const result = await buildExport(
      makeLayers({
        recordsFailure: new AccountDataExportRecordBoundExceededError({
          bound: accountDataExportRecordBounds.invoices,
          section: "invoices.json",
        }),
      })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    // Same fail-closed shape as any other data failure: a generic unavailable
    // error, no archive, and no bound details carried to the response.
    expect(result.failure.reason).toBe("unavailable");
    expect(result.success).toBeUndefined();
  });

  test("fails closed on a deletion marker", async () => {
    const result = await buildExport(
      makeLayers({
        accountState: {
          kind: "active",
          deletionRequestedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
        },
      })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("link-required");
    expect(result.failure.linkReason).toBe("deletion-requested");
  });

  test("fails closed on a missing auth identity", async () => {
    const result = await buildExport(
      makeLayers({ accountState: { kind: "missing" } })
    );
    if (!result.failure) throw new Error("expected the export to fail");
    expect(result.failure.reason).toBe("unauthenticated");
  });
});
