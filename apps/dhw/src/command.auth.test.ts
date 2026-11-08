import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CliAccessToken, CliSessionId } from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { ClientIdentity } from "./authentication/client-identity.service";
import { DHW_BUILD_TARGET, DHW_VERSION } from "./build-info";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const session = {
  id: Schema.decodeUnknownSync(CliSessionId)(
    "01980000-0000-7000-8000-000000000000"
  ),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
};
const started = {
  code: "authentication-code",
  approvalPath: "/admin/cli/approve?code=authentication-code",
  expiresAt: "2026-08-10T10:05:00.000Z",
};

/** Runs `dhw auth` in process against a fake approval flow. */
const runAuthentication = async (
  args: ReadonlyArray<string>,
  {
    existing = Option.none(),
    status = { authStatus: "approved", grantToken: "grant-token" },
  }: {
    readonly existing?: Option.Option<{
      readonly accessToken: Redacted.Redacted<typeof accessToken>;
      readonly session: typeof session;
    }>;
    readonly status?: object;
  } = {}
) => {
  const calls: Array<readonly [string, unknown]> = [];
  const saved: unknown[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const record = (method: string, response: unknown) => (input: unknown) =>
    Effect.sync(() => {
      calls.push([method, input]);
      return response;
    });
  const api = {
    startAuthentication: record("startAuthentication", started),
    getAuthenticationStatus: record("getAuthenticationStatus", status),
    exchangeGrant: record("exchangeGrant", {
      accessToken: "granted-token",
      session: { ...session, expiresAt: "2026-09-10T10:00:00.000Z" },
    }),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(
      WorkspaceAdminApiClient,
      api as unknown as WorkspaceAdminApiClient["Service"]
    ),
    Layer.succeed(AuthenticationService, {
      current: Effect.succeed(existing),
      save: (token) =>
        Effect.sync(() => {
          saved.push(token);
        }),
      clear: Effect.succeed(true),
    }),
    Layer.succeed(ClientIdentity, {
      defaultName: Effect.succeed("dhw on synthetic-host"),
    }),
    Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...parts: ReadonlyArray<unknown>) => {
        output.push(parts.join(" "));
      },
      error: (...parts: ReadonlyArray<unknown>) => {
        errors.push(parts.join(" "));
      },
    } satisfies Console.Console)
  ).pipe(
    Layer.provideMerge(
      Layer.succeed(DhwConfig, {
        baseUrl: new URL("https://workspace.example.test"),
        requestHeaders: {},
        isCi: true,
        stateDirectory: join(process.env.TMPDIR ?? "/tmp", "dhw-auth-test"),
        updateChecksDisabled: true,
      })
    ),
    Layer.provideMerge(BunServices.layer)
  );

  const exit = await Command.runWith(dhwCommand, { version: "1.3.0" })(
    args
  ).pipe(Effect.provide(layer), Effect.exit, Effect.runPromise);
  return { calls, errors, exit, output, saved };
};

const approvalMessage = `Approve this CLI in your browser:\nhttps://workspace.example.test${started.approvalPath}\n\nThis request expires at ${started.expiresAt}.`;

describe("dhw auth", () => {
  test("reports an existing session instead of starting a new request", async () => {
    const existing = Option.some({
      accessToken: Redacted.make(accessToken),
      session,
    });

    const json = await runAuthentication(["--json", "auth"], { existing });
    const text = await runAuthentication(["auth"], { existing });

    expect(json.calls).toEqual([]);
    expect(json.output).toEqual([
      JSON.stringify({ authStatus: "granted", session }),
    ]);
    expect(text.calls).toEqual([]);
    expect(text.output).toEqual([
      "Already authenticated as test client. This session does not expire.",
    ]);
  });

  test("names the client, waits for approval, and saves the exchanged token", async () => {
    const { calls, exit, output, saved } = await runAuthentication([
      "auth",
      "--name",
      "Synthetic laptop",
    ]);

    expect(exit._tag).toBe("Success");
    expect(calls.map(([method]) => method)).toEqual([
      "startAuthentication",
      "getAuthenticationStatus",
      "exchangeGrant",
    ]);
    expect(calls[0]?.[1]).toMatchObject({
      clientName: "Synthetic laptop",
      cliVersion: DHW_VERSION,
      buildTarget: DHW_BUILD_TARGET,
    });
    expect(calls[1]?.[1]).toBe(started.code);
    expect(calls[2]?.[1]).toMatchObject({
      code: started.code,
      grantToken: "grant-token",
    });
    expect(saved).toEqual(["granted-token"]);
    expect(output).toEqual([
      `${approvalMessage}\n\nWaiting for approval…`,
      "Authenticated as test client. This session expires at 2026-09-10T10:00:00.000Z.",
    ]);
  });

  test("falls back to the machine's client name and keeps JSON output clean", async () => {
    const { calls, errors, output } = await runAuthentication([
      "--json",
      "auth",
    ]);

    expect(calls[0]?.[1]).toMatchObject({
      clientName: "dhw on synthetic-host",
    });
    expect(errors).toEqual([approvalMessage]);
    expect(output).toEqual([
      JSON.stringify({
        authStatus: "granted",
        session: { ...session, expiresAt: "2026-09-10T10:00:00.000Z" },
      }),
    ]);
  });

  test.each([
    ["expired", "The authentication request expired. Run dhw auth again."],
    [
      "granted",
      "The authentication grant was already exchanged. Run dhw auth again on this machine.",
    ],
    ["revoked", "The CLI session was revoked. Run dhw auth again."],
  ])(
    "fails without saving a token when the request is %s",
    async (authStatus, message) => {
      const { calls, exit, saved } = await runAuthentication(["auth"], {
        status: { authStatus },
      });

      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: {
          reasons: [{ error: { _tag: "AuthenticationFlowError", message } }],
        },
      });
      expect(calls.map(([method]) => method)).toEqual([
        "startAuthentication",
        "getAuthenticationStatus",
      ]);
      expect(saved).toEqual([]);
    }
  );
});
