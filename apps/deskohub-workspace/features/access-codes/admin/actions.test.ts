import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  AdministrationActorUsername,
  AdministrationInstant,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeName,
  AdministrationStandaloneAccessCodePin,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Result, Schema } from "effect";

interface StubCreateCall {
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly actor: AdministrationActorUsername;
  readonly source: string;
  readonly request: {
    readonly name: string;
    readonly startsAt: string;
    readonly endsAt: string;
  };
}

let authorizationCalls = 0;
let authorizationAllowed = true;
const actor = AdministrationActorUsername.make("Fixture Operator");

const serviceCreateCalls: StubCreateCall[] = [];
const serviceCreate = mock((input: StubCreateCall) => {
  serviceCreateCalls.push(input);
  return serviceCreateResult;
});

let serviceCreateResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  outcome: "created",
});

class StubStandaloneAccessCodeAdministration extends Context.Service<
  StubStandaloneAccessCodeAdministration,
  {
    readonly create: (input: StubCreateCall) => Effect.Effect<unknown, unknown>;
  }
>()("@test/StandaloneAccessCodeAdministration") {}

mock.module("@/features/access-codes", () => ({
  StandaloneAccessCodeAdministration: Object.assign(
    StubStandaloneAccessCodeAdministration,
    {
      Live: Layer.succeed(
        StubStandaloneAccessCodeAdministration,
        StubStandaloneAccessCodeAdministration.of({ create: serviceCreate })
      ),
    }
  ),
}));

mock.module("@/features/discounts/admin/basic-auth.server", () => ({
  requireDiscountAdminAuthorization: () =>
    Effect.gen(function* () {
      authorizationCalls += 1;
      if (!authorizationAllowed) {
        return yield* Effect.fail(new Error("unauthorized"));
      }
      return actor;
    }),
}));

mock.module("next/server", () => ({
  after: () => undefined,
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const attemptId = Schema.decodeSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000042");

const createdOutcome = {
  outcome: "created" as const,
  attemptId,
  providerCredentialId: Schema.decodeSync(AdministrationProviderCredentialId)(
    "fixture-pin-id"
  ),
  name: Schema.decodeSync(AdministrationStandaloneAccessCodeName)("Booth A"),
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: AdministrationInstant.make("2026-09-10T09:00:00.000Z"),
  pin: Schema.decodeSync(AdministrationStandaloneAccessCodePin)("7654321"),
};

const validInput = {
  attemptId,
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
};

describe("createStandaloneAccessCode action", () => {
  test("creates with the server-derived actor and the admin-ui source", async () => {
    authorizationCalls = 0;
    authorizationAllowed = true;
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.succeed(createdOutcome);
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode(validInput);

    expect(authorizationCalls).toBe(1);
    expect(result).toEqual({ data: Result.succeed(createdOutcome) });
    expect(serviceCreateCalls).toHaveLength(1);
    expect(serviceCreateCalls[0]).toMatchObject({
      attemptId,
      actor,
      source: "admin-ui",
      request: {
        name: "Booth A",
        startsAt: "2026-09-10T10:00",
        endsAt: "2026-09-10T12:00",
      },
    });
  });

  test("passes the already-created replay outcome through untouched", async () => {
    const alreadyCreated = {
      outcome: "already-created" as const,
      attemptId,
      providerCredentialId: createdOutcome.providerCredentialId,
      name: createdOutcome.name,
      startsAt: createdOutcome.startsAt,
      endsAt: createdOutcome.endsAt,
      issuedAt: createdOutcome.issuedAt,
    };
    serviceCreateResult = Effect.succeed(alreadyCreated);
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: Result.succeed(alreadyCreated),
    });
  });

  test("reports provider rejection as an editable failure, not an error", async () => {
    serviceCreateResult = Effect.fail({
      _tag: "StandaloneAccessCodeCreationError",
      outcome: "rejected",
    });
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: Result.fail("rejected"),
    });
  });

  test("reports an ambiguous provider outcome as a terminal failure", async () => {
    serviceCreateResult = Effect.fail({
      _tag: "StandaloneAccessCodeCreationError",
      outcome: "ambiguous",
    });
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: Result.fail("ambiguous"),
    });
  });

  test("enforces the shared contract window before calling the service", async () => {
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.die("must not be called");
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode({
      ...validInput,
      endsAt: "2026-09-10T09:00",
    });

    expect(result).toMatchObject({
      serverError: expect.stringContaining("1 to 672 whole hours"),
    });
    expect(serviceCreateCalls).toHaveLength(0);
  });

  test("rejects unauthenticated callers before calling the service", async () => {
    authorizationAllowed = false;
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.die("must not be called");
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode(validInput);

    expect(result).toMatchObject({
      serverError: "Administrator authentication is required.",
    });
    expect(serviceCreateCalls).toHaveLength(0);
    authorizationAllowed = true;
  });
});
