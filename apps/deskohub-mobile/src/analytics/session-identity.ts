import { isTestEmailAddress } from "@deskohub/test-email";
import type { AuthSessionState } from "../auth/auth-session-state";
import type { AnalyticsIdentity } from "./identity";

/**
 * The analytics identity for the app's session: pending while the stored
 * session is restored, the account once signed in (test recipients marked as
 * the site marks them), anonymous once signed out.
 */
export const analyticsIdentityOf = (
  session: AuthSessionState
): AnalyticsIdentity => {
  switch (session.status) {
    case "restoring":
      return { kind: "pending" };
    case "signed-out":
      return { kind: "anonymous" };
    case "signed-in":
      return {
        kind: "authenticated",
        accountId: session.user.id,
        testAccount: isTestEmailAddress(session.user.email),
      };
  }
};
