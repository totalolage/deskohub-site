import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AnalyticsConsentUnavailable } from "@/features/legal/backend/analytics-consent-ledger";
import { savedConsentCookie } from "@/shared/testing/consent-cookie.test-utils";
import { getAuthCallbackPath } from "../../routes";
import {
  type CapturedMagicLink,
  callHandler,
  getSessionCookie,
  HOST,
  makeTestAuth,
  signInForMagicLink,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
} from "./auth-handler.test-utils";

const consentCookie = savedConsentCookie({
  categories: ["necessary", "analytics"],
  lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
  languageCode: "en-US",
});

/** Signs in through a magic link whose verification request carries `cookie`. */
const signInWithCookie = async (
  auth: ReturnType<typeof makeTestAuth>,
  sentLinks: readonly CapturedMagicLink[],
  cookie: string | undefined
) => {
  const email = uniqueEmail("sign-in-analytics-consent");
  await signInForMagicLink(auth, email, getAuthCallbackPath("cs-CZ"));
  const link = sentLinks.at(-1)!;
  const forwardedFor = uniqueIp();
  const headers = cookie
    ? { "x-vercel-forwarded-for": forwardedFor, cookie }
    : { "x-vercel-forwarded-for": forwardedFor };
  const signedIn = await callHandler(
    auth,
    link.url.slice(`https://${HOST}/api/auth`.length),
    { headers }
  );
  return { signedIn, accountId: await userIdForEmail(email) };
};

const decisionsOf = async (accountId: string | undefined) => {
  const { rows } = await testDatabase!.pool.query(
    `select decision, locale, source, decided_at
       from account_analytics_consent_decisions
      where account_id = $1`,
    [accountId]
  );
  return rows.map((row) => ({
    ...row,
    decided_at: new Date(row.decided_at as string).toISOString(),
  }));
};

describe.skipIf(!testDatabase)(
  "Sign-in analytics consent mirror on the migrated disposable Postgres",
  () => {
    test("mirrors the signing-in device's saved choice into the new session's account", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });

      const { signedIn, accountId } = await signInWithCookie(
        auth,
        sentLinks,
        `theme=dark; ${consentCookie}`
      );

      expect(getSessionCookie(signedIn)).toBeDefined();
      expect(await decisionsOf(accountId)).toEqual([
        {
          decision: "grant",
          locale: "en-US",
          source: "sign_in_mirror",
          decided_at: "2026-11-02T09:30:00.000Z",
        },
      ]);
    });

    test("mirrors nothing for a device without a saved choice", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });

      const { signedIn, accountId } = await signInWithCookie(
        auth,
        sentLinks,
        undefined
      );

      expect(getSessionCookie(signedIn)).toBeDefined();
      expect(await decisionsOf(accountId)).toEqual([]);
    });

    test("signs the customer in when the mirror fails", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        mirrorAnalyticsConsent: () =>
          Effect.fail(
            new AnalyticsConsentUnavailable({ cause: "ledger unavailable" })
          ),
      });

      const { signedIn } = await signInWithCookie(
        auth,
        sentLinks,
        consentCookie
      );

      expect(getSessionCookie(signedIn)).toBeDefined();
    });
  }
);
