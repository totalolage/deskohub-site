import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { unzipSync } from "fflate";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import {
  accountDataExportManifestPath,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "../account-data-export-sections";
import { customerAccountUnavailable } from "../customer-account";
import {
  AccountDataExportLimits,
  AccountDataExportLoadError,
  AccountDataExportService,
  AccountDataExportUnavailableError,
} from "./account-data-export.service";
import {
  type AccountDataExportRead,
  type AccountDataExportSources,
  accountDataExportRefusals,
  deskDotyposReservationId,
  exportAccountId,
  exportCustomerId,
  exportDotyposReservationId,
  exportReservationId,
  fakeAccountDataExportSources,
  SyntheticSourceFailure,
  syntheticExportSources,
} from "./account-data-export.test-utils";

// 22:30 UTC on 2026-09-01 is already 2026-09-02 in Prague.
const now = Temporal.Instant.from("2026-09-01T22:30:00Z");

let sources: AccountDataExportSources;
let reads: AccountDataExportRead[];

beforeEach(() => {
  sources = syntheticExportSources();
  reads = [];
});

const smallLimits = {
  reservations: 3,
  payments: 4,
  latePaymentRecoveries: 5,
  discountApplications: 6,
  invoices: 7,
  invoiceDeliveries: 8,
  legalEvidenceEvents: 9,
  accessGrants: 10,
} as const;

const provideService = (limits?: AccountDataExportLimits) =>
  Effect.provide(
    Layer.merge(
      AccountDataExportService.Default.pipe(
        Layer.provide(fakeAccountDataExportSources(() => sources, reads)),
        Layer.provide(
          limits ? Layer.succeed(AccountDataExportLimits, limits) : Layer.empty
        )
      ),
      TestClock.layer()
    )
  );

const downloadEffect = Effect.gen(function* () {
  yield* TestClock.setTime(now.epochMilliseconds);
  return yield* Effect.flatMap(
    AccountDataExportService,
    (service) => service.download
  );
});

const download = (limits?: AccountDataExportLimits) =>
  downloadEffect.pipe(provideService(limits), Effect.runPromise);

const failureOf = (limits?: AccountDataExportLimits) =>
  downloadEffect.pipe(Effect.flip, provideService(limits), Effect.runPromise);

/** The reads a successful export makes, in order, under `limits`. */
const expectedReads = (
  limits: AccountDataExportLimits,
  workspaceReservationIds = [exportReservationId]
): AccountDataExportRead[] => [
  { source: "resolve" },
  { source: "session" },
  { source: "activity", input: exportAccountId },
  { source: "profile", input: exportCustomerId },
  {
    source: "workspaceReservations",
    input: { dotyposCustomerId: exportCustomerId, limit: limits.reservations },
  },
  {
    source: "bookedReservations",
    input: { customerId: exportCustomerId, limit: limits.reservations },
  },
  {
    source: "payments",
    input: { workspaceReservationIds, limit: limits.payments },
  },
  {
    source: "latePaymentRecoveries",
    input: { workspaceReservationIds, limit: limits.latePaymentRecoveries },
  },
  {
    source: "discountApplications",
    input: { workspaceReservationIds, limit: limits.discountApplications },
  },
  {
    source: "invoices",
    input: { dotyposCustomerId: exportCustomerId, limit: limits.invoices },
  },
  {
    source: "invoiceDeliveries",
    input: {
      dotyposCustomerId: exportCustomerId,
      limit: limits.invoiceDeliveries,
    },
  },
  { source: "marketingConsent", input: exportCustomerId },
  {
    source: "legalEvidenceEvents",
    input: { workspaceReservationIds, limit: limits.legalEvidenceEvents },
  },
  {
    source: "accessGrants",
    input: { workspaceReservationIds, limit: limits.accessGrants },
  },
];

const unzipJson = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return {
    names: Object.keys(files),
    json: (path: string) =>
      JSON.parse(new TextDecoder().decode(files[path])) as Record<
        string,
        never
      >,
  };
};

const sectionSources = [
  "profile",
  "workspaceReservations",
  "bookedReservations",
  "payments",
  "latePaymentRecoveries",
  "discountApplications",
  "invoices",
  "invoiceDeliveries",
  "marketingConsent",
  "legalEvidenceEvents",
  "accessGrants",
] as const satisfies readonly (keyof AccountDataExportSources)[];

describe("AccountDataExportService.download", () => {
  test("archives the manifest and exactly the section files, named by the Prague date", async () => {
    const file = await download();

    expect(file.fileName).toBe("deskohub-account-data-2026-09-02.zip");
    const archive = unzipJson(file.bytes);
    expect(archive.names).toEqual([
      accountDataExportManifestPath,
      ...accountDataExportSections.map(({ path }) => path),
    ]);
    const manifest = archive.json(accountDataExportManifestPath);
    expect(manifest).toMatchObject({
      schemaVersion: accountDataExportSchemaVersion,
      generatedAt: now.toString(),
      sections: accountDataExportSections.map(({ path }) => ({
        path,
        description: expect.any(String),
      })),
      assembledDuringRequest: true,
    });
    expect(Object.keys(manifest).sort()).toEqual([
      "assembledDuringRequest",
      "completenessNote",
      "generatedAt",
      "nonAtomicityNote",
      "schemaVersion",
      "sections",
    ]);
  });

  test("fills each section from its owner's projection", async () => {
    const archive = unzipJson((await download()).bytes);

    expect(archive.json("identity.json")).toEqual({
      accountId: exportAccountId,
      email: expect.any(String),
      emailVerified: true,
      displayName: null,
      accountCreatedAt: "2026-01-05T09:00:00Z",
      accountUpdatedAt: "2026-01-05T09:00:00Z",
      deletionRequested: false,
    });
    expect(Object.keys(archive.json("dotypos-profile.json")).sort()).toEqual([
      "billing",
      "firstName",
      "lastName",
      "phone",
    ]);
    // Dotypos holds no product: it joins from the Workspace record, and a
    // desk booking without one has none.
    expect(archive.json("reservation-history.json")).toEqual([
      expect.objectContaining({
        dotyposReservationId: exportDotyposReservationId,
        product: { kind: "cowork", entryTier: "basic", coffee: false },
      }),
      expect.objectContaining({
        dotyposReservationId: deskDotyposReservationId,
        product: null,
      }),
    ]);
    expect(archive.json("workspace-reservations.json")).toEqual([
      expect.objectContaining({ id: exportReservationId }),
    ]);
    expect(archive.json("payments.json")).toEqual({
      payments: [
        expect.objectContaining({
          amount: { value: 45_050, exponent: 2, currency: "CZK" },
          refundedAmount: null,
        }),
      ],
      latePaymentRecoveries: [],
    });
    expect(archive.json("discount-applications.json")).toHaveLength(1);
    expect(Object.keys(archive.json("invoices.json")).sort()).toEqual([
      "customerEmailDeliveries",
      "invoices",
    ]);
    expect(archive.json("consents.json")).toEqual({
      marketingConsent: null,
      legalEvidenceEvents: [
        expect.objectContaining({ earlyPerformanceConsent: true }),
      ],
    });
    expect(archive.json("access-grants.json")).toEqual({
      accessGrants: [
        expect.objectContaining({
          workspaceReservationId: exportReservationId,
        }),
      ],
    });
  });

  test("re-authorizes, then reads each owner for the linked customer under the production limits", async () => {
    await download();

    expect(reads).toEqual(
      expectedReads({
        reservations: 500,
        payments: 2000,
        latePaymentRecoveries: 500,
        discountApplications: 2000,
        invoices: 500,
        invoiceDeliveries: 500,
        legalEvidenceEvents: 2000,
        accessGrants: 500,
      })
    );
  });

  test("passes a provided policy's limits to every bounded read", async () => {
    await download(smallLimits);

    expect(reads).toEqual(expectedReads(smallLimits));
  });

  test("reads reservation-keyed sections with no ids when the customer has no Workspace reservation", async () => {
    sources = { ...sources, workspaceReservations: Effect.succeed([]) };

    await download(smallLimits);

    expect(reads).toEqual(expectedReads(smallLimits, []));
  });
});

describe("AccountDataExportService refusals", () => {
  for (const [name, refuse] of accountDataExportRefusals) {
    test(`refuses ${name} before reading any section`, async () => {
      sources = refuse(sources);

      expect(await failureOf()).toBeInstanceOf(
        AccountDataExportUnavailableError
      );
      expect(
        reads.filter(({ source }) =>
          (sectionSources as readonly string[]).includes(source)
        )
      ).toEqual([]);
    });
  }

  test("fails to load when the account authority can't be read", async () => {
    sources = {
      ...sources,
      resolve: Effect.fail(
        customerAccountUnavailable("authentication.session")
      ),
    };

    expect(await failureOf()).toEqual(
      new AccountDataExportLoadError({
        code: "account.authority",
        kind: "unreadable",
      })
    );
  });
});

describe("AccountDataExportService load failures", () => {
  const codes = {
    profile: "dotypos.profile",
    workspaceReservations: "reservations.workspace",
    bookedReservations: "reservations.dotypos",
    payments: "payments",
    latePaymentRecoveries: "late-payment-recoveries",
    discountApplications: "discount-applications",
    invoices: "invoices",
    invoiceDeliveries: "invoice-deliveries",
    marketingConsent: "marketing-consent",
    legalEvidenceEvents: "legal-evidence",
    accessGrants: "access-grants",
  } as const satisfies Record<(typeof sectionSources)[number], string>;

  for (const source of sectionSources) {
    test(`fails the whole archive when ${source} can't be read, reading nothing after it`, async () => {
      sources = {
        ...sources,
        [source]: Effect.fail(new SyntheticSourceFailure()),
      };

      expect(await failureOf()).toEqual(
        new AccountDataExportLoadError({
          code: codes[source],
          kind: "unreadable",
        })
      );
      expect(reads.at(-1)?.source).toBe(source);
    });
  }

  for (const source of sectionSources.filter(
    (name) => name !== "profile" && name !== "marketingConsent"
  )) {
    test(`fails the whole archive when ${source} exceeds its limit`, async () => {
      sources = {
        ...sources,
        [source]: Effect.fail(new ReadLimitExceededError({ limit: 1 })),
      };

      expect(await failureOf()).toEqual(
        new AccountDataExportLoadError({
          code: codes[source],
          kind: "over-limit",
        })
      );
    });
  }

  test("fails rather than archive a section over the archive's size limit", async () => {
    sources = {
      ...sources,
      profile: Effect.succeed({
        firstName: "A".repeat(5 * 1024 * 1024),
        lastName: null,
        phone: null,
        billing: null,
      }),
    };

    expect(await failureOf()).toEqual(
      new AccountDataExportLoadError({ code: "archive", kind: "unreadable" })
    );
  });
});
