import "server-only";

import type { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";
import {
  type AdministratorCredentialRegistry,
  isConfiguredAdministratorUsername,
} from "./administrator-credentials";

interface IConfiguredAdministrators {
  readonly hasUsername: (
    username: AdministrationActorUsername
  ) => Effect.Effect<boolean>;
}

export class ConfiguredAdministrators extends Context.Service<
  ConfiguredAdministrators,
  IConfiguredAdministrators
>()("@deskohub-workspace/administrator/ConfiguredAdministrators") {
  static Default = Layer.sync(this, () =>
    fromCredentialRegistry(env.ADMIN_BASIC_AUTH_CREDENTIALS)
  );
}

const fromCredentialRegistry = (
  registry: AdministratorCredentialRegistry
): IConfiguredAdministrators => ({
  hasUsername: Effect.fn("ConfiguredAdministrators.hasUsername")(
    (username: AdministrationActorUsername) =>
      Effect.succeed(isConfiguredAdministratorUsername(registry, username))
  ),
});
