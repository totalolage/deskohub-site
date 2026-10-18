import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { IgloohomeService } from "@deskohub/igloohome";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  AdministrationInstant,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCleanupTargetType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeName,
  AdministrationStandaloneAccessCodePin,
  AdministrationStoredDiscountId,
  AdministrationWorkspaceReservationId,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliBearerAuthentication,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  CliSessionUnauthorized,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  CurrentCliSession,
  toAdministrationActorName,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Logger, Option, Result, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import type { CliStoredMutation } from "@/db/schema";
import {
  StandaloneAccessCodeAdministration,
  StandaloneAccessCodeCreationError,
} from "@/features/access-codes";
import { StandaloneAccessCodeAttemptLogRepository } from "@/features/access-codes/backend/standalone-access-code-attempt-log.repository";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  InvoiceAdministrationInProgressError,
  InvoiceAdministrationService,
} from "@/features/accounting/admin/invoice-administration.service";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "@/features/administration/reservation-access-administration.service";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import {
  DiscountAdminConflictError,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import {
  ReservationProductDetailsBackfill,
  type ReservationProductDetailsBackfillBatch,
} from "@/features/reservation/backend/reservation-product-details-backfill.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";
import {
  AdminCliAdministrationApiHandlers,
  AdminCliApiHandlers,
  handleWorkspaceAdminApiRequest,
} from "./workspace-admin-api.server";

const cliAdministrator: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make("cli-administrator-account"),
  email: testEmailAddress("cli-administrator"),
};
// Every session in these tests acts as `cliAdministrator`.
const SessionAdministratorAuthentication = Layer.succeed(CliAuthentication, {
  ...({} as CliAuthentication["Service"]),
  sessionAdministrator: () => Effect.succeed(cliAdministrator),
});
const UnresolvableSessionAuthentication = Layer.succeed(CliAuthentication, {
  ...({} as CliAuthentication["Service"]),
  sessionAdministrator: () =>
    Effect.fail(
      new CliSessionUnauthorized({ message: "No approving administrator." })
    ),
});
const UnusedAdministrationService = Layer.succeed(
  AdministrationService,
  {} as AdministrationService["Service"]
);
const UnusedReservationAdministration = Layer.succeed(
  ReservationAdministrationService,
  {} as ReservationAdministrationService["Service"]
);
const UnusedReservationProductDetailsBackfill = Layer.succeed(
  ReservationProductDetailsBackfill,
  { runBatch: () => Effect.die("not expected") }
);
const ClaimEveryCliMutation = Layer.succeed(CliMutationIdempotency, {
  applyOnce: () => Effect.die("Unused CLI mutation ledger"),
  claim: () => Effect.succeed({ kind: "claimed" as const }),
  complete: () => Effect.void,
  reclaimStale: () => Effect.succeed(false),
  release: () => Effect.void,
});
const UnusedReservationAccessAdministration = Layer.succeed(
  ReservationAccessAdministration,
  {} as ReservationAccessAdministration["Service"]
);
const UnusedDiscountAdministration = Layer.succeed(
  DiscountAdministration,
  {} as DiscountAdministration["Service"]
);
const UnusedInvoiceAdministration = Layer.succeed(
  InvoiceAdministrationService,
  {} as InvoiceAdministrationService["Service"]
);
const UnusedStandaloneAccessCodeAdministration = Layer.succeed(
  StandaloneAccessCodeAdministration,
  {
    create: () => Effect.die("not expected"),
  } satisfies StandaloneAccessCodeAdministration["Service"]
);
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
} as const;
const cliAdministratorEmail = AdministrationActorEmail.make(
  cliAdministrator.email
);
const cliAdministratorApprover = {
  approvedBy: toAdministrationActorName(cliAdministratorEmail),
  approvedByEmail: cliAdministratorEmail,
};
const AuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, session),
});
const ActorAuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, {
      ...session,
      ...cliAdministratorApprover,
    }),
});

describe("Workspace Admin API", () => {
  test("disables caching for API responses", async () => {
    const response = await handleWorkspaceAdminApiRequest(
      new Request("https://workspace.deskohub.test/api/v1/cli/info")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("runs one product-details backfill batch with the requested options", async () => {
    const requests: unknown[] = [];
    const batch: ReservationProductDetailsBackfillBatch = {
      updated: 2,
      alreadyComplete: 1,
      unresolved: [
        {
          reservationId: workspaceReservationIdSchema.make("reservation-b"),
          family: "office",
          reason: "dotypos_seats_invalid",
        },
      ],
      nextCursor: workspaceReservationIdSchema.make("reservation-c"),
    };
    const backfill = Layer.succeed(ReservationProductDetailsBackfill, {
      runBatch: (input) => {
        requests.push(input);
        return Effect.succeed(batch);
      },
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration.backfillReservationProductDetails({
        payload: {
          dryRun: true,
          after: AdministrationWorkspaceReservationId.make("reservation-a"),
        },
      });
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(backfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(Layer.succeed(AdministrationService, {} as never)),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(requests).toEqual([{ dryRun: true, after: "reservation-a" }]);
    expect(result).toEqual(batch);
  });

  test("logs the original failure before reporting the service as unavailable", async () => {
    const logRecords: { readonly level: string; readonly text: string }[] = [];
    const capturingLogger = Logger.make<unknown, void>(
      ({ logLevel, message }) => {
        logRecords.push({ level: logLevel, text: JSON.stringify(message) });
      }
    );
    const failingAdministration = Layer.succeed(AdministrationService, {
      ...({} as AdministrationService["Service"]),
      listReservations: () =>
        Effect.fail(
          new EffectDrizzleQueryError({
            query: "select from workspace reservations",
            params: [],
            cause: new Error("database unavailable"),
          })
        ),
    });

    const error = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      return yield* client.administration
        .listReservations({ query: {} })
        .pipe(Effect.flip);
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(failingAdministration),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.withLogger(capturingLogger),
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(
      logRecords.some(
        ({ level, text }) =>
          level === "Error" &&
          text.includes("select from workspace reservations")
      )
    ).toBe(true);
  });

  test("maps an in-progress invoice claim for retry without changing provenance", async () => {
    const creations: unknown[] = [];
    const invoiceAdministration = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      create: (input, provenance) => {
        creations.push({ input, provenance });
        return creations.length === 1
          ? Effect.fail(
              new InvoiceAdministrationInProgressError({
                invoiceId: input.invoiceId,
                message: "The invoice is still being created.",
              })
            )
          : Effect.succeed({
              invoiceId: input.invoiceId,
              invoiceNumber: "WS-FV-2026-000001",
              changed: true,
              needsAttention: false,
            });
      },
    });
    const payload = {
      invoiceId: "01980000-0000-7000-8000-000000000009",
      customer: {
        kind: "new" as const,
        details: {
          kind: "person" as const,
          email: testEmailAddress("synthetic"),
          firstName: "Synthetic",
          lastName: "Customer",
          address: {
            line1: "Test street 1",
            city: "Prague",
            postalCode: "100 00",
            country: "CZ",
          },
        },
      },
      locale: "cs-CZ" as const,
      serviceDate: "2026-08-10",
      payment: { status: "due" as const, date: "2026-08-24" },
      currency: "CZK",
      lines: [{ description: "Space rental", price: "1000" }],
    };

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const pending = yield* client.administration
        .createInvoice({ payload })
        .pipe(Effect.flip);
      const created = yield* client.administration.createInvoice({ payload });
      return { created, pending };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(invoiceAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedAdministrationService),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.pending).toBeInstanceOf(CliMutationInProgress);
    expect(result.pending.requestId).toBe(payload.invoiceId);
    expect(result.created.invoiceId).toBe(payload.invoiceId);
    expect(creations).toEqual([
      {
        input: payload,
        provenance: { source: "dhw-cli", administrator: cliAdministrator },
      },
      {
        input: payload,
        provenance: { source: "dhw-cli", administrator: cliAdministrator },
      },
    ]);
  });

  test("bounds unauthenticated authentication starts before database writes", async () => {
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    let starts = 0;
    let admissionChecks = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      start: () =>
        Effect.sync(() => {
          starts += 1;
          return {
            code,
            approvalPath: `/admin/cli/authenticate?code=${code}`,
            expiresAt: "2026-08-10T10:00:00.000Z",
          };
        }),
    });
    const admission = Layer.succeed(CliAuthenticationAdmission, {
      isStartAllowed: Effect.sync(() => {
        admissionChecks += 1;
        return admissionChecks <= 10;
      }),
    });

    const results = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* Effect.forEach(
        Array.from({ length: 11 }),
        () =>
          client.cli
            .startAuthentication({
              payload: {
                challenge,
                clientName: "rate limit test",
                cliVersion: "1.0.0",
                buildTarget: "development",
              },
            })
            .pipe(Effect.result),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(admission),
      Effect.provide(authentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(results.filter(Result.isFailure)).toHaveLength(1);
    expect(starts).toBe(10);
  });

  test("returns safe access metadata and maps invalid recovery", async () => {
    const instant = Temporal.Instant.from("2026-08-10T10:00:00Z");
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000020"
    );
    const rejectedRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000021"
    );
    const retryableRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000022"
    );
    const staleRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000023"
    );
    const currentRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000024"
    );
    const grant = {
      id: "access-1" as ReservationAccessGrant["id"],
      reservationId: "reservation-1",
      provider: "igloohome",
      credentialType: "algopin-hourly",
      deviceId: "EK1X16f8898a",
      state: "issued" as const,
      providerCredentialId: "pin-1",
      scheduledAccessStartsAt: instant,
      accessStartsAt: instant,
      accessEndsAt: instant,
      provisioningStartedAt: instant,
      issuedAt: instant,
      failedAt: null,
      failureCode: null,
      createdAt: instant,
      updatedAt: instant,
    } satisfies ReservationAccessGrant;
    let executions = 0;
    let retryableExecutions = 0;
    let staleExecutions = 0;
    const reservationAccess = Layer.succeed(ReservationAccessAdministration, {
      resumeInterruptedMutation: () =>
        Effect.sync(() => {
          staleExecutions += 1;
          return grant;
        }),
      mutate: (mutation) => {
        if (mutation.reservationId === "transient-reservation") {
          retryableExecutions += 1;
          return retryableExecutions === 1
            ? Effect.fail(
                new ReservationAccessAdministrationError({
                  reason: "retryable_failure",
                  message: "Dotypos is temporarily unavailable.",
                })
              )
            : Effect.succeed(grant);
        }
        return mutation.kind === "retry-failed"
          ? Effect.sync(() => {
              executions += 1;
              return grant;
            })
          : Effect.fail(
              new ReservationAccessAdministrationError({
                reason: "invalid_state",
                message: "Only uncertain access can be reconciled.",
              })
            );
      },
    });
    const completed = new Map<string, unknown>();
    const claims = new Set<string>();
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: ({ requestId: claimedRequestId }) =>
        Effect.sync(() => {
          if (
            claimedRequestId === staleRequestId ||
            claimedRequestId === currentRequestId
          ) {
            return { kind: "in-progress" as const };
          }
          if (completed.has(claimedRequestId)) {
            return {
              kind: "completed" as const,
              result: completed.get(claimedRequestId) as never,
            };
          }
          if (claims.has(claimedRequestId)) {
            return { kind: "in-progress" as const };
          }
          claims.add(claimedRequestId);
          return { kind: "claimed" as const };
        }),
      complete: ({ requestId: completedRequestId, result }) =>
        Effect.sync(() => {
          completed.set(completedRequestId, result);
        }),
      reclaimStale: ({ requestId: reclaimedRequestId }) =>
        Effect.succeed(reclaimedRequestId === staleRequestId),
      release: ({ requestId: releasedRequestId }) =>
        Effect.sync(() => {
          claims.delete(releasedRequestId);
        }),
    });
    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const recovered = yield* client.administration.mutateReservationAccess({
        params: { reservationId: grant.reservationId },
        payload: { requestId, mutation: { kind: "retry-failed" } },
      });
      const replayed = yield* client.administration.mutateReservationAccess({
        params: { reservationId: grant.reservationId },
        payload: { requestId, mutation: { kind: "retry-failed" } },
      });
      const rejected = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: grant.reservationId },
          payload: {
            requestId: rejectedRequestId,
            mutation: {
              kind: "confirm-provider-credential-removed",
              providerCredentialRemoved: true,
            },
          },
        })
        .pipe(Effect.flip);
      const retryable = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: "transient-reservation" },
          payload: {
            requestId: retryableRequestId,
            mutation: { kind: "retry-failed" },
          },
        })
        .pipe(Effect.flip);
      const retried = yield* client.administration.mutateReservationAccess({
        params: { reservationId: "transient-reservation" },
        payload: {
          requestId: retryableRequestId,
          mutation: { kind: "retry-failed" },
        },
      });
      const reclaimed = yield* client.administration.mutateReservationAccess({
        params: { reservationId: "stale-reservation" },
        payload: {
          requestId: staleRequestId,
          mutation: { kind: "retry-failed" },
        },
      });
      const current = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: "current-reservation" },
          payload: {
            requestId: currentRequestId,
            mutation: { kind: "retry-failed" },
          },
        })
        .pipe(Effect.flip);
      return {
        current,
        reclaimed,
        recovered,
        rejected,
        replayed,
        retried,
        retryable,
      };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(idempotency),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(reservationAccess),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.recovered.state).toBe("issued");
    expect(result.replayed).toEqual(result.recovered);
    expect(executions).toBe(1);
    expect("accessCode" in result.recovered).toBe(false);
    expect(result.rejected).toBeInstanceOf(CliMutationRejected);
    expect(result.retryable).toBeInstanceOf(CliServiceUnavailable);
    expect(result.retried.state).toBe("issued");
    expect(retryableExecutions).toBe(2);
    expect(result.reclaimed.state).toBe("issued");
    expect(staleExecutions).toBe(1);
    expect(result.current).toBeInstanceOf(CliMutationInProgress);
  });

  test("scopes every session control operation to the authenticated session owner", async () => {
    const ownedSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const foreignSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000002"
    );
    const unknownSessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000003"
    );
    const calls: Array<readonly [string, unknown]> = [];
    const record = <A>(name: string, input: A) =>
      Effect.sync(() => {
        calls.push([name, input]);
      });
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      sessionAdministrator: () => Effect.succeed(cliAdministrator),
      listSessions: (owner) =>
        record("listSessions", owner).pipe(
          Effect.as([
            {
              ...session,
              ...cliAdministratorApprover,
              revokedAt: null,
              status: "active" as const,
            },
          ])
        ),
      renameSession: (input) =>
        record("renameSession", input).pipe(
          Effect.as(input.sessionId === ownedSessionId)
        ),
      revoke: (input) =>
        record("revokeSession", input).pipe(
          Effect.as(input.sessionId === ownedSessionId)
        ),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const sessions = yield* client.administration.listSessions({});
      const renamed = yield* client.administration.renameSession({
        params: { sessionId: ownedSessionId },
        payload: { clientName: "Alice laptop" },
      });
      const foreignRename = yield* client.administration
        .renameSession({
          params: { sessionId: foreignSessionId },
          payload: { clientName: "Stolen label" },
        })
        .pipe(Effect.flip);
      const unknownRename = yield* client.administration
        .renameSession({
          params: { sessionId: unknownSessionId },
          payload: { clientName: "Nobody" },
        })
        .pipe(Effect.flip);
      const revoked = yield* client.administration.revokeSession({
        params: { sessionId: ownedSessionId },
      });
      const foreignRevoke = yield* client.administration.revokeSession({
        params: { sessionId: foreignSessionId },
      });
      const unknownRevoke = yield* client.administration.revokeSession({
        params: { sessionId: unknownSessionId },
      });
      return {
        foreignRename,
        foreignRevoke,
        renamed,
        revoked,
        sessions,
        unknownRename,
        unknownRevoke,
      };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.sessions).toEqual([
      { ...session, ...cliAdministratorApprover, revokedAt: null },
    ]);
    expect(result.renamed).toEqual({ changed: true });
    expect(result.revoked).toEqual({ changed: true });
    expect(result.foreignRename).toBeInstanceOf(CliResourceNotFound);
    expect(result.unknownRename).toBeInstanceOf(CliResourceNotFound);
    expect(result.foreignRevoke).toEqual({ changed: false });
    expect(result.unknownRevoke).toEqual({ changed: false });
    expect(calls).toEqual([
      ["listSessions", cliAdministrator.accountId],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: ownedSessionId,
          clientName: "Alice laptop",
        },
      ],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: foreignSessionId,
          clientName: "Stolen label",
        },
      ],
      [
        "renameSession",
        {
          owner: cliAdministrator.accountId,
          sessionId: unknownSessionId,
          clientName: "Nobody",
        },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: ownedSessionId },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: foreignSessionId },
      ],
      [
        "revokeSession",
        { owner: cliAdministrator.accountId, sessionId: unknownSessionId },
      ],
    ]);
  });

  test("fails session control closed without touching the service when the session's administrator can't be resolved", async () => {
    let serviceCalls = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      sessionAdministrator: () =>
        Effect.fail(
          new CliSessionUnauthorized({ message: "No approving administrator." })
        ),
      listSessions: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return [];
        }),
      renameSession: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return true;
        }),
      revoke: () =>
        Effect.sync(() => {
          serviceCalls += 1;
          return true;
        }),
    });
    const sessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000004"
    );

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const sessions = yield* client.administration
        .listSessions({})
        .pipe(Effect.flip);
      const renamed = yield* client.administration
        .renameSession({
          params: { sessionId },
          payload: { clientName: "Legacy" },
        })
        .pipe(Effect.flip);
      const revoked = yield* client.administration
        .revokeSession({ params: { sessionId } })
        .pipe(Effect.flip);
      return { renamed, revoked, sessions };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.sessions).toBeInstanceOf(CliServiceUnavailable);
    expect(result.renamed).toBeInstanceOf(CliServiceUnavailable);
    expect(result.revoked).toBeInstanceOf(CliServiceUnavailable);
    expect(serviceCalls).toBe(0);
  });

  test("replays completed mutations and preserves deterministic conflicts", async () => {
    const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const replayRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000010"
    );
    const conflictRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000011"
    );
    const pendingRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000012"
    );
    let executions = 0;
    let releases = 0;
    const mutation = { kind: "delete-discount" as const, id: discountId };
    const replayedResult = {
      kind: mutation.kind,
      createdDiscountId: null,
      createdCodeId: null,
      createdVoucherId: null,
    };
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: ({ requestId }) =>
        Effect.sync(() => {
          if (requestId === replayRequestId) {
            return { kind: "completed" as const, result: replayedResult };
          }
          if (requestId === pendingRequestId) {
            return { kind: "in-progress" as const };
          }
          return { kind: "claimed" as const };
        }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      deleteDiscount: () =>
        Effect.sync(() => {
          executions += 1;
        }).pipe(
          Effect.andThen(
            new DiscountAdminConflictError({
              reason: "discount-referenced",
              message: "This discount is still referenced.",
            })
          )
        ),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const replayed = yield* client.administration.mutateDiscounts({
        payload: { requestId: replayRequestId, mutation },
      });
      const conflict = yield* client.administration
        .mutateDiscounts({
          payload: { requestId: conflictRequestId, mutation },
        })
        .pipe(Effect.flip);
      const pending = yield* client.administration
        .mutateDiscounts({
          payload: { requestId: pendingRequestId, mutation },
        })
        .pipe(Effect.flip);
      return { conflict, pending, replayed };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(idempotency),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedStandaloneAccessCodeAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(discounts),
      Effect.provide(SessionAdministratorAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.replayed).toEqual(replayedResult);
    expect(result.conflict).toBeInstanceOf(CliMutationRejected);
    expect(result.pending).toBeInstanceOf(CliMutationInProgress);
    expect(executions).toBe(1);
    expect(releases).toBe(1);
  });
});

describe("standalone access-code CLI endpoint", () => {
  const attemptId = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeAttemptId
  )("01980000-0000-7000-8000-000000000042");
  const priorAttemptId = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeAttemptId
  )("01980000-0000-7000-8000-000000000041");
  const priorCleanupTarget = {
    attemptId: priorAttemptId,
    name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
      "Old Booth"
    ),
  } satisfies AdministrationStandaloneAccessCodeCleanupTargetType;
  const payload = {
    attemptId,
    input: Schema.decodeUnknownSync(
      AdministrationStandaloneAccessCodeCreateInput
    )({
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    }),
  };
  const createdOutcome = {
    outcome: "created",
    attemptId,
    providerCredentialId: Schema.decodeUnknownSync(
      AdministrationProviderCredentialId
    )("pin-1"),
    name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
      "Booth A"
    ),
    startsAt: Schema.decodeUnknownSync(
      AdministrationWorkspaceSiteLocalWholeHourDateTime
    )("2026-09-10T10:00"),
    endsAt: Schema.decodeUnknownSync(
      AdministrationWorkspaceSiteLocalWholeHourDateTime
    )("2026-09-10T12:00"),
    issuedAt: Schema.decodeUnknownSync(AdministrationInstant)(
      "2026-09-10T08:00:00Z"
    ),
    pin: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodePin)(
      "7654321"
    ),
  } satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;
  const creationFailure = (
    outcome: StandaloneAccessCodeCreationError["outcome"],
    message: string,
    details: {
      readonly cleanupTarget?: AdministrationStandaloneAccessCodeCleanupTargetType;
    } = {}
  ) =>
    new StandaloneAccessCodeCreationError({
      attemptId,
      outcome,
      message,
      ...details,
    });

  const runAdministration = <A, E, R>(
    bearer: Layer.Layer<CliBearerAuthentication>,
    standalone: Layer.Layer<StandaloneAccessCodeAdministration>,
    idempotency: Layer.Layer<CliMutationIdempotency>,
    operation: Effect.Effect<A, E, R>,
    authentication: Layer.Layer<CliAuthentication> = SessionAdministratorAuthentication
  ) =>
    operation.pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(bearer),
      Effect.provide(standalone),
      Effect.provide(idempotency),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationProductDetailsBackfill),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped
    );

  const createAccessCodeError = Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
      "administration",
    ]);
    return yield* client.administration
      .createStandaloneAccessCode({ payload })
      .pipe(Effect.flip);
  });

  test("discloses the PIN once and stores only PIN-free completion metadata", async () => {
    const creations: unknown[] = [];
    const completions: unknown[] = [];
    const completedResults = new Map<string, unknown>();
    let claimedOnce = false;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: (input) =>
        Effect.sync(() => {
          creations.push(input);
          return createdOutcome;
        }),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: ({ requestId }) =>
        Effect.sync(() => {
          if (completedResults.has(requestId)) {
            return {
              kind: "completed" as const,
              result: completedResults.get(requestId) as never,
            };
          }
          if (claimedOnce) return { kind: "in-progress" as const };
          claimedOnce = true;
          return { kind: "claimed" as const };
        }),
      complete: ({ requestId, result }) =>
        Effect.sync(() => {
          completions.push(result);
          completedResults.set(requestId, result);
        }),
      reclaimStale: () => Effect.succeed(false),
      release: () => Effect.die("not expected"),
    });

    const [created, replayed] = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
          "administration",
        ]);
        const first = yield* client.administration.createStandaloneAccessCode({
          payload,
        });
        const second = yield* client.administration.createStandaloneAccessCode({
          payload,
        });
        return [first, second] as const;
      })
    ).pipe(Effect.runPromise);

    expect(created).toMatchObject({ outcome: "created", pin: "7654321" });
    expect(completions).toHaveLength(1);
    expect(JSON.stringify(completions[0])).not.toContain("7654321");
    expect(completions[0]).toEqual({
      attemptId,
      providerCredentialId: "pin-1",
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
      issuedAt: "2026-09-10T08:00:00Z",
    });
    expect(replayed).toMatchObject({ outcome: "already-created" });
    expect("pin" in replayed).toBe(false);
    expect(JSON.stringify(replayed)).not.toContain("7654321");
    expect(creations).toHaveLength(1);
    expect(creations[0]).toMatchObject({
      attemptId,
      source: "dhw-cli",
      actor: cliAdministrator,
    });
  });

  test("returns the created PIN even when the ledger completion write fails", async () => {
    const releases: unknown[] = [];
    const logRecords: string[] = [];
    const capturingLogger = Logger.make<unknown, void>(({ message }) => {
      logRecords.push(JSON.stringify(message));
    });
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () => Effect.succeed(createdOutcome),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () =>
        Effect.fail(
          new EffectDrizzleQueryError({
            query: "update cli mutation requests",
            params: [],
            cause: new Error("write unavailable"),
          })
        ),
      reclaimStale: () => Effect.succeed(false),
      release: (request) =>
        Effect.sync(() => {
          releases.push(request);
        }),
    });

    const created = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
          "administration",
        ]);
        return yield* client.administration.createStandaloneAccessCode({
          payload,
        });
      })
    ).pipe(Effect.withLogger(capturingLogger), Effect.runPromise);

    expect(created).toMatchObject({ outcome: "created", pin: "7654321" });
    expect(releases).toHaveLength(1);
    expect(
      logRecords.some(
        (record) => record.includes("completion") && record.includes(attemptId)
      )
    ).toBe(true);
    expect(logRecords.join("\n")).not.toContain("7654321");
  });

  test("fails closed before claiming the mutation ledger when the session's administrator can't be resolved", async () => {
    let claims = 0;
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () =>
        Effect.sync(() => {
          claims += 1;
          return { kind: "claimed" as const };
        }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () => Effect.void,
    });

    const error = await runAdministration(
      AuthorizedCliRequest,
      UnusedStandaloneAccessCodeAdministration,
      idempotency,
      createAccessCodeError,
      UnresolvableSessionAuthentication
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(claims).toBe(0);
  });

  test("rejects a mismatched attempt identity without calling the provider", async () => {
    let creations = 0;
    let releases = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.sync(() => {
          creations += 1;
          return createdOutcome;
        }),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "mismatch" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error.message).toContain("different input");
    expect(creations).toBe(0);
    expect(releases).toBe(0);
  });

  test("releases the claim and rejects when creation is definitively rejected", async () => {
    let releases = 0;
    let completions = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "rejected",
            "The standalone access-code request was rejected."
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () =>
        Effect.sync(() => {
          completions += 1;
        }),
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error.message).toContain("rejected");
    expect(releases).toBe(1);
    expect(completions).toBe(0);
  });

  test("releases the claim and reports unavailability without completion", async () => {
    let releases = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "unavailable",
            "Standalone access-code creation is temporarily unavailable."
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(releases).toBe(1);
  });

  test("keeps the claim and reports uncertainty naming the ambiguous target without a PIN", async () => {
    let releases = 0;
    let completions = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "ambiguous",
            "The standalone access-code creation outcome is ambiguous.",
            {
              cleanupTarget: {
                attemptId,
                name: payload.input.name,
              },
            }
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () =>
        Effect.sync(() => {
          completions += 1;
        }),
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationUncertain);
    if (error instanceof CliMutationUncertain) {
      expect(error.message).toContain("Booth A");
      expect(error.message).toContain(attemptId);
      expect(error.message).toContain(
        `--provider-credential-removed ${attemptId}`
      );
    }
    expect(JSON.stringify(error)).not.toContain("7654321");
    expect(releases).toBe(0);
    expect(completions).toBe(0);
  });

  test("reports unavailability when the ambiguous outcome carries no cleanup target", async () => {
    let releases = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "ambiguous",
            "The standalone access-code creation outcome is ambiguous."
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(releases).toBe(1);
  });

  test("reports an unexpired in-progress claim without resuming", async () => {
    let creations = 0;
    let reclaims = 0;
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.sync(() => {
          creations += 1;
          return createdOutcome;
        }),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "in-progress" as const }),
      complete: () => Effect.void,
      reclaimStale: () =>
        Effect.sync(() => {
          reclaims += 1;
          return false;
        }),
      release: () => Effect.void,
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationInProgress);
    expect(error.requestId).toBe(attemptId);
    expect(reclaims).toBe(1);
    expect(creations).toBe(0);
  });

  test("reports required at-lock cleanup with the stored prior target and releases the ledger claim", async () => {
    let releases = 0;
    const cleanupRequired = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "cleanup-required",
            "A previous attempt for this window is ambiguous.",
            { cleanupTarget: priorCleanupTarget }
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      cleanupRequired,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliStandaloneAccessCodeCleanupRequired);
    if (error instanceof CliStandaloneAccessCodeCleanupRequired) {
      expect(error.cleanupTarget).toEqual(priorCleanupTarget);
      expect(error.message).toContain("Old Booth");
      expect(error.message).toContain(priorAttemptId);
      expect(error.message).toContain(
        `--provider-credential-removed ${priorAttemptId}`
      );
      expect(error.message).toContain("Igloohome");
      expect(error.message).not.toContain("Booth A");
      expect(error.message).not.toContain(attemptId);
    }
    expect(JSON.stringify(error)).not.toContain("7654321");
    expect(releases).toBe(1);
  });

  test("reports unavailability when the cleanup-required outcome carries no target", async () => {
    let releases = 0;
    const cleanupRequired = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "cleanup-required",
            "A previous attempt for this window is ambiguous."
          )
        ),
    });
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      cleanupRequired,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliServiceUnavailable);
    expect(JSON.stringify(error)).not.toContain("Booth A");
    expect(releases).toBe(1);
  });

  test("reports a confirmed reconciled replay as a typed error and releases the ledger claim", async () => {
    let releases = 0;
    const reconciled = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.fail(
          creationFailure(
            "reconciled",
            "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code."
          )
        ),
    } as never);
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "claimed" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });

    const error = await runAdministration(
      ActorAuthorizedCliRequest,
      reconciled,
      idempotency,
      createAccessCodeError
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(CliStandaloneAccessCodeReconciled);
    expect(error.message).toContain("Run the same command again");
    expect(releases).toBe(1);
  });

  test("resumes a stale claim through the standalone attempt log without another provider call", async () => {
    const providerCredentialId = Schema.decodeUnknownSync(
      AdministrationProviderCredentialId
    )("pin-already-issued");
    const occurredAt = Temporal.Now.instant();
    let providerCalls = 0;
    let claimCalls = 0;
    let appendTerminalCalls = 0;
    const reclaims: Array<{
      readonly requestId: string;
      readonly staleMilliseconds: bigint;
    }> = [];
    const completions: unknown[] = [];
    const attemptLog = Layer.mock(StandaloneAccessCodeAttemptLogRepository, {
      claim: (input: { readonly attempt: { readonly attemptId: string } }) =>
        Effect.sync(() => {
          claimCalls += 1;
          if (input.attempt.attemptId !== attemptId) {
            return { kind: "mismatch" } as const;
          }
          return {
            kind: "created" as const,
            terminal: {
              name: Schema.decodeUnknownSync(
                AdministrationStandaloneAccessCodeName
              )("Booth A"),
              startsAtLocal: payload.input.startsAt,
              endsAtLocal: payload.input.endsAt,
              providerCredentialId,
              occurredAt,
            },
          } as const;
        }),
      appendTerminal: () =>
        Effect.sync(() => {
          appendTerminalCalls += 1;
          return { kind: "appended" as const };
        }),
    });
    const igloohome = Layer.mock(IgloohomeService, {
      issueHourlyAlgoPin: () =>
        Effect.sync(() => {
          providerCalls += 1;
          return { pin: "0000000", pinId: "unexpected" };
        }),
    });
    const standalone = StandaloneAccessCodeAdministration.Default.pipe(
      Layer.provide(Layer.mergeAll(attemptLog, igloohome))
    );
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "in-progress" as const }),
      complete: ({ result }) =>
        Effect.sync(() => {
          completions.push(result);
        }),
      reclaimStale: ({ requestId, reclaimedAt, staleBefore }) =>
        Effect.sync(() => {
          reclaims.push({
            requestId,
            staleMilliseconds:
              reclaimedAt.epochNanoseconds - staleBefore.epochNanoseconds,
          });
          return true;
        }),
      release: () => Effect.die("not expected"),
    });

    const [outcome, storedResult] = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
          "administration",
        ]);
        const replayed =
          yield* client.administration.createStandaloneAccessCode({
            payload,
          });
        return [replayed, completions[0]] as const;
      })
    ).pipe(Effect.runPromise);

    expect(outcome).toMatchObject({
      outcome: "already-created",
      attemptId,
      providerCredentialId: "pin-already-issued",
    });
    expect("pin" in outcome).toBe(false);
    expect(providerCalls).toBe(0);
    expect(claimCalls).toBe(1);
    expect(appendTerminalCalls).toBe(0);
    expect(reclaims).toEqual([
      { requestId: attemptId, staleMilliseconds: 60_000_000_000n },
    ]);
    expect(storedResult).toEqual({
      attemptId,
      providerCredentialId: "pin-already-issued",
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
      issuedAt: occurredAt.toString(),
    });
    expect(JSON.stringify(storedResult)).not.toContain("7654321");
  });

  test("rejects a stale retry that confirms a different cleanup target without sharing the claim", async () => {
    const otherAttemptId = Schema.decodeUnknownSync(
      AdministrationStandaloneAccessCodeAttemptId
    )("01980000-0000-7000-8000-000000000043");
    let creations = 0;
    const claims: CliStoredMutation[] = [];
    const reclaims: CliStoredMutation[] = [];
    const ledger = new Map<
      string,
      { readonly mutation: CliStoredMutation; result: unknown }
    >();
    const ledgerKey = (request: {
      readonly sessionId: string;
      readonly requestId: string;
    }) => `${request.sessionId}/${request.requestId}`;
    const sameStoredMutation = (
      stored: CliStoredMutation,
      incoming: CliStoredMutation
    ) => JSON.stringify(stored) === JSON.stringify(incoming);
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: (request) =>
        Effect.sync(() => {
          claims.push(request.mutation);
          const row = ledger.get(ledgerKey(request));
          if (!row) {
            ledger.set(ledgerKey(request), {
              mutation: request.mutation,
              result: null,
            });
            return { kind: "claimed" as const };
          }
          if (!sameStoredMutation(row.mutation, request.mutation)) {
            return { kind: "mismatch" as const };
          }
          return row.result === null
            ? { kind: "in-progress" as const }
            : { kind: "completed" as const, result: row.result as never };
        }),
      complete: (request) =>
        Effect.sync(() => {
          const row = ledger.get(ledgerKey(request));
          if (row) row.result = request.result;
        }),
      reclaimStale: (request) =>
        Effect.sync(() => {
          const row = ledger.get(ledgerKey(request));
          if (!row || !sameStoredMutation(row.mutation, request.mutation)) {
            return false;
          }
          reclaims.push(request.mutation);
          row.result = null;
          return true;
        }),
      release: (request) =>
        Effect.sync(() => {
          ledger.delete(ledgerKey(request));
        }),
    });
    const standalone = Layer.succeed(StandaloneAccessCodeAdministration, {
      create: () =>
        Effect.suspend(() => {
          creations += 1;
          return creations === 1
            ? Effect.fail(
                creationFailure(
                  "ambiguous",
                  "The standalone access-code creation outcome is ambiguous.",
                  { cleanupTarget: priorCleanupTarget }
                )
              )
            : Effect.succeed(createdOutcome);
        }),
    });
    const confirmTarget = (
      cleanupAttemptId: AdministrationStandaloneAccessCodeAttemptIdType
    ) => ({
      ...payload,
      providerCredentialRemovedAttemptId: cleanupAttemptId,
    });

    const [firstAttempt, secondAttempt, thirdAttempt] = await runAdministration(
      ActorAuthorizedCliRequest,
      standalone,
      idempotency,
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
          "administration",
        ]);
        const first = yield* client.administration
          .createStandaloneAccessCode({
            payload: confirmTarget(priorAttemptId),
          })
          .pipe(Effect.flip);
        const second = yield* client.administration
          .createStandaloneAccessCode({
            payload: confirmTarget(otherAttemptId),
          })
          .pipe(Effect.flip);
        const third = yield* client.administration
          .createStandaloneAccessCode({
            payload: confirmTarget(priorAttemptId),
          })
          .pipe(Effect.result);
        return [first, second, third] as const;
      })
    ).pipe(Effect.runPromise);

    expect(firstAttempt).toBeInstanceOf(CliMutationUncertain);
    expect(secondAttempt).toBeInstanceOf(CliMutationRejected);
    expect(secondAttempt.message).toContain("different input");
    expect(Result.isSuccess(thirdAttempt)).toBe(true);
    if (Result.isSuccess(thirdAttempt)) {
      expect(
        Option.getOrUndefined(Result.getSuccess(thirdAttempt))
      ).toMatchObject({
        outcome: "created",
        attemptId,
      });
    }
    expect(creations).toBe(2);
    expect(claims).toEqual([
      {
        kind: "standalone-access-code",
        request: payload.input,
        providerCredentialRemovedAttemptId: priorAttemptId,
      },
      {
        kind: "standalone-access-code",
        request: payload.input,
        providerCredentialRemovedAttemptId: otherAttemptId,
      },
      {
        kind: "standalone-access-code",
        request: payload.input,
        providerCredentialRemovedAttemptId: priorAttemptId,
      },
    ]);
    expect(reclaims).toEqual([claims[0]]);
  });
});
