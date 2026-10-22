import { testEmailAddress } from "@deskohub/test-email";
import {
  CliBearerAuthentication,
  CliClientCompatibility,
  CliSessionId,
  CliSessionUnauthorized,
  CurrentCliSession,
  dhwVersionHeader,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { CliAuthentication } from "./cli-authentication.service";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";

/** The test client's `dhw`: every request sends this version. */
export const cliClientVersion = (version: string) =>
  HttpApiMiddleware.layerClient(CliClientCompatibility, ({ request, next }) =>
    next(request.pipe(HttpClientRequest.setHeader(dhwVersionHeader, version)))
  );

/** A valid CLI session of a `dhw` at `version`. */
export const authorizedCliRequest = (version: string) =>
  Layer.succeed(CliBearerAuthentication, {
    bearer: (httpEffect) =>
      Effect.provideService(httpEffect, CurrentCliSession, {
        id: CliSessionId.make("01980000-0000-7000-8000-000000000000"),
        approvedBy: null,
        approvedByEmail: null,
        clientName: "test client",
        cliVersion: version,
        buildTarget: "development",
        createdAt: "2026-10-14T08:00:00.000Z",
        lastUsedAt: "2026-10-14T08:00:00.000Z",
        expiresAt: null,
      }),
  });

export const UnauthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: () =>
    Effect.fail(
      new CliSessionUnauthorized({ message: "The CLI session is not valid." })
    ),
});

/** The session's approving administrator, whose grant the port re-reads. */
export const cliSessionAdministrator = {
  accountId: customerAccountIdSchema.make("account-cli-administrator"),
  email: testEmailAddress("cli-administrator"),
};
export const CliSessionAdministrator = Layer.mock(CliAuthentication, {
  sessionAdministrator: () => Effect.succeed(cliSessionAdministrator),
});
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
