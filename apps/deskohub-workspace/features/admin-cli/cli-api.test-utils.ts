import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActionRecord,
  AdministrationAuthentication,
  CliBearerAuthentication,
  CliClientCompatibility,
  type CliMutationInProgress,
  type CliMutationRejected,
  CliSessionId,
  CliSessionUnauthorized,
  CurrentAdministrationCaller,
  dhwVersionHeader,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { AdministrationActionLog } from "./administration-action-log.service";
import { AdministrationRequestLedger } from "./administration-request-ledger.service";

/** The test client's `dhw`: every request sends this version. */
export const cliClientVersion = (version: string) =>
  HttpApiMiddleware.layerClient(CliClientCompatibility, ({ request, next }) =>
    next(request.pipe(HttpClientRequest.setHeader(dhwVersionHeader, version)))
  );

/** The session's approving administrator, whose grant the port re-reads. */
export const cliSessionAdministrator = {
  accountId: customerAccountIdSchema.make("account-cli-administrator"),
  email: testEmailAddress("cli-administrator"),
};

// `cli.getCurrentSession` keeps the CLI's own bearer; these suites never call it.
export const UnusedCliSessionAuthentication = Layer.succeed(
  CliBearerAuthentication,
  {
    bearer: () => Effect.die("The CLI session endpoint isn't under test."),
  }
);

/** A valid CLI session of `cliSessionAdministrator`. */
export const authorizedCliRequest = (
  sessionId = CliSessionId.make("01980000-0000-7000-8000-000000000000")
) =>
  Layer.mergeAll(
    UnusedCliSessionAuthentication,
    Layer.succeed(AdministrationAuthentication, {
      bearer: (httpEffect) =>
        Effect.provideService(httpEffect, CurrentAdministrationCaller, {
          actor: cliSessionAdministrator,
          channel: { _tag: "CliSession", sessionId },
        }),
    })
  );

export const UnauthorizedCliRequest = Layer.mergeAll(
  UnusedCliSessionAuthentication,
  Layer.succeed(AdministrationAuthentication, {
    bearer: () =>
      Effect.fail(
        new CliSessionUnauthorized({ message: "The CLI session is not valid." })
      ),
  })
);

export const GrantedAdministrator = Layer.mock(AccountRoleGrants, {
  has: () => Effect.succeed(true),
});

/** Every mutation is new; Postgres suites cover replays. */
export const ClaimEveryCliMutation = Layer.succeed(
  AdministrationRequestLedger,
  {
    applyOnce: ({ apply }) => apply,
    applyOnceWithEffects: ({ apply }) => apply,
  } as AdministrationRequestLedger["Service"]
);

/** Records the handler's ledger request while applying its first attempt. */
export const recordingRequestLedger = (
  refusal?: CliMutationInProgress | CliMutationRejected
) => {
  const requests: Array<{
    readonly requestId: unknown;
    readonly mutation: unknown;
    readonly channel: CurrentAdministrationCaller["Service"]["channel"];
    readonly recovery?: unknown;
    readonly stored?: unknown;
    readonly resume?: unknown;
    readonly inProgressMessage?: string;
  }> = [];
  const firstAttempt = <A, E, R>(
    apply: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | CliMutationInProgress | CliMutationRejected, R> =>
    refusal
      ? (Effect.fail(refusal) as Effect.Effect<
          A,
          E | CliMutationInProgress | CliMutationRejected,
          R
        >)
      : apply;
  return {
    layer: Layer.succeed(AdministrationRequestLedger, {
      applyOnce: (request) =>
        Effect.flatMap(CurrentAdministrationCaller, ({ channel }) =>
          Effect.sync(() => {
            requests.push({ ...request, channel });
          }).pipe(Effect.andThen(request.apply))
        ),
      applyOnceWithEffects: (request) =>
        Effect.flatMap(CurrentAdministrationCaller, ({ channel }) =>
          Effect.flatMap(
            Effect.sync(() => {
              requests.push({ ...request, channel });
            }),
            () => firstAttempt(request.apply)
          )
        ),
    } as AdministrationRequestLedger["Service"]),
    requests,
  };
};

/**
 * Runs operations without recording them, for suites built from group
 * handlers; `administration-action-record.server.test.ts` covers the record.
 */
export const UnrecordedAdministrationActions = Layer.succeed(
  AdministrationActionRecord,
  (httpEffect) => httpEffect
);

/** An action log that keeps nothing, for suites serving the whole API. */
export const DiscardedAdministrationActionLog = Layer.succeed(
  AdministrationActionLog,
  {
    start: () => Effect.succeed("01980000-0000-7000-8000-0000000000f1"),
    finish: () => Effect.void,
  }
);
