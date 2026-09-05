import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { ConfiguredAdministrators } from "./configured-administrators.service";
import { makeConfiguredAdministratorsMock } from "./configured-administrators.service.mock";

const membershipProgram = Effect.gen(function* () {
  const administrators = yield* ConfiguredAdministrators;
  return {
    admin: yield* administrators.hasUsername(
      AdministrationActorUsername.make("admin")
    ),
    operator: yield* administrators.hasUsername(
      AdministrationActorUsername.make("operator")
    ),
    nobody: yield* administrators.hasUsername(
      AdministrationActorUsername.make("nobody")
    ),
  };
});

describe("configured administrators capability", () => {
  test("answers exact username membership from the validated environment registry", async () => {
    const membership = await Effect.runPromise(
      membershipProgram.pipe(Effect.provide(ConfiguredAdministrators.Default))
    );

    expect(membership).toEqual({
      admin: true,
      operator: true,
      nobody: false,
    });
  });

  test("accepts a fake administrator set without environment configuration", async () => {
    const administrators = makeConfiguredAdministratorsMock([
      AdministrationActorUsername.make("vaultkeeper"),
    ]);
    const membership = await Effect.runPromise(
      membershipProgram.pipe(Effect.provide(administrators))
    );

    expect(membership).toEqual({
      admin: false,
      operator: false,
      nobody: false,
    });
  });

  test("fake membership matches provided usernames exactly", async () => {
    const administrators = makeConfiguredAdministratorsMock([
      AdministrationActorUsername.make("vaultkeeper"),
      AdministrationActorUsername.make("registrar"),
    ]);
    const membership = await Effect.runPromise(
      Effect.gen(function* () {
        const configured = yield* ConfiguredAdministrators;
        return {
          vaultkeeper: yield* configured.hasUsername(
            AdministrationActorUsername.make("vaultkeeper")
          ),
          registrar: yield* configured.hasUsername(
            AdministrationActorUsername.make("registrar")
          ),
          nobody: yield* configured.hasUsername(
            AdministrationActorUsername.make("nobody")
          ),
        };
      }).pipe(Effect.provide(administrators))
    );

    expect(membership).toEqual({
      vaultkeeper: true,
      registrar: true,
      nobody: false,
    });
  });
});
