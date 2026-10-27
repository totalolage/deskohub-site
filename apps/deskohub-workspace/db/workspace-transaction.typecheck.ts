import type { Effect } from "effect";
import type {
  WorkspaceDatabase,
  WorkspaceTransaction,
} from "./database.service";
import type { DatabaseQueryError } from "./sql-constraint";

declare const database: ReturnType<typeof WorkspaceDatabase.make>;
declare const writer: Effect.Effect<
  void,
  DatabaseQueryError,
  WorkspaceTransaction
>;
declare const writerWithService: Effect.Effect<
  void,
  never,
  WorkspaceDatabase | WorkspaceTransaction
>;

const typecheck = false as boolean;

if (typecheck) {
  const inside: Effect.Effect<void, DatabaseQueryError, never> =
    database.transaction(writer);
  const nested: Effect.Effect<void, DatabaseQueryError, never> =
    database.transaction(database.transaction(writer));
  const keepsOtherRequirements: Effect.Effect<
    void,
    DatabaseQueryError,
    WorkspaceDatabase
  > = database.transaction(writerWithService);

  // @ts-expect-error A writer that needs WorkspaceTransaction cannot run outside a transaction.
  // @effect-diagnostics-next-line missingEffectContext:off
  const outside: Effect.Effect<void, DatabaseQueryError, never> = writer;

  // @ts-expect-error The transaction removes only WorkspaceTransaction from the requirements.
  // @effect-diagnostics-next-line missingEffectContext:off
  const lost: Effect.Effect<void, DatabaseQueryError, never> =
    database.transaction(writerWithService);

  void [inside, nested, keepsOtherRequirements, outside, lost];
}
