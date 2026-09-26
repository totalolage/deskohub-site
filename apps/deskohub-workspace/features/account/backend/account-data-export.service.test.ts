import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { customerAccountIdSchema } from "../customer-account";
import { AccountDataExportService } from "./account-data-export.service";
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

  return AccountDataExportService.Default.pipe(
    Layer.provide(Layer.mergeAll(links, dotypos, history, consents))
  );
};

const buildExport = (layer: Layer.Layer<AccountDataExportService>) =>
  Effect.runPromise(
    Effect.flatMap(AccountDataExportService, (service) =>
      service.build({ account, session })
    ).pipe(Effect.provide(layer), Effect.result)
  );

const forbiddenKeyPattern =
  /token|secret|pin|password|session|hash|credential|cookie/i;

describe("AccountDataExportService", () => {
  test("exports only allowlisted sections and fields", async () => {
    const result = await buildExport(
      makeLayers({
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

    const snapshot = result.success;
    // The document's own key order mirrors the contractual meta scope order
    // (identity, dotyposProfile, reservations, marketingConsent) before meta.
    expect(Object.keys(snapshot)).toEqual([
      "identity",
      "dotyposProfile",
      "reservations",
      "marketingConsent",
      "meta",
    ]);
    expect(snapshot.meta.scope).toEqual([
      "identity",
      "dotyposProfile",
      "reservations",
      "marketingConsent",
    ]);
    expect(Object.keys(snapshot.meta)).toEqual([
      "schemaVersion",
      "generatedAt",
      "scope",
      "assembledDuringRequest",
      "nonAtomicityNote",
    ]);
    expect(snapshot.meta.nonAtomicityNote).toBe(
      "This snapshot was assembled during a single request from different systems. It is not an atomic cross-system transaction: data changed concurrently may appear in only some sections."
    );
    expect(Object.keys(snapshot.identity!).sort()).toEqual(
      [
        "accountCreatedAt",
        "accountUpdatedAt",
        "deletionRequested",
        "email",
        "emailVerified",
        "name",
        "accountId",
      ].sort()
    );

    // No token, session identifier, credential, or document hash anywhere in
    // the serialized document.
    const serialized = JSON.stringify(snapshot);
    expect(forbiddenKeyPattern.test(serialized)).toBe(false);

    expect(snapshot.dotyposProfile).toEqual(profile);
    expect(snapshot.reservations).toEqual([summary]);
    expect(snapshot.marketingConsent).toEqual({
      grantedAt: "2026-03-01T00:00:00Z",
      withdrawnAt: null,
      locale: "en-US",
    });
  });

  test("exposes exactly the literal keys for a populated profile, billing, and reservation variants", async () => {
    const populatedProfile = {
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420000000000",
      billing: {
        kind: "business",
        addressLine1: "Charles Square 1",
        addressLine2: null,
        city: "Prague",
        zip: "12000",
        country: "CZ",
        companyName: "Ada Test s.r.o.",
        companyId: "12345678",
        vatId: "CZ12345678",
      },
    } as const;
    const coworkReservation = {
      id: "reservation-cowork",
      workspaceReservationId: "wr-cowork",
      product: { kind: "cowork", tier: "basic" },
      startsAt: "2026-09-02T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
      seats: 1,
      status: "confirmed",
    } as const;
    const undatedOfficeReservation = {
      id: "reservation-office",
      product: { kind: "office" },
      startsAt: null,
      endsAt: null,
      seats: null,
      status: "cancelled",
    } as const;

    const result = await buildExport(
      makeLayers({
        profile: populatedProfile,
        historyGroups: {
          current: [coworkReservation],
          past: [],
          unavailable: [undatedOfficeReservation],
        },
      })
    );
    if (result.failure) throw result.failure;
    const snapshot = result.success;

    // Literal key lists so a silently expanded fixture or a newly mapped
    // provider field cannot widen the accepted output.
    expect(Object.keys(snapshot.dotyposProfile!)).toEqual([
      "firstName",
      "lastName",
      "phone",
      "billing",
    ]);
    expect(Object.keys(snapshot.dotyposProfile!.billing!)).toEqual([
      "kind",
      "addressLine1",
      "addressLine2",
      "city",
      "zip",
      "country",
      "companyName",
      "companyId",
      "vatId",
    ]);
    expect(snapshot.reservations.map((entry) => Object.keys(entry))).toEqual([
      [
        "id",
        "workspaceReservationId",
        "product",
        "startsAt",
        "endsAt",
        "seats",
        "status",
      ],
      ["id", "product", "startsAt", "endsAt", "seats", "status"],
    ]);
    expect(snapshot.reservations.map((entry) => entry.product)).toEqual([
      { kind: "cowork", tier: "basic" },
      { kind: "office" },
    ]);
  });

  test("exports explicit nulls for a missing profile and missing consent", async () => {
    const result = await buildExport(makeLayers({ profile: null }));
    if (result.failure) throw result.failure;
    expect(result.success.dotyposProfile).toBeNull();
    expect(result.success.marketingConsent).toBeNull();
    expect(result.success.identity.email).toBe("ada@example.test");
    expect(result.success.identity.emailVerified).toBe(true);
    expect(result.success.identity.deletionRequested).toBe(false);
    expect(result.success.meta.schemaVersion).toBe(1);
    expect(result.success.meta.assembledDuringRequest).toBe(true);
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
