import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActionRecord,
  AdministrationAuthentication,
  CliBearerAuthentication,
  CliClientCompatibility,
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
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";

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
export const ClaimEveryCliMutation = Layer.succeed(CliMutationIdempotency, {
  applyOnce: ({ apply }) => apply,
  claim: () => Effect.succeed({ kind: "claimed" as const }),
  complete: () => Effect.void,
  reclaimStale: () => Effect.succeed(false),
  release: () => Effect.void,
});

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
