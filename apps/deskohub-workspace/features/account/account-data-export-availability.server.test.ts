import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { getAccountDataExportAvailability } from "./account-data-export-availability.server";
import {
  type AccountDataExportRead,
  type AccountDataExportSources,
  accountDataExportRefusals,
  fakeAccountDataExportSources,
  syntheticExportSources,
} from "./backend/account-data-export.test-utils";
import { CustomerAccountResolver } from "./backend/customer-account-resolver.service";
import { customerAccountUnavailable } from "./customer-account";

let sources: AccountDataExportSources;
const reads: AccountDataExportRead[] = [];

beforeEach(() => {
  sources = syntheticExportSources();
  reads.length = 0;
});

const availability = () =>
  getAccountDataExportAvailability(
    "en-US",
    fakeAccountDataExportSources(() => sources, reads)
  );

describe("getAccountDataExportAvailability", () => {
  test("offers the export to a verified, active, linked account, reading only its authority", async () => {
    expect(await availability()).toBe(true);
    expect(reads.map(({ source }) => source)).toEqual([
      "resolve",
      "session",
      "activity",
    ]);
  });

  for (const [name, refuse] of accountDataExportRefusals) {
    test(`offers no export for ${name}`, async () => {
      sources = refuse(sources);

      expect(await availability()).toBe(false);
    });
  }

  test("offers no export when the account authority can't be read", async () => {
    sources = {
      ...sources,
      resolve: Effect.fail(
        customerAccountUnavailable("authentication.session")
      ),
    };

    expect(await availability()).toBe(false);
  });

  test("offers no export when reading the account authority dies", async () => {
    sources = { ...sources, resolve: Effect.die("synthetic authority defect") };

    expect(await availability()).toBe(false);
  });

  test("offers no export when the account authority can't be built", async () => {
    const unbuildable = Layer.mergeAll(
      fakeAccountDataExportSources(() => sources, reads),
      Layer.effect(
        CustomerAccountResolver,
        Effect.fail(customerAccountUnavailable("authentication.session"))
      )
    );

    expect(await getAccountDataExportAvailability("en-US", unbuildable)).toBe(
      false
    );
  });
});
