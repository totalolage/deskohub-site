import { describe, expect, test } from "bun:test";
import {
  CliAccessToken,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DhwConfig } from "../config/dhw-config.service";
import {
  CliApiRequestError,
  WorkspaceAdminApiClient,
} from "./workspace-admin-api-client.service";

describe("WorkspaceAdminApiClient", () => {
  test("uses the shared contract and configured preview headers", async () => {
    const previewHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        previewHeaders.push(request.headers.get("x-preview-bypass"));
        return Response.json({
          apiVersion: "v1",
          service: "deskohub-workspace",
        });
      },
    });

    try {
      const config = Layer.succeed(DhwConfig, {
        baseUrl: new URL(`http://127.0.0.1:${server.port}`),
        requestHeaders: {
          "x-preview-bypass": Redacted.make("preview-secret"),
        },
        isCi: true,
        stateDirectory: "/tmp/dhw-client-test",
        updateChecksDisabled: true,
      });
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(config)
      );
      const info = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* client.getInfo;
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(info).toEqual({
        apiVersion: "v1",
        service: "deskohub-workspace",
      });
      expect(previewHeaders).toEqual(["preview-secret"]);
    } finally {
      server.stop(true);
    }
  });

  test("uses the typed authentication contract and bearer header", async () => {
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const verifier = Schema.decodeUnknownSync(CliAuthenticationVerifier)(
      "v".repeat(43)
    );
    const grantToken = Schema.decodeUnknownSync(CliGrantToken)("g".repeat(43));
    const accessToken = Schema.decodeUnknownSync(CliAccessToken)(
      "a".repeat(43)
    );
    const expiresAt = "2026-08-10T10:00:00.000Z";
    const session = {
      id: "01980000-0000-7000-8000-000000000000",
      clientName: "test client",
      cliVersion: "1.0.0",
      buildTarget: "development",
      createdAt: expiresAt,
      lastUsedAt: expiresAt,
    } as const;
    const requests: Array<{ readonly method: string; readonly path: string }> =
      [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname.endsWith("/auth")) {
          expect(await request.json()).toEqual({
            challenge,
            clientName: "test client",
            cliVersion: "1.0.0",
            buildTarget: "development",
          });
          return Response.json(
            {
              code,
              approvalPath: `/admin/cli/authenticate?code=${code}`,
              expiresAt,
            },
            { status: 201 }
          );
        }
        if (url.pathname.endsWith("/status")) {
          expect(url.searchParams.get("code")).toBe(code);
          return Response.json({ authStatus: "pending", expiresAt });
        }
        if (url.pathname.endsWith("/grant")) {
          expect(await request.json()).toEqual({ code, grantToken, verifier });
          return Response.json({ accessToken, session }, { status: 201 });
        }
        if (url.pathname.endsWith("/session")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json(session);
        }
        return new Response(null, { status: 404 });
      },
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-client-auth-test",
            updateChecksDisabled: true,
          })
        )
      );

      await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        yield* client.startAuthentication({
          challenge,
          clientName: "test client",
          cliVersion: "1.0.0",
          buildTarget: "development",
        });
        yield* client.getAuthenticationStatus(code);
        yield* client.exchangeGrant({ code, grantToken, verifier });
        yield* client.getCurrentSession(Redacted.make(accessToken));
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(requests).toEqual([
        { method: "POST", path: "/api/v1/cli/auth" },
        { method: "GET", path: "/api/v1/cli/status" },
        { method: "POST", path: "/api/v1/cli/grant" },
        { method: "GET", path: "/api/v1/cli/session" },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("sanitizes transport errors that could contain authentication secrets", async () => {
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "s".repeat(43)
    );
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 500 }),
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-client-error-test",
            updateChecksDisabled: true,
          })
        )
      );
      const error = await WorkspaceAdminApiClient.pipe(
        Effect.flatMap((client) => client.getAuthenticationStatus(code)),
        Effect.flip,
        Effect.provide(clientLayer),
        Effect.runPromise
      );

      expect(error).toBeInstanceOf(CliApiRequestError);
      expect(JSON.stringify(error)).not.toContain(code);
    } finally {
      server.stop(true);
    }
  });
});
