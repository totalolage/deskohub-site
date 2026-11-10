import { and, eq, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { authUser } from "@/db/schema/auth";
import type { Locale } from "@/features/i18n";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountSections } from "./customer-account-sections";

/*
 * The customer's locale preference is the nullable `locale` field on the
 * Better Auth user. It is both the email language and the signed-in site
 * locale. Account creation sets it in the user insert; an account created
 * before the field existed has none until its next sign-in or an explicit
 * save. Readers get it from the authoritative session
 * (`CustomerAccountSession.localePreference`), not from here.
 */

/**
 * Saves the signed-in customer's locale preference in the account's section.
 * The section re-reads the session only after the lock is held, so a session
 * that expires or is revoked while the saver waits can never write, and a
 * deletion-marked account is rejected. A failed write is the fixed, non-PII
 * `account-locale-preference.write` cause; the section's own failures pass
 * through.
 */
export const saveAccountLocalePreference = (
  accountId: CustomerAccountId,
  locale: Locale
): Effect.Effect<
  void,
  CustomerAccountAccessError,
  WorkspaceDatabase | CustomerAccountSections
> =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    const sections = yield* CustomerAccountSections;
    yield* sections.withActiveAccount(
      accountId,
      db
        .update(authUser)
        .set({ locale })
        .where(eq(authUser.id, accountId))
        .pipe(
          Effect.mapError(
            mapCustomerAccountFailure("account-locale-preference.write")
          )
        ),
      { recheck: "session" }
    );
  }).pipe(Effect.withSpan("CustomerLocalePreference.save"));

/**
 * Records the sign-in locale for an account that has no preference yet. The
 * update only matches a null locale, so a retried or racing sign-in never
 * overwrites a saved preference.
 */
export const captureAccountLocalePreference = (
  accountId: CustomerAccountId,
  locale: Locale
): Effect.Effect<void, EffectDrizzleQueryError, WorkspaceDatabase> =>
  Effect.flatMap(WorkspaceDatabase, ({ db }) =>
    db
      .update(authUser)
      .set({ locale })
      .where(and(eq(authUser.id, accountId), isNull(authUser.locale)))
  ).pipe(Effect.asVoid, Effect.withSpan("CustomerLocalePreference.capture"));

/**
 * The closed outcome of the pre-delivery magic-link locale lookup. Only a
 * verified existing account with a saved preference yields a locale; every
 * other shape stays distinguishable so the caller can choose its fallback.
 */
export type MagicLinkLocaleLookup =
  | { readonly kind: "pre-account" }
  | { readonly kind: "unverified-email" }
  | { readonly kind: "account"; readonly locale: Locale }
  | { readonly kind: "account-locale-missing" }
  | { readonly kind: "read-failed" };

const findMagicLinkRecipient = Effect.fn(
  "CustomerLocalePreference.lookupMagicLinkDeliveryLocale"
)(function* (email: string) {
  const { db } = yield* WorkspaceDatabase;
  const [row] = yield* db
    .select({ emailVerified: authUser.emailVerified, locale: authUser.locale })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);
  if (!row) return { kind: "pre-account" } as const;
  if (!row.emailVerified) return { kind: "unverified-email" } as const;
  if (!row.locale) return { kind: "account-locale-missing" } as const;
  return { kind: "account", locale: row.locale } as const;
});

/**
 * Resolves the magic-link email locale for one recipient address from the
 * Better Auth user, if any. The lookup never fails: an operational read
 * failure is its own outcome so the delivery path can distinguish it from a
 * recipient without an account.
 */
export const lookupMagicLinkDeliveryLocale = (
  email: string
): Effect.Effect<MagicLinkLocaleLookup, never, WorkspaceDatabase> =>
  findMagicLinkRecipient(email).pipe(
    Effect.orElseSucceed((): MagicLinkLocaleLookup => ({ kind: "read-failed" }))
  );
