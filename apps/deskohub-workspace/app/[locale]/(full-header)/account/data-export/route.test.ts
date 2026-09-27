import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { unzipSync } from "fflate";
import {
  accountDataExportManifestPath,
  accountDataExportSections,
} from "@/features/account/account-data-export-sections";
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

const archiveFixture = {
  entries: [
    {
      path: accountDataExportManifestPath,
      content: {
        schemaVersion: 2,
        generatedAt: "2026-09-26T00:00:00.000Z",
        sections: accountDataExportSections.map((section) => ({
          path: section.path,
          description: section.manifestDescription,
        })),
        assembledDuringRequest: true,
        nonAtomicityNote: "note",
        completenessNote: "note",
      },
    },
    ...accountDataExportSections.map((section) => ({
      path: section.path,
      content: {},
    })),
  ],
} as const;

type RouteFakes = {
  readonly flagEnabled?: boolean | Error;
  readonly session?: CustomerAccountSession | null | Error;
  readonly build?: Error;
  readonly archiveEntries?: {
    readonly path: string;
    readonly content: unknown;
  }[];
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
    build: ({ session: buildSession }: { session: CustomerAccountSession }) =>
      Effect.suspend(() => {
        buildInvocations += 1;
        if (fakes.build) return Effect.fail(fakes.build);
        const identityEntry = {
          path: "identity.json",
          content: { email: buildSession.email },
        };
        const entries = fakes.archiveEntries
          ? fakes.archiveEntries
          : archiveFixture.entries.map((entry) =>
              entry.path === "identity.json"
                ? identityEntry
                : (entry as { path: string; content: unknown })
            );
        return Effect.succeed({ entries });
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
  test("serves the allowlisted archive as a private ZIP attachment whose entries match the manifest", async () => {
    const { response, buildWasInvoked } = await runRoute({});
    expect(response.status).toBe(200);
    expect(buildWasInvoked()).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("application/zip");
    const disposition = response.headers.get("content-disposition");
    expect(disposition?.startsWith("attachment;")).toBe(true);
    expect(disposition).toContain(".zip");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const unzipped = unzipSync(bytes);
    const entryPaths = Object.keys(unzipped).sort();
    expect(entryPaths).toEqual(
      [
        accountDataExportManifestPath,
        ...accountDataExportSections.map((section) => section.path),
      ].sort()
    );
    // The ZIP carries exactly the manifest entries and nothing else, and the
    // manifest itself lists the same section set.
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipped[accountDataExportManifestPath]!)
    ) as { sections: readonly { path: string }[] };
    expect(manifest.sections.map((section) => section.path)).toEqual(
      accountDataExportSections.map((section) => section.path)
    );
    // The delivered identity section is bound to the requesting session.
    const identity = JSON.parse(
      new TextDecoder().decode(unzipped["identity.json"]!)
    ) as { email: string };
    expect(identity.email).toBe(session.email);
  });

  test("serves each request from the session read at request time", async () => {
    // Module-scope route layers must not memoize a session or document
    // across requests: the second invocation against the same layers has to
    // reflect the session read for that invocation.
    const fakes: RouteFakes = {};
    const { layers } = makeLayers(fakes);
    const secondSession = {
      ...session,
      accountId: customerAccountIdSchema.make("auth-user-export-route-2"),
      email: "grace@example.test",
    } as CustomerAccountSession;
    const run = () =>
      Effect.runPromise(
        Effect.result(
          buildAccountDataExportResponse(Effect.succeed(account), layers)
        )
      ).then((result) => {
        if (!result.success) throw result.failure;
        return result.success;
      });

    const first = await run();
    fakes.session = secondSession;
    const second = await run();

    const firstIdentity = JSON.parse(
      new TextDecoder().decode(
        unzipSync(new Uint8Array(await first.arrayBuffer()))["identity.json"]!
      )
    ) as { email: string };
    const secondIdentity = JSON.parse(
      new TextDecoder().decode(
        unzipSync(new Uint8Array(await second.arrayBuffer()))["identity.json"]!
      )
    ) as { email: string };
    expect(firstIdentity.email).toBe(session.email);
    expect(secondIdentity.email).toBe(secondSession.email);
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

  test("fails closed with 500 and serves no archive when the archive exceeds the size bound", async () => {
    const { response } = await runRoute({
      archiveEntries: [
        {
          path: accountDataExportManifestPath,
          content: { oversized: true },
        },
        {
          path: "workspace-reservations.json",
          content: { filler: "x".repeat(9 * 1024 * 1024) },
        },
      ],
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe(unavailableBody);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
  });

  test("fails closed with 500 when an entry path is outside the fixed archive names", async () => {
    const { response } = await runRoute({
      archiveEntries: [{ path: "/absolute-escape.json", content: {} }],
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(unavailableBody);
  });
});
