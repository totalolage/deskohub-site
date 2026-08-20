import * as PgClient from "@effect/sql-pg/PgClient";
import { Context, Effect, Layer, Semaphore } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";

export const workspaceE2EProviderVerificationConcurrency = 1;
export const workspaceE2EProviderVerificationCooldownMs = 1_000;

export interface WorkspaceE2EProviderVerificationPermit {
  readonly withPermit: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | WorkspaceE2EError, R>;
}

export class WorkspaceE2EProviderVerificationPermitService extends Context.Service<
  WorkspaceE2EProviderVerificationPermitService,
  WorkspaceE2EProviderVerificationPermit
>()("WorkspaceE2E/ProviderVerificationPermitService") {
  static SuiteLocal = Layer.effect(
    this,
    makeSuiteLocalProviderVerificationPermit(
      workspaceE2EProviderVerificationCooldownMs
    )
  );

  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* assertCoordinationConnection(sql);
      const localPermit = yield* Semaphore.make(
        workspaceE2EProviderVerificationConcurrency
      );

      return {
        withPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          localPermit.withPermit(
            sql
              .withTransaction(
                sql`
                  select pg_advisory_xact_lock(
                    ${providerPermitNamespace}::integer,
                    ${providerPermitResource}::integer
                  )
                `.pipe(
                  Effect.andThen(effect),
                  Effect.ensuring(providerVerificationCooldown)
                )
              )
              .pipe(
                Effect.catchIf(SqlError.isSqlError, (cause) =>
                  Effect.fail(
                    toWorkspaceE2EError(
                      "acquire cross-run provider verification permit",
                      cause
                    )
                  )
                )
              )
          ),
      } satisfies WorkspaceE2EProviderVerificationPermit;
    })
  );
}

export function makeSuiteLocalProviderVerificationPermitLayer(
  cooldownMs = workspaceE2EProviderVerificationCooldownMs
) {
  return Layer.effect(
    WorkspaceE2EProviderVerificationPermitService,
    makeSuiteLocalProviderVerificationPermit(cooldownMs)
  );
}

function makeSuiteLocalProviderVerificationPermit(cooldownMs: number) {
  return Semaphore.make(workspaceE2EProviderVerificationConcurrency).pipe(
    Effect.map((semaphore) => ({
      withPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        semaphore.withPermit(
          effect.pipe(
            Effect.ensuring(
              cooldownMs > 0
                ? Effect.sleep(`${cooldownMs} millis`)
                : Effect.void
            )
          )
        ),
    }))
  );
}

const assertCoordinationConnection = (sql: PgClient.PgClient) =>
  sql`select 1`.pipe(
    Effect.asVoid,
    Effect.catchIf(SqlError.isSqlError, (cause) =>
      Effect.fail(
        toWorkspaceE2EError("connect to provider permit database", cause)
      )
    )
  );

const providerVerificationCooldown = Effect.sleep(
  `${workspaceE2EProviderVerificationCooldownMs} millis`
);

// Two fixed int32 keys keep this lock in its own advisory-lock namespace.
const providerPermitNamespace = 0x4453_4b48;
const providerPermitResource = 0x4e45_5849;
