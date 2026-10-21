import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  getAccountSignInPath,
  getAuthCallbackPath,
  readAuthCallbackReturnTo,
  signInCallbackReturnParam,
  signInReturnParam,
} from "../../routes";
import {
  type CapturedMagicLink,
  getSessionCookie,
  HOST,
  makeTestAuth,
  signInForMagicLink,
  testDatabase,
  uniqueEmail,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import { digestVerificationKey } from "./auth-options";

/**
 * Moves a sent link's verification row past its expiry. The token is hashed
 * before Better Auth hashes the verification identifier again.
 */
const expireMagicLink = async (link: CapturedMagicLink) => {
  const identifier = await digestVerificationKey(
    await digestVerificationKey(link.token)
  );
  const expired = await testDatabase!.pool.query(
    `update auth.verification set expires_at = now() - interval '1 second' where identifier = $1`,
    [identifier]
  );
  expect(expired.rowCount).toBe(1);
};

describe.skipIf(!testDatabase)(
  "Magic-link verification on the migrated disposable Postgres",
  () => {
    test("creates the customer account of a login a magic link signs up", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("sign-up-account");
      await signInForMagicLink(auth, email, getAuthCallbackPath("en-US"));
      const [link] = sentLinks;
      const signedIn = await verifyMagicLink(auth, link!);
      expect(getSessionCookie(signedIn)).toBeDefined();

      const accountId = await userIdForEmail(email);
      expect(accountId).toBeDefined();
      const { rows } = await testDatabase!.pool.query(
        `select dotypos_customer_id, deleted_at from customer_accounts where id = $1`,
        [accountId]
      );
      expect(rows).toEqual([{ dotypos_customer_id: null, deleted_at: null }]);
    });

    test("sends an expired link to the same rejected-link callback as a used one", async () => {
      // A browser cannot wait out the real ten-minute expiry, so this proves
      // on the real verification table that an expired link lands on the
      // callback's rejected-link card with the return target its new sign-in
      // keeps.
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const returnTo =
        "/cs-CZ/reservation/cowork?entryTier=open-space&date=2026-12-01&coffee=false";
      const callbackURL = getAuthCallbackPath("cs-CZ", { returnTo });
      const expiringEmail = uniqueEmail("expired-link");
      await signInForMagicLink(auth, expiringEmail, callbackURL);
      await signInForMagicLink(auth, uniqueEmail("used-link"), callbackURL);
      const [expiring, used] = sentLinks;
      const firstUse = await verifyMagicLink(auth, used!);
      expect(getSessionCookie(firstUse)).toBeDefined();

      await expireMagicLink(expiring!);
      const expired = await verifyMagicLink(auth, expiring!);
      const replay = await verifyMagicLink(auth, used!);

      expect(getSessionCookie(expired)).toBeUndefined();
      expect(getSessionCookie(replay)).toBeUndefined();
      expect(await userIdForEmail(expiringEmail)).toBeUndefined();
      expect(expired.status).toBe(302);
      expect(expired.headers.get("location")).toBe(
        replay.headers.get("location")
      );
      const location = new URL(expired.headers.get("location") ?? "");
      expect(location.origin).toBe(`https://${HOST}`);
      expect(location.pathname).toBe("/cs-CZ/auth/callback");
      expect(location.searchParams.get("error")).toBe("INVALID_TOKEN");
      // "Request a new link" goes back to sign-in with the same selection.
      const newSignIn = new URL(
        getAccountSignInPath(
          "cs-CZ",
          readAuthCallbackReturnTo(
            location.searchParams.get(signInCallbackReturnParam)
          )
        ),
        location
      );
      expect(newSignIn.searchParams.get(signInReturnParam)).toBe(returnTo);
    });
  }
);
