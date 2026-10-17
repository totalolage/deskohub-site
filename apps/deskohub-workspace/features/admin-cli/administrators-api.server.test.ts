import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  type AdministrationLegacyAdministratorBackfillResultType,
  AdministrationLegacyUsername,
  CliBearerAuthentication,
  CliSessionUnauthorized,
  CurrentCliSession,
  toAdministrationActorName,
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

const cliAdministratorEmail = AdministrationActorEmail.make(
  testEmailAddress("cli-admin")
);
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  approvedBy: toAdministrationActorName(cliAdministratorEmail),
  approvedByEmail: cliAdministratorEmail,
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
} as const;

const AuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, session),
});
const UnauthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: () =>
    Effect.fail(
      new CliSessionUnauthorized({ message: "The CLI session is not valid." })
    ),
});

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
