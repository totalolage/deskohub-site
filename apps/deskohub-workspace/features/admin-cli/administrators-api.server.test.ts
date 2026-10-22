import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationAccountId,
  type AdministrationLegacyAdministratorBackfillResultType,
  AdministrationLegacyUsername,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { AdministratorRoster } from "@/features/administrators/backend/administrator-roster.service";
import {
  LegacyAdministratorAccountNotFound,
  LegacyAdministratorBackfill,
  LegacyAdministratorBackfillError,
} from "@/features/administrators/backend/legacy-administrator-backfill.service";
import { AdminCliAdministratorsApiHandlers } from "./administrators-api.server";
import {
  authorizedCliRequest,
  cliSessionAdministrator,
  UnauthorizedCliRequest,
  UnrecordedAdministrationActions,
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

const administratorsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "administrators",
]).pipe(Effect.map((client) => client.administrators));
type AdministratorsClient = Effect.Success<typeof administratorsClient>;

const notUnderTest = Effect.die("Not under test.");
const unusedRoster: AdministratorRoster["Service"] = {
  list: notUnderTest,
  grant: () => notUnderTest,
  revoke: () => notUnderTest,
};

const callAdministrators = <A, E>(
  call: (client: AdministratorsClient) => Effect.Effect<A, E>,
  {
    roster = {},
    run = () => notUnderTest,
    bearer = AuthorizedCliRequest,
  }: {
    readonly roster?: Partial<AdministratorRoster["Service"]>;
    readonly run?: LegacyAdministratorBackfill["Service"]["run"];
    readonly bearer?: typeof AuthorizedCliRequest;
  } = {}
) =>
  administratorsClient.pipe(
    Effect.flatMap(call),
    Effect.result,
    Effect.provide(AdminCliAdministratorsApiHandlers),
    Effect.provide(bearer),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(AdministratorRoster, { ...unusedRoster, ...roster }),
        Layer.succeed(LegacyAdministratorBackfill, { run })
      )
    ),
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(UnrecordedAdministrationActions),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

const callBackfill = (
  run: LegacyAdministratorBackfill["Service"]["run"],
  bearer = AuthorizedCliRequest
) =>
  callAdministrators(
    (client) => client.backfillLegacyAdministrator({ payload: input }),
    { run, bearer }
  );

const targetAccountId = AdministrationAccountId.make("account-target");
const targetEmail = testEmailAddress("administrator-target");
const storageFailure = new EffectDrizzleQueryError({
  query: "select 1",
  params: [],
  cause: Cause.die(new Error("boom")),
});

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

  test("lists administrators with their granter and ISO grant time", async () => {
    const outcome = await callAdministrators(
      (client) => client.listAdministrators({}),
      {
        roster: {
          list: Effect.succeed([
            {
              accountId: cliSessionAdministrator.accountId,
              email: cliSessionAdministrator.email,
              grantedBy: null,
              grantedAt: Temporal.Instant.from("2026-10-01T08:00:00Z"),
            },
            {
              accountId: targetAccountId,
              email: targetEmail,
              grantedBy: cliSessionAdministrator,
              grantedAt: Temporal.Instant.from("2026-10-02T08:00:00Z"),
            },
          ]),
        },
      }
    );

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: {
        administrators: [
          {
            accountId: cliSessionAdministrator.accountId,
            email: cliSessionAdministrator.email,
            grantedByEmail: null,
            grantedAt: "2026-10-01T08:00:00Z",
          },
          {
            accountId: targetAccountId,
            email: targetEmail,
            grantedByEmail: cliSessionAdministrator.email,
            grantedAt: "2026-10-02T08:00:00Z",
          },
        ],
      },
    });
  });

  test("grants as the session's administrator, never an input actor", async () => {
    const grants: unknown[] = [];

    const outcome = await callAdministrators(
      (client) =>
        client.grantAdministrator({ payload: { email: targetEmail } }),
      {
        roster: {
          grant: (request) =>
            Effect.sync(() => {
              grants.push(request);
              return { changed: false, email: targetEmail };
            }),
        },
      }
    );

    expect(grants).toEqual([
      { email: targetEmail, actor: cliSessionAdministrator },
    ]);
    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { outcome: "already_granted", email: targetEmail },
    });
  });

  test("revokes as the session's administrator", async () => {
    const revocations: unknown[] = [];

    const outcome = await callAdministrators(
      (client) =>
        client.revokeAdministrator({ params: { accountId: targetAccountId } }),
      {
        roster: {
          revoke: (request) =>
            Effect.sync(() => {
              revocations.push(request);
              return { changed: true };
            }),
        },
      }
    );

    expect(revocations).toEqual([
      { accountId: targetAccountId, actor: cliSessionAdministrator },
    ]);
    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { outcome: "revoked" },
    });
  });

  test("rejects an invalid CLI session before reading or changing grants", async () => {
    let rosterCalls = 0;
    const counted = Effect.sync(() => {
      rosterCalls += 1;
      return { changed: true, email: targetEmail };
    });
    const roster = {
      list: counted.pipe(Effect.as([])),
      grant: () => counted,
      revoke: () => counted,
    };

    const outcomes = await Promise.all([
      callAdministrators((client) => client.listAdministrators({}), {
        roster,
        bearer: UnauthorizedCliRequest,
      }),
      callAdministrators(
        (client) =>
          client.grantAdministrator({ payload: { email: targetEmail } }),
        { roster, bearer: UnauthorizedCliRequest }
      ),
      callAdministrators(
        (client) =>
          client.revokeAdministrator({
            params: { accountId: targetAccountId },
          }),
        { roster, bearer: UnauthorizedCliRequest }
      ),
    ]);

    expect(rosterCalls).toBe(0);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
    }
  });

  test("reports roster storage failures as unavailable without their cause", async () => {
    const roster = {
      list: Effect.fail(storageFailure),
      grant: () => Effect.fail(storageFailure),
      revoke: () => Effect.fail(storageFailure),
    };

    const outcomes = await Promise.all([
      callAdministrators((client) => client.listAdministrators({}), {
        roster,
      }),
      callAdministrators(
        (client) =>
          client.grantAdministrator({ payload: { email: targetEmail } }),
        { roster }
      ),
      callAdministrators(
        (client) =>
          client.revokeAdministrator({
            params: { accountId: targetAccountId },
          }),
        { roster }
      ),
    ]);

    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "CliServiceUnavailable",
          message: "The administration API is temporarily unavailable.",
        },
      });
    }
  });
});
