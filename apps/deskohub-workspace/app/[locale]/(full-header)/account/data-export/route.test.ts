import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { AccountDataExportService } from "@/features/account/backend/account-data-export.service";
import { AccountFeatureFlagService } from "@/features/account/backend/account-feature-flag.service";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { buildAccountDataExportResponse } from "./route";

const session = {
  accountId: customerAccountIdSchema.make("auth-user-export-route"),
  email: "ada@example.test",
  deletionRequested: false,
  displayName: "Ada Lovelace",
  accountCreatedAt: new Date("2026-01-02T03:04:05.000Z"),
  accountUpdatedAt: new Date("2026-02-03T04:05:06.000Z"),
} as CustomerAccountSession;

const account = {
  accountId: session.accountId,
  dotyposCustomerId: "60411",
} as const;

const snapshotFixture = {
  identity: {
    accountId: session.accountId,
    email: session.email,
    emailVerified: true,
    name: session.displayName,
    accountCreatedAt: "2026-01-02T03:04:05.000Z",
    accountUpdatedAt: "2026-02-03T04:05:06.000Z",
    deletionRequested: false,
  },
  dotyposProfile: null,
  reservations: [],
  marketingConsent: null,
  meta: {
    schemaVersion: 1,
    generatedAt: "2026-09-26T00:00:00.000Z",
    scope: ["identity", "dotyposProfile", "reservations", "marketingConsent"],
    assembledDuringRequest: true,
    nonAtomicityNote: "note",
  },
} as const;

type RouteFakes = {
  readonly flagEnabled?: boolean | Error;
  readonly session?: CustomerAccountSession | null | Error;
  readonly build?: Error;
};

const makeLayers = (fakes: RouteFakes) => {
  let buildInvocations = 0;

  const flags = Layer.mock(AccountFeatureFlagService, {
    isEnabled: Effect.suspend(() =>
      fakes.flagEnabled instanceof Error
        ? Effect.fail(fakes.flagEnabled)
        : Effect.succeed(fakes.flagEnabled ?? true)
    ),
  } satisfies Partial<AccountFeatureFlagService["Service"]>);

  const authentication = Layer.mock(CustomerAuthentication, {
    currentUser: Effect.suspend(() =>
      fakes.session instanceof Error
        ? Effect.fail(fakes.session)
        : Effect.succeed(fakes.session === undefined ? session : fakes.session)
    ),
  } satisfies Partial<CustomerAuthentication["Service"]>);

  const exportService = Layer.mock(AccountDataExportService, {
    build: () =>
      Effect.suspend(() => {
        buildInvocations += 1;
        return fakes.build
          ? Effect.fail(fakes.build)
          : Effect.succeed(snapshotFixture);
      }),
  } satisfies Partial<AccountDataExportService["Service"]>);

  return {
    layers: Layer.mergeAll(flags, authentication, exportService),
    buildWasInvoked: () => buildInvocations > 0,
  };
};

const unavailableBody = '{"error":"Account data export is unavailable."}';

const runRoute = (
  fakes: RouteFakes,
  resolveAccount?: Parameters<typeof buildAccountDataExportResponse>[0]
) => {
  const { layers, buildWasInvoked } = makeLayers(fakes);
  return Effect.runPromise(
    Effect.result(
      buildAccountDataExportResponse(
        resolveAccount ?? Effect.succeed(account),
        layers
      )
    )
  ).then((result) => {
    if (!result.success) throw result.failure;
    return { response: result.success, buildWasInvoked };
  });
};

const resolverFailure = (
  reason: "unverified-email" | "link-required",
  linkReason?: "deletion-requested"
) =>
  Effect.fail(
    new CustomerAccountAccessError({
      reason,
      linkReason,
    })
  );

describe("account data export route", () => {
  test("serves the allowlisted snapshot as a private JSON attachment", async () => {
    const { response, buildWasInvoked } = await runRoute({});
    expect(response.status).toBe(200);
    expect(buildWasInvoked()).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(
      response.headers.get("content-disposition")?.startsWith("attachment;")
    ).toBe(true);
    const body = (await response.json()) as {
      readonly identity: { readonly email: string };
    };
    expect(body.identity.email).toBe(session.email);
  });

  test("fails closed with 404 and never builds a snapshot when the flag is disabled", async () => {
    const { response, buildWasInvoked } = await runRoute({
      flagEnabled: false,
    });
    expect(response.status).toBe(404);
    expect(buildWasInvoked()).toBe(false);
    expect(await response.text()).toBe(unavailableBody);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("fails closed with 404 and never builds a snapshot without a session", async () => {
    const { response, buildWasInvoked } = await runRoute({ session: null });
    expect(response.status).toBe(404);
    expect(buildWasInvoked()).toBe(false);
    expect(await response.text()).toBe(unavailableBody);
  });

  test("fails closed with 500 on a session-read failure", async () => {
    const { response, buildWasInvoked } = await runRoute({
      session: new Error("auth down"),
    });
    expect(response.status).toBe(500);
    expect(buildWasInvoked()).toBe(false);
    expect(await response.text()).toBe(unavailableBody);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("fails closed with 500 on an unverified email from the resolver", async () => {
    const { response, buildWasInvoked } = await runRoute(
      {},
      resolverFailure("unverified-email")
    );
    expect(response.status).toBe(500);
    expect(buildWasInvoked()).toBe(false);
    expect(await response.text()).toBe(unavailableBody);
  });

  test("fails closed with 500 on a deletion marker from the resolver", async () => {
    const { response, buildWasInvoked } = await runRoute(
      {},
      resolverFailure("link-required", "deletion-requested")
    );
    expect(response.status).toBe(500);
    expect(buildWasInvoked()).toBe(false);
    expect(await response.text()).toBe(unavailableBody);
  });

  test("fails closed with 500 and no partial document when the snapshot builder fails", async () => {
    const { response, buildWasInvoked } = await runRoute({
      build: new Error("dotypos down"),
    });
    expect(response.status).toBe(500);
    expect(buildWasInvoked()).toBe(true);
    const body = await response.text();
    expect(body).toBe(unavailableBody);
    expect(body).not.toContain("identity");
  });
});
