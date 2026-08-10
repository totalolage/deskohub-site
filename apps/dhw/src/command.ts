import {
  makeCliAuthenticationChallenge,
  makeCliAuthenticationVerifier,
} from "@deskohub/workspace-admin-api";
import { Console, Data, Effect, Option } from "effect";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { ClientIdentity } from "./authentication/client-identity.service";
import { DHW_BUILD_TARGET, DHW_VERSION, isReleaseBuild } from "./build-info";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";

const rootCommand = Command.make("dhw").pipe(
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON output")
    ),
  }),
  Command.withDescription("Deskohub Workspace administration")
);

const versionCommand = Command.make("version", {}, () =>
  runCommand((json) =>
    Console.log(
      json
        ? JSON.stringify({ version: DHW_VERSION, target: DHW_BUILD_TARGET })
        : `dhw ${DHW_VERSION} (${DHW_BUILD_TARGET})`
    )
  )
).pipe(Command.withDescription("Show CLI version and build target"));

const apiInfoCommand = Command.make("info", {}, () =>
  runCommand((json) =>
    Effect.gen(function* () {
      const client = yield* WorkspaceAdminApiClient;
      const info = yield* client.getInfo;

      yield* Console.log(
        json
          ? JSON.stringify(info)
          : `${info.service} administration API ${info.apiVersion}`
      );
    })
  )
).pipe(Command.withDescription("Check the administration API contract"));

const apiCommand = Command.make("api").pipe(
  Command.withDescription("Inspect the administration API"),
  Command.withSubcommands([apiInfoCommand])
);

const authCommand = Command.make(
  "auth",
  {
    name: Flag.string("name").pipe(
      Flag.optional,
      Flag.withDescription("Name shown for this client in the admin interface")
    ),
  },
  ({ name }) =>
    runCommand((json) =>
      Effect.gen(function* () {
        const authentication = yield* AuthenticationService;
        const existing = yield* authentication.current;

        if (Option.isSome(existing)) {
          yield* Console.log(
            json
              ? JSON.stringify({
                  authStatus: "granted",
                  session: existing.value.session,
                })
              : `Already authenticated as ${existing.value.session.clientName}.`
          );
          return;
        }

        const api = yield* WorkspaceAdminApiClient;
        const identity = yield* ClientIdentity;
        const config = yield* DhwConfig;
        const clientName = Option.isSome(name)
          ? name.value
          : yield* identity.defaultName;
        const verifier = yield* makeCliAuthenticationVerifier;
        const challenge = yield* makeCliAuthenticationChallenge(verifier);
        const started = yield* api.startAuthentication({
          challenge,
          clientName,
          cliVersion: DHW_VERSION,
          buildTarget: DHW_BUILD_TARGET,
        });
        const approvalUrl = new URL(started.approvalPath, config.baseUrl).href;

        yield* Console.log(
          json
            ? JSON.stringify({
                authStatus: "pending",
                approvalUrl,
                expiresAt: started.expiresAt,
              })
            : `Approve this CLI in your browser:\n${approvalUrl}\n\nWaiting for approval…`
        );

        const session = yield* waitForCliAuthentication({
          api,
          authentication,
          code: started.code,
          verifier,
        });

        yield* Console.log(
          json
            ? JSON.stringify({ authStatus: "granted", session })
            : `Authenticated as ${session.clientName}.`
        );
      })
    )
).pipe(Command.withDescription("Authenticate this CLI through the admin UI"));

const updateCommand = Command.make(
  "update",
  {
    yes: Flag.boolean("yes").pipe(
      Flag.withDescription("Install an available update without prompting")
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { json } = yield* rootCommand;
      const updateService = yield* UpdateService;

      if (!isReleaseBuild) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "development-build" })
            : "Self-update is unavailable in development builds."
        );
        return;
      }

      const available = yield* updateService.check(true);

      if (Option.isNone(available)) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "current", version: DHW_VERSION })
            : `dhw ${DHW_VERSION} is current.`
        );
        return;
      }

      if (json && !yes) {
        yield* Console.log(
          JSON.stringify({ status: "available", ...available.value })
        );
        return;
      }

      const shouldInstall = yes || (yield* confirmUpdate(available.value));
      if (!shouldInstall) return;

      yield* installAndReport(available.value, json);
    })
).pipe(Command.withDescription("Check for and install a CLI update"));

export const dhwCommand = rootCommand.pipe(
  Command.withSubcommands([
    versionCommand,
    apiCommand,
    authCommand,
    updateCommand,
  ])
);

const waitForCliAuthentication = Effect.fn(
  "AuthenticationService.waitForApproval"
)(function* ({
  api,
  authentication,
  code,
  verifier,
}: {
  readonly api: WorkspaceAdminApiClient["Service"];
  readonly authentication: AuthenticationService["Service"];
  readonly code: Parameters<
    WorkspaceAdminApiClient["Service"]["getAuthenticationStatus"]
  >[0];
  readonly verifier: Parameters<typeof makeCliAuthenticationChallenge>[0];
}) {
  while (true) {
    const status = yield* api.getAuthenticationStatus(code);
    switch (status.authStatus) {
      case "pending":
        yield* Effect.sleep("2 seconds");
        break;
      case "approved": {
        const granted = yield* api.exchangeGrant({
          code,
          grantToken: status.grantToken,
          verifier,
        });
        yield* authentication.save(granted.accessToken);
        return granted.session;
      }
      case "expired":
        return yield* new AuthenticationFlowError({
          message: "The authentication request expired. Run dhw auth again.",
        });
      case "granted":
        return yield* new AuthenticationFlowError({
          message:
            "The authentication grant was already exchanged. Run dhw auth again on this machine.",
        });
      case "revoked":
        return yield* new AuthenticationFlowError({
          message: "The CLI session was revoked. Run dhw auth again.",
        });
    }
  }
});

class AuthenticationFlowError extends Data.TaggedError(
  "AuthenticationFlowError"
)<{ readonly message: string }> {}

const runCommand = <A, E, R>(
  operation: (json: boolean) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const { json } = yield* rootCommand;
    const result = yield* operation(json);
    yield* offerAutomaticUpdate(json);
    return result;
  });

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

const confirmUpdate = (update: AvailableUpdate) =>
  Prompt.confirm({
    message: `Update dhw ${DHW_VERSION} to ${update.version}?`,
    initial: true,
  }).pipe(Prompt.run);

const installAndReport = (update: AvailableUpdate, json: boolean) =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
    yield* updateService.install(update);
    yield* Console.log(
      json
        ? JSON.stringify({ status: "updated", version: update.version })
        : `Updated dhw to ${update.version}.`
    );
  });
