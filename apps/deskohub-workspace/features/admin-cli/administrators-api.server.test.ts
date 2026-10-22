import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AdministrationLegacyAdministratorBackfillResultType,
  AdministrationLegacyUsername,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import {
  LegacyAdministratorAccountNotFound,
  LegacyAdministratorBackfill,
  LegacyAdministratorBackfillError,
} from "@/features/administrators/backend/legacy-administrator-backfill.service";
import { AdminCliAdministratorsApiHandlers } from "./administrators-api.server";
import {
  authorizedCliRequest,
  UnauthorizedCliRequest,
} from "./cli-api.test-utils";
import { CliClientCompatibilityLive } from "./cli-client-version";

const AuthorizedCliRequest = authorizedCliRequest();

const input = {
  legacyUsername: AdministrationLegacyUsername.make("admin"),
  email: testEmailAddress("legacy-administrator"),
  dryRun: true,
};

const counts = { linked: 1, alreadyLinked: 2, linkedToOtherAccount: 0 };
const result: AdministrationLegacyAdministratorBackfillResultType = {
  dryRun: true,
  administratorRole: "granted",
  cliSessions: counts,
  manualInvoices: counts,
  standaloneAccessCodeEvents: counts,
};

const callBackfill = (
  run: LegacyAdministratorBackfill["Service"]["run"],
  bearer = AuthorizedCliRequest
) =>
  HttpApiTest.groups(WorkspaceAdminApi, ["administrators"]).pipe(
    Effect.flatMap((client) =>
      client.administrators.backfillLegacyAdministrator({ payload: input })
    ),
    Effect.result,
    Effect.provide(AdminCliAdministratorsApiHandlers),
    Effect.provide(bearer),
    Effect.provide(Layer.succeed(LegacyAdministratorBackfill, { run })),
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

describe("administrators admin API", () => {
  test("runs the legacy administrator backfill with the requested input", async () => {
    const requests: unknown[] = [];

    const outcome = await callBackfill((request) => {
      requests.push(request);
      return Effect.succeed(result);
    });

    expect(requests).toEqual([input]);
    expect(outcome).toMatchObject({ _tag: "Success", success: result });
  });

  test("rejects an invalid CLI session before the backfill runs", async () => {
    const requests: unknown[] = [];

    const outcome = await callBackfill((request) => {
      requests.push(request);
      return Effect.succeed(result);
    }, UnauthorizedCliRequest);

    expect(requests).toEqual([]);
    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CliSessionUnauthorized" },
    });
  });

  test("reports a missing account as not found", async () => {
    const outcome = await callBackfill(() =>
      Effect.fail(
        new LegacyAdministratorAccountNotFound({
          message: "No active account signs in with that email.",
        })
      )
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CliResourceNotFound",
        message: "No active account signs in with that email.",
      },
    });
  });

  test("reports a storage failure as unavailable without its cause", async () => {
    const outcome = await callBackfill(() =>
      Effect.fail(LegacyAdministratorBackfillError.storage(new Error("boom")))
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CliServiceUnavailable",
        message: "The administration API is temporarily unavailable.",
      },
    });
  });
});
