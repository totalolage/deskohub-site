import { expect, test } from "bun:test";
import { CliSessionId } from "@deskohub/workspace-admin-api";
import { Console, Effect, Schema } from "effect";
import {
  reportAuthenticationGranted,
  reportAuthenticationStarted,
} from "./authentication-output";

test("keeps auth --json stdout to one final JSON document", async () => {
  const stdout: Array<string> = [];
  const stderr: Array<string> = [];
  const approvalUrl =
    "https://workspace.example/admin/cli/authenticate?code=test";
  const session = {
    id: Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000000"
    ),
    clientName: "dhw on test-machine",
    cliVersion: "1.0.0+development",
    buildTarget: "development",
    createdAt: "2026-08-10T10:00:00.000Z",
    lastUsedAt: "2026-08-10T10:00:00.000Z",
  } as const;

  await Effect.gen(function* () {
    yield* reportAuthenticationStarted({
      approvalUrl,
      expiresAt: "2026-08-10T10:05:00.000Z",
      json: true,
    });
    yield* reportAuthenticationGranted({ json: true, session });
  }).pipe(
    Effect.updateService(Console.Console, (service) => ({
      ...service,
      error: (...args) => stderr.push(args.join(" ")),
      log: (...args) => stdout.push(args.join(" ")),
    })),
    Effect.runPromise
  );

  expect(stdout).toHaveLength(1);
  expect(JSON.parse(stdout[0] ?? "")).toEqual({
    authStatus: "granted",
    session,
  });
  expect(stderr).toHaveLength(1);
  expect(stderr[0]).toContain(approvalUrl);
});
