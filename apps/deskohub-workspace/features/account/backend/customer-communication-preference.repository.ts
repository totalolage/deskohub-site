import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerCommunicationPreferences } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

export type CustomerCommunicationPreferenceReadError =
  | EffectDrizzleQueryError
  | SqlError
  | CustomerAccountAccessError;

/**
 * The durable, Workspace-owned preferred communication language of one
 * customer account. A missing row means the account simply has no saved
 * preference yet and is never conflated with a read failure.
 */
export interface ICustomerCommunicationPreferenceRepository {
  readonly load: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    Locale | undefined,
    CustomerCommunicationPreferenceReadError
  >;
  readonly save: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, CustomerAccountAccessError>;
}

/**
 * Folds every non-access failure of the guarded save — the advisory lock
 * itself and the upsert — into one fixed, non-PII write cause. Access
 * failures raised by the deletion-authority recheck pass through unchanged.
 */
const mapPreferenceSaveFailure = mapCustomerAccountFailure(
  "account-communication-preference.write"
);

export class CustomerCommunicationPreferenceRepository extends Context.Service<
  CustomerCommunicationPreferenceRepository,
  ICustomerCommunicationPreferenceRepository
>()("@deskohub-workspace/account/CustomerCommunicationPreferenceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const links = yield* CustomerAccountLinkRepository;

      const load = Effect.fn("CustomerCommunicationPreferenceRepository.load")(
        function* (accountId: CustomerAccountId) {
          // The read guard mirrors the save's deletion-authority check but
          // without the advisory lock: a read never needs mutual exclusion,
          // and its access failure passes through unchanged instead of being
          // folded into the write-failure mapping.
          yield* requireAccountActivity(links, accountId);
          const [row] = yield* db
            .select({ locale: customerCommunicationPreferences.locale })
            .from(customerCommunicationPreferences)
            .where(
              eq(customerCommunicationPreferences.customerAccountId, accountId)
            )
            .limit(1);
          return row?.locale;
        }
      );

      const save = (accountId: CustomerAccountId, locale: Locale) =>
        links
          .withAccountLock(
            accountId,
            requireAccountActivity(links, accountId).pipe(
              Effect.andThen(
                db
                  .insert(customerCommunicationPreferences)
                  .values({ customerAccountId: accountId, locale })
                  .onConflictDoUpdate({
                    target: customerCommunicationPreferences.customerAccountId,
                    set: { locale, updatedAt: sql`now()` },
                  })
              )
            )
          )
          .pipe(Effect.asVoid, Effect.mapError(mapPreferenceSaveFailure));

      return {
        load,
        save,
      } satisfies ICustomerCommunicationPreferenceRepository;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}
