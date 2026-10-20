import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
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
  CustomerAccountBackfill,
  CustomerAccountBackfillError,
  type CustomerAccountBackfillReport,
} from "@/features/account/backend/customer-account-backfill.service";
import { AdminCliAccountsApiHandlers } from "./accounts-api.server";
import { CliClientCompatibilityLive } from "./cli-client-version";

const cliAdministratorEmail = testEmailAddress("cli-account-admin");
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

const input = { dryRun: true };
const report: CustomerAccountBackfillReport = {
  dryRun: true,
  logins: { created: 1, alreadyPresent: 2 },
  links: { recorded: 3, alreadyRecorded: 4, conflicts: 5 },
  tombstones: { recorded: 6, alreadyDeleted: 7, skippedRecent: 8 },
  authors: {
    alreadyAuthored: 9,
    viaLink: { customers: 10, reservations: 11 },
    viaNewLogin: { customers: 12, reservations: 13 },
    viaResumedLogin: { customers: 14, reservations: 15 },
    refused: [],
    remainingCustomers: 16,
  },
};

const callBackfill = (
  run: CustomerAccountBackfill["Service"]["run"],
  bearer = AuthorizedCliRequest
) =>
  HttpApiTest.groups(WorkspaceAdminApi, ["accounts"]).pipe(
    Effect.flatMap((client) =>
      client.accounts.backfillAccounts({ payload: input })
    ),
    Effect.result,
    Effect.provide(AdminCliAccountsApiHandlers),
    Effect.provide(bearer),
    Effect.provide(Layer.succeed(CustomerAccountBackfill, { run })),
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

describe("accounts admin API", () => {
  test("returns the customer account backfill report", async () => {
    const requests: unknown[] = [];

    const outcome = await callBackfill((request) => {
      requests.push(request);
      return Effect.succeed(report);
    });

    expect(requests).toEqual([input]);
    expect(outcome).toMatchObject({ _tag: "Success", success: report });
  });

  test("rejects an invalid CLI session before the backfill runs", async () => {
    const requests: unknown[] = [];

    const outcome = await callBackfill((request) => {
      requests.push(request);
      return Effect.succeed(report);
    }, UnauthorizedCliRequest);

    expect(requests).toEqual([]);
    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CliSessionUnauthorized" },
    });
  });

  test("maps a backfill service failure to unavailable", async () => {
    const outcome = await callBackfill(() =>
      Effect.fail(
        CustomerAccountBackfillError.from(
          new Error("synthetic backfill failure")
        )
      )
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
