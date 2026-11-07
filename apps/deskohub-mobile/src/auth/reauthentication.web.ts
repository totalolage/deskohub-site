import { router, usePathname } from "expo-router";
import { useCallback } from "react";
import type { AuthUser } from "./auth-session-state";
import type { NativeSignInFailure } from "./native-sign-in-errors";
import type {
  Reauthentication,
  ReauthenticationOutcome,
} from "./reauthentication.native";
import { useAuthSession } from "./use-auth-session";
import type { AuthTaskState } from "./use-auth-task";
import { saveReauthenticatingUser } from "./web-reauthentication-store";

export { isReauthenticationRequired } from "./auth-session-state";
export type {
  Reauthentication,
  ReauthenticationOutcome,
} from "./reauthentication.native";

const idle: AuthTaskState<AuthUser, NativeSignInFailure> = { status: "idle" };

/**
 * Web reauthentication goes through the sign-in page with `prompt=login`,
 * which signs in again even with a browser session and then returns to the
 * current route, where the customer repeats the action. Signing in to another
 * account there is refused, as on native.
 */
export const useReauthentication = (): Reauthentication => {
  const pathname = usePathname();
  const session = useAuthSession();
  const userId = session.status === "signed-in" ? session.user.id : undefined;
  const reauthenticate =
    useCallback(async (): Promise<ReauthenticationOutcome> => {
      if (userId !== undefined) saveReauthenticatingUser(userId, Date.now());
      router.push({
        pathname: "/sign-in",
        params: { prompt: "login", return_to: pathname },
      });
      return "redirected";
    }, [pathname, userId]);
  return { state: idle, reauthenticate };
};
