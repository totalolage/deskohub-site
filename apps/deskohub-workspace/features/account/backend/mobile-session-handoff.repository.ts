import "server-only";

import { and, eq, gt, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import { mobileSessionHandoffCodes } from "@/db/schema/mobile-session-handoffs";

type PersistenceError = EffectDrizzleQueryError | SqlError;

export interface IMobileSessionHandoffRepository {
  readonly reserve: (input: {
    readonly codeHash: string;
    readonly now: Temporal.Instant;
    readonly expiresAt: Temporal.Instant;
  }) => Effect.Effect<void, PersistenceError>;
  readonly consume: (input: {
    readonly codeHash: string;
    readonly now: Temporal.Instant;
  }) => Effect.Effect<boolean, PersistenceError>;
}

export class MobileSessionHandoffRepository extends Context.Service<
  MobileSessionHandoffRepository,
  IMobileSessionHandoffRepository
>()("@deskohub-workspace/account/MobileSessionHandoffRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        reserve: Effect.fn("MobileSessionHandoffRepository.reserve")(
          function* (input) {
            yield* db.transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .delete(mobileSessionHandoffCodes)
                  .where(lte(mobileSessionHandoffCodes.expiresAt, input.now));
                yield* tx.insert(mobileSessionHandoffCodes).values({
                  codeHash: input.codeHash,
                  createdAt: input.now,
                  expiresAt: input.expiresAt,
                });
              })
            );
          }
        ),
        consume: Effect.fn("MobileSessionHandoffRepository.consume")(
          function* (input) {
            const consumed = yield* db
              .delete(mobileSessionHandoffCodes)
              .where(
                and(
                  eq(mobileSessionHandoffCodes.codeHash, input.codeHash),
                  gt(mobileSessionHandoffCodes.expiresAt, input.now)
                )
              )
              .returning({ codeHash: mobileSessionHandoffCodes.codeHash });
            return consumed.length === 1;
          }
        ),
      } satisfies IMobileSessionHandoffRepository;
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(WorkspaceDatabaseLive)
  );
}
