import {
  type CliAccessTokenType,
  CliMutationRequestId,
  type CliSessionType,
  CliSessionUnauthorized,
  type WorkspaceAdminOperationReference,
} from "@deskohub/workspace-admin-api";
import { Console, Crypto, Data, Effect, Option, type Redacted } from "effect";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { DHW_VERSION } from "./build-info";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";

export const rootCommand = Command.make("dhw").pipe(
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON output")
    ),
  }),
  Command.withDescription("Deskohub Workspace administration")
);

export const confirmationFlag = Flag.boolean("yes").pipe(
  Flag.withDescription("Apply the change without prompting for confirmation")
);

/** A fresh ID for one mutation; the client retries it under the same ID. */
export const makeMutationRequestId = Crypto.Crypto.pipe(
  Effect.flatMap((crypto) => crypto.randomUUIDv7),
  Effect.map(CliMutationRequestId.make)
);

export class AuthenticationRequiredError extends Data.TaggedError(
  "AuthenticationRequiredError"
)<{ readonly message: string }> {}

/** A destructive operation was refused because nothing confirmed it. */
export class ConfirmationRequiredError extends Data.TaggedError(
  "ConfirmationRequiredError"
)<{
  readonly message: string;
  readonly operation: WorkspaceAdminOperationReference;
}> {}

export class InvalidMutationInputError extends Data.TaggedError(
  "InvalidMutationInputError"
)<{ readonly message: string }> {}

export const runCommand = <A, E, R>(
  operation: (json: boolean) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const { json } = yield* rootCommand;
    const result = yield* operation(json);
    yield* offerAutomaticUpdate(json);
    return result;
  });

export const runAuthenticatedCommand = <A, E, R>(
  operation: (
    api: WorkspaceAdminApiClient["Service"],
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    json: boolean,
    session: CliSessionType
  ) => Effect.Effect<A, E, R>
) =>
  runCommand((json) =>
    Effect.gen(function* () {
      const authentication = yield* AuthenticationService;
      const current = yield* authentication.current;
      if (Option.isNone(current)) {
        return yield* new AuthenticationRequiredError({
          message: "Run dhw auth before using administration commands.",
        });
      }
      const api = yield* WorkspaceAdminApiClient;
      return yield* operation(
        api,
        current.value.accessToken,
        json,
        current.value.session
      ).pipe(
        Effect.tapError((cause) =>
          cause instanceof CliSessionUnauthorized
            ? authentication.clear.pipe(Effect.asVoid)
            : Effect.void
        )
      );
    })
  );

/**
 * Confirms a destructive administration operation, named as the contract
 * names it. With `--json` or without a terminal, only `--yes` confirms.
 */
export const confirmChange = (
  operation: WorkspaceAdminOperationReference,
  yes: boolean,
  json: boolean,
  message: string
) => {
  if (yes) return Effect.succeed(true);
  if (json || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return new ConfirmationRequiredError({
      message: "Confirmation is required. Pass --yes to apply this change.",
      operation,
    });
  }
  return Prompt.confirm({ message, initial: false }).pipe(Prompt.run);
};

export const reportCancellation = (json: boolean) =>
  Console.log(json ? JSON.stringify({ status: "cancelled" }) : "Cancelled.");

const offerAutomaticUpdate = (json: boolean) =>
  Effect.gen(function* () {
    const config = yield* DhwConfig;

    if (
      json ||
      config.isCi ||
      process.stdin.isTTY !== true ||
      process.stdout.isTTY !== true
    ) {
      return;
    }

    const updateService = yield* UpdateService;
    const available = yield* updateService
      .check(false)
      .pipe(Effect.orElseSucceed(() => Option.none<AvailableUpdate>()));

    if (Option.isNone(available)) return;

    const shouldInstall = yield* confirmUpdate(available.value);
    if (shouldInstall) {
      yield* installAndReport(available.value, false);
    }
  });

export const confirmUpdate = (update: AvailableUpdate) =>
  Prompt.confirm({
    message: `Update dhw ${DHW_VERSION} to ${update.version}?`,
    initial: true,
  }).pipe(Prompt.run);

export const installAndReport = (update: AvailableUpdate, json: boolean) =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
    yield* updateService.install(update);
    yield* Console.log(
      json
        ? JSON.stringify({ status: "updated", version: update.version })
        : `Updated dhw to ${update.version}.`
    );
  });
