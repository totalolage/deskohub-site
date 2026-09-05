import type { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { ConfiguredAdministrators } from "./configured-administrators.service";

export const makeConfiguredAdministratorsMock = (
  usernames: readonly AdministrationActorUsername[]
) =>
  Layer.succeed(ConfiguredAdministrators, {
    hasUsername: (username) =>
      Effect.succeed(usernames.some((member) => member === username)),
  });
