import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { unzipSync } from "fflate";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";
import { makeAccountDataExportGet } from "./account-data-export-route.server";
import {
  accountDataExportManifestPath,
  accountDataExportSections,
} from "./account-data-export-sections";
import { AccountDataExportService } from "./backend/account-data-export.service";
import {
  type AccountDataExportRead,
  type AccountDataExportSources,
  fakeAccountDataExportSources,
  SyntheticSourceFailure,
  syntheticExportSources,
} from "./backend/account-data-export.test-utils";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "./customer-account";

const workspaceLogs = captureWorkspaceLogs();

let sources: AccountDataExportSources;
const reads: AccountDataExportRead[] = [];

beforeEach(() => {
  sources = syntheticExportSources();
  reads.length = 0;
  workspaceLogs.reset();
});

const service = AccountDataExportService.Default.pipe(
  Layer.provide(fakeAccountDataExportSources(() => sources, reads))
);

const unbuildableService = Layer.effect(
  AccountDataExportService,
  Effect.fail(new Error("synthetic configuration failure"))
);

const requestExport = ({
  locale = "en-US",
  layer = service,
  signal,
}: {
  readonly locale?: string;
  readonly layer?: Layer.Layer<AccountDataExportService, unknown>;
  readonly signal?: AbortSignal;
} = {}) =>
  makeAccountDataExportGet(layer)(
    new Request(
      `https://workspace.test/${locale}/account/data-export`,
      signal ? { signal } : {}
    ),
    { params: Promise.resolve({ locale }) }
  );

const describeResponse = async (response: Response) => ({
  status: response.status,
  headers: [...response.headers.entries()].sort(),
  body: await response.text(),
});

const expectPrivate = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
};

const loggedText = () =>
  JSON.stringify(
    workspaceLogs.records().map(({ body, attributes }) => ({
      body,
      attributes,
    }))
  );

describe("account data export route", () => {
  test("downloads the archive as a private ZIP attachment", async () => {
    const response = await requestExport();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="deskohub-account-data-\d{4}-\d{2}-\d{2}\.zip"$/
    );
    expectPrivate(response);
    const entries = Object.keys(
      unzipSync(new Uint8Array(await response.arrayBuffer()))
    );
    expect(entries.sort()).toEqual(
      [
        accountDataExportManifestPath,
        ...accountDataExportSections.map(({ path }) => path),
      ].sort()
    );
  });

  const denials: readonly [string, Partial<AccountDataExportSources>][] = [
    [
      "signed out",
      {
        resolve: Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        ),
      },
    ],
    [
      "unverified",
      {
        resolve: Effect.fail(
          new CustomerAccountAccessError({ reason: "unverified-email" })
        ),
      },
    ],
    [
      "unlinked",
      {
        resolve: Effect.fail(
          new CustomerAccountAccessError({
            reason: "link-required",
            linkReason: "not-found",
          })
        ),
      },
    ],
    [
      "a review account",
      { resolve: Effect.fail(customerAccountUnavailable("account.review")) },
    ],
    [
      "deleted",
      {
        activity: Effect.succeed({
          kind: "active",
          email: testEmailAddress("account-data-export"),
          deletionRequestedAt: new Date("2026-09-01T10:00:00Z"),
        }),
      },
    ],
    ["removed", { activity: Effect.succeed({ kind: "missing" }) }],
  ];

  test("answers every refusal and an invalid locale with the same private bodiless 404", async () => {
    const invalidLocale = await requestExport({ locale: "xx-XX" });
    const reference = await describeResponse(invalidLocale);
    expect(reference.status).toBe(404);
    expect(reference.body).toBe("");
    expectPrivate(invalidLocale);
    // An invalid locale never reaches the service.
    expect(reads).toEqual([]);

    for (const [, denial] of denials) {
      sources = { ...syntheticExportSources(), ...denial };
      expect(await describeResponse(await requestExport())).toEqual(reference);
    }
  });

  test("refuses an invalid locale even when the service can't be built", async () => {
    const response = await requestExport({
      locale: "xx-XX",
      layer: unbuildableService,
    });

    expect(response.status).toBe(404);
    expectPrivate(response);
  });

  test("answers an unreadable source with a private generic 500 and logs only fixed codes", async () => {
    sources = {
      ...sources,
      payments: Effect.fail(new SyntheticSourceFailure()),
    };

    const response = await requestExport();

    expect(response.status).toBe(500);
    expectPrivate(response);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Content-Type")).not.toBe("application/zip");
    const logged = loggedText();
    expect(logged).toContain("payments");
    expect(logged).toContain("unreadable");
    expect(logged).not.toContain("SyntheticSourceFailure");
  });

  test("answers an exceeded limit with the same private 500", async () => {
    sources = {
      ...sources,
      bookedReservations: Effect.fail(
        new ReadLimitExceededError({ limit: 500 })
      ),
    };
    const exceeded = await describeResponse(await requestExport());
    sources = {
      ...syntheticExportSources(),
      profile: Effect.fail(new SyntheticSourceFailure()),
    };
    const unreadable = await describeResponse(await requestExport());

    expect(exceeded.status).toBe(500);
    expect(exceeded).toEqual(unreadable);
    expect(exceeded.headers).toContainEqual([
      "cache-control",
      "private, no-store",
    ]);
  });

  test("answers an unexpected defect and an unbuildable service with a private 500 and logs only the route code", async () => {
    sources = {
      ...sources,
      invoices: Effect.die(new Error("synthetic invoice defect")),
    };
    const defect = await requestExport();
    const unbuildable = await requestExport({ layer: unbuildableService });

    for (const response of [defect, unbuildable]) {
      expect(response.status).toBe(500);
      expectPrivate(response);
    }
    const logged = loggedText();
    expect(logged).toContain("account.data-export");
    expect(logged).not.toContain("synthetic invoice defect");
    expect(logged).not.toContain("synthetic configuration failure");
  });

  test("stays interrupted when the client disconnects instead of answering", async () => {
    const controller = new AbortController();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    sources = {
      ...sources,
      invoices: Effect.sync(() => markStarted()).pipe(
        Effect.andThen(Effect.never)
      ),
    };

    const response = requestExport({ signal: controller.signal });
    await started;
    controller.abort();

    await expect(response).rejects.toBeDefined();
  });
});
