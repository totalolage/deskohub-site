import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationAccountId,
  type AdministrationAdministratorListType,
  CliAccessToken,
  CliMutationRejected,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { AuthenticationService } from "../authentication/authentication.service";
import { dhwCommand } from "../command";
import { DhwConfig } from "../config/dhw-config.service";
import { describeRevocationTarget } from "./administrators.command";

type AdministratorsApi = Pick<
  WorkspaceAdminApiClient["Service"],
  "listAdministrators" | "grantAdministrator" | "revokeAdministrator"
>;

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const session = {
  id: Schema.decodeUnknownSync(CliSessionId)(
    "01980000-0000-7000-8000-000000000000"
  ),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.24.0",
  buildTarget: "development" as const,
  createdAt: "2026-10-22T08:00:00.000Z",
  lastUsedAt: "2026-10-22T08:00:00.000Z",
  expiresAt: null,
};
const accountId = AdministrationAccountId.make("account-target");
const email = testEmailAddress("administrator-target");
const granterEmail = testEmailAddress("administrator-granter");
const listed: AdministrationAdministratorListType = {
  administrators: [
    {
      accountId: AdministrationAccountId.make("account-bootstrap"),
      email: granterEmail,
      grantedByEmail: null,
      grantedAt: "2026-10-01T08:00:00Z",
    },
    {
      accountId,
      email,
      grantedByEmail: granterEmail,
      grantedAt: "2026-10-02T08:00:00Z",
    },
  ],
};

const makeAdministratorsLayer = (
  overrides: Partial<AdministratorsApi> = {}
) => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const output: string[] = [];
  const record =
    <Args extends ReadonlyArray<unknown>, A>(
      name: string,
      result: (...args: Args) => A
    ) =>
    (_accessToken: unknown, ...args: Args) =>
      Effect.sync(() => {
        calls.push([name, ...args]);
        return result(...args);
      });
  const fake: AdministratorsApi = {
    listAdministrators: record("listAdministrators", () => listed),
    grantAdministrator: record("grantAdministrator", () => ({
      outcome: "granted" as const,
      email,
    })),
    revokeAdministrator: record("revokeAdministrator", () => ({
      outcome: "revoked" as const,
    })),
    ...overrides,
  };
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    ...fake,
  });
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({ accessToken: Redacted.make(accessToken), session })
    ),
    save: () => Effect.void,
    clear: Effect.succeed(true),
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory: `/tmp/dhw-administrators-command-test-${crypto.randomUUID()}`,
    updateChecksDisabled: true,
  });
  const console = Layer.succeed(Console.Console, {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      output.push(args.join(" "));
    },
  } satisfies Console.Console);

  return {
    calls,
    output,
    layer: Layer.mergeAll(api, authentication, console).pipe(
      Layer.provideMerge(config),
      Layer.provideMerge(BunServices.layer)
    ),
  };
};

type AdministratorsLayer = ReturnType<typeof makeAdministratorsLayer>["layer"];

const runCommand = (args: ReadonlyArray<string>, layer: AdministratorsLayer) =>
  Command.runWith(dhwCommand, { version: "1.24.0" })(args).pipe(
    Effect.provide(layer)
  );

const runSuccess = (args: ReadonlyArray<string>, layer: AdministratorsLayer) =>
  runCommand(args, layer).pipe(Effect.runPromise);

const runFailure = (args: ReadonlyArray<string>, layer: AdministratorsLayer) =>
  runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

describe("dhw administrators", () => {
  test("lists administrators as one JSON result", async () => {
    const { layer, output } = makeAdministratorsLayer();

    await runSuccess(["--json", "administrators", "list"], layer);

    expect(output.map((line) => JSON.parse(line))).toEqual([listed]);
  });

  test("lists one tab-separated line per administrator after the count", async () => {
    const { layer, output } = makeAdministratorsLayer();

    await runSuccess(["administrators", "list"], layer);

    expect(output).toHaveLength(1 + listed.administrators.length);
    expect(output.slice(1).map((line) => line.split("\t"))).toEqual(
      listed.administrators.map((administrator) => [
        administrator.accountId,
        administrator.email,
        administrator.grantedAt,
        expect.any(String),
      ])
    );
    expect(output[2]?.split("\t")[3]).toBe(granterEmail);
  });

  test("requires --yes to grant under --json and grants once confirmed", async () => {
    const { calls, layer, output } = makeAdministratorsLayer();
    const args = ["--json", "administrators", "grant", "--email", email];

    const error = await runFailure(args, layer);

    expect(error).toMatchObject({
      _tag: "ConfirmationRequiredError",
      operation: "administrators.grantAdministrator",
    });
    expect(calls).toEqual([]);

    await runSuccess([...args, "--yes"], layer);

    expect(calls).toEqual([["grantAdministrator", { email }]]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { outcome: "granted", email },
    ]);
  });

  test("reads the roster before asking to revoke, and revokes only once confirmed", async () => {
    const { calls, layer, output } = makeAdministratorsLayer();
    const args = ["--json", "administrators", "revoke", accountId];

    const error = await runFailure(args, layer);

    expect(error).toMatchObject({
      _tag: "ConfirmationRequiredError",
      operation: "administrators.revokeAdministrator",
    });
    expect(calls).toEqual([["listAdministrators"]]);

    calls.length = 0;
    await runSuccess([...args, "--yes"], layer);

    expect(calls).toEqual([["revokeAdministrator", accountId]]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { outcome: "revoked" },
    ]);
  });

  test("names a listed account's email in the revocation prompt", () => {
    expect(
      describeRevocationTarget(accountId, listed.administrators)
    ).toContain(email);
    const unlisted = AdministrationAccountId.make("account-unlisted");
    expect(describeRevocationTarget(unlisted, listed.administrators)).toContain(
      unlisted
    );
    expect(
      describeRevocationTarget(unlisted, listed.administrators)
    ).not.toContain(email);
  });

  test("propagates the server's refusal to grant", async () => {
    const refusal = new CliMutationRejected({
      message: "A review account can't hold the administrator role.",
    });
    const { layer } = makeAdministratorsLayer({
      grantAdministrator: () => Effect.fail(refusal),
    });

    const error = await runFailure(
      ["--json", "administrators", "grant", "--email", email, "--yes"],
      layer
    );

    expect(error).toBe(refusal);
  });

  test("propagates the server's refusal to revoke", async () => {
    const refusal = new CliMutationRejected({
      message: "Administrators can't revoke their own grant.",
    });
    const { layer } = makeAdministratorsLayer({
      revokeAdministrator: () => Effect.fail(refusal),
    });

    const error = await runFailure(
      ["--json", "administrators", "revoke", accountId, "--yes"],
      layer
    );

    expect(error).toBe(refusal);
  });
});
