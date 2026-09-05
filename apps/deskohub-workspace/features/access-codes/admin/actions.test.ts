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
import { Context, Effect, Layer, Schema } from "effect";
import { DEFAULT_SERVER_ERROR_MESSAGE } from "next-safe-action";

interface StubCreateCall {
  readonly attemptId: AdministrationStandaloneAccessCodeAttemptId;
  readonly actor: AdministrationActorUsername;
  readonly source: string;
  readonly request: {
    readonly name: string;
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly providerCredentialRemovedAttemptId?:
    | AdministrationStandaloneAccessCodeAttemptId
    | undefined;
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

mock.module(
  "@/shared/administrator/administrator-authorization.server",
  () => ({
    requireAdministratorAuthorization: Effect.gen(function* () {
      authorizationCalls += 1;
      if (!authorizationAllowed) {
        return yield* Effect.fail(new Error("unauthorized"));
      }
      return actor;
    }),
  })
);

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

const cleanupTargetAttemptId = Schema.decodeSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-0000000000aa");

const cleanupTarget = {
  attemptId: cleanupTargetAttemptId,
  name: Schema.decodeSync(AdministrationStandaloneAccessCodeName)(
    "Stale Booth"
  ),
};

const creationError = (
  outcome: string,
  details: { readonly cleanupTarget?: typeof cleanupTarget } = {}
) => ({
  _tag: "StandaloneAccessCodeCreationError",
  outcome,
  ...(details.cleanupTarget !== undefined && {
    cleanupTarget: details.cleanupTarget,
  }),
});

describe("createStandaloneAccessCode action", () => {
  test("creates with the server-derived actor and the admin-ui source", async () => {
    authorizationCalls = 0;
    authorizationAllowed = true;
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.succeed(createdOutcome);
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode(validInput);

    expect(authorizationCalls).toBe(1);
    expect(result).toEqual({
      data: { status: "succeeded", outcome: createdOutcome },
    });
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
    expect(
      serviceCreateCalls[0]?.providerCredentialRemovedAttemptId
    ).toBeUndefined();
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
      data: { status: "succeeded", outcome: alreadyCreated },
    });
  });

  test("reports provider rejection as an editable failure, not an error", async () => {
    serviceCreateResult = Effect.fail(creationError("rejected"));
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: { status: "failed", outcome: { outcome: "rejected" } },
    });
  });

  test("carries the reported cleanup target for an ambiguous outcome", async () => {
    serviceCreateResult = Effect.fail(
      creationError("ambiguous", { cleanupTarget })
    );
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: {
        status: "failed",
        outcome: { outcome: "ambiguous", cleanupTarget },
      },
    });
  });

  test("carries the reported cleanup target for a cleanup-required outcome", async () => {
    serviceCreateResult = Effect.fail(
      creationError("cleanup-required", { cleanupTarget })
    );
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      data: {
        status: "failed",
        outcome: { outcome: "cleanup-required", cleanupTarget },
      },
    });
  });

  test("treats a missing ambiguous cleanup target as a server defect", async () => {
    serviceCreateResult = Effect.fail(creationError("ambiguous"));
    const { createStandaloneAccessCode } = await import("./actions");

    await expect(createStandaloneAccessCode(validInput)).resolves.toEqual({
      serverError: DEFAULT_SERVER_ERROR_MESSAGE,
    });
  });

  test("forwards the confirmed cleanup target attempt id to the service", async () => {
    authorizationCalls = 0;
    authorizationAllowed = true;
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.succeed(createdOutcome);
    const { createStandaloneAccessCode } = await import("./actions");

    await createStandaloneAccessCode({
      ...validInput,
      providerCredentialRemovedAttemptId: cleanupTargetAttemptId,
    });

    expect(serviceCreateCalls).toHaveLength(1);
    expect(serviceCreateCalls[0]?.providerCredentialRemovedAttemptId).toBe(
      cleanupTargetAttemptId
    );
  });

  test("rejects an invalid access window through input validation", async () => {
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.die("must not be called");
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode({
      ...validInput,
      endsAt: "2026-09-10T09:00",
    });

    expect(result).toMatchObject({
      validationErrors: {
        formErrors: [],
        fieldErrors: {
          endsAt: ["The end must be 1 to 672 hours after the start."],
        },
      },
    });
    expect(serviceCreateCalls).toHaveLength(0);
  });

  test("rejects a window beyond the shared upper bound through input validation", async () => {
    serviceCreateCalls.length = 0;
    serviceCreateResult = Effect.die("must not be called");
    const { createStandaloneAccessCode } = await import("./actions");

    const result = await createStandaloneAccessCode({
      ...validInput,
      startsAt: "2026-10-24T00:00",
      endsAt: "2026-11-21T00:00",
    });

    expect(result).toMatchObject({
      validationErrors: {
        formErrors: [],
        fieldErrors: {
          endsAt: ["The end must be 1 to 672 hours after the start."],
        },
      },
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
