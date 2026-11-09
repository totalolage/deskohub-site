import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import type { CustomerAccountId } from "../../customer-account";
import { ensureCustomerAccount } from "../customer-account.repository";
import { captureAccountLocalePreference } from "../customer-locale-preference";
import { revokeUnconsentedAdministrationTokens } from "./administration-agent-access";

interface ILoginLifecycleRecords {
  /**
   * Creates the durable customer account of a login Better Auth is about to
   * insert, before the insert.
   */
  readonly createCustomerAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /**
   * Sets the locale preference of an account that has none, never
   * overwriting a saved one. Every sign-in captures it from the callback
   * locale for accounts that predate the preference.
   */
  readonly captureLocalePreference: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /**
   * Deletes an agent's tokens that carry the administration scope although
   * its consent no longer names it, after every accepted consent.
   */
  readonly revokeUnconsentedAdministrationTokens: (input: {
    readonly accountId: CustomerAccountId;
    readonly clientId: string;
  }) => Effect.Effect<unknown, EffectDrizzleQueryError | SqlError.SqlError>;
}

/**
 * The Workspace records Better Auth's hooks keep in step with a login: its
 * durable customer account, its captured locale preference, and the agent
 * tokens a narrowed consent no longer covers.
 */
export class LoginLifecycleRecords extends Context.Service<
  LoginLifecycleRecords,
  ILoginLifecycleRecords
>()("@deskohub-workspace/account/LoginLifecycleRecords") {
  static Default = Layer.effect(
    this,
    Effect.map(WorkspaceDatabase, (database): ILoginLifecycleRecords => {
      const onDatabase = Effect.provideService(WorkspaceDatabase, database);
      return {
        createCustomerAccount: (accountId) =>
          ensureCustomerAccount(accountId).pipe(onDatabase),
        captureLocalePreference: (accountId, locale) =>
          captureAccountLocalePreference(accountId, locale).pipe(onDatabase),
        revokeUnconsentedAdministrationTokens: (input) =>
          revokeUnconsentedAdministrationTokens(input).pipe(onDatabase),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
