import { router, usePathname } from "expo-router";
import { useCallback, useState } from "react";
import { type AuthUser, safeReturnPath } from "./auth-session-state";
import {
  type NativeSignInFailure,
  NotSignedIn,
  SignInUnavailable,
} from "./native-sign-in-errors";
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

const idle: AuthTaskState<AuthUser, NativeSignInFailure> = {
  status: "idle",
};

/**
 * Web reauthentication goes through the sign-in page with `prompt=login`,
 * which signs in again even with a browser session and then returns to the
 * current route, where the customer repeats the action. The route is stored
 * with the account, so the email's link returns there from any tab. Signing in to another
 * account there is refused, as on native.
 */
export const useReauthentication = (): Reauthentication => {
  const pathname = usePathname();
  const session = useAuthSession();
  const [state, setState] =
    useState<AuthTaskState<AuthUser, NativeSignInFailure>>(idle);
  const userId = session.status === "signed-in" ? session.user.id : undefined;
  const reauthenticate =
    useCallback(async (): Promise<ReauthenticationOutcome> => {
      // Without a stored account the sign-in page couldn't refuse a switch to
      // another one, so a browser that refuses storage doesn't start.
      if (
        userId === undefined ||
        !saveReauthenticatingUser(
          { userId, returnPath: safeReturnPath(pathname) },
          Date.now()
        )
      ) {
        setState({
          status: "failed",
          failure:
            userId === undefined
              ? new NotSignedIn()
              : new SignInUnavailable({}),
        });
        return "failed";
      }
      setState(idle);
      router.push({
        pathname: "/sign-in",
        params: { prompt: "login", return_to: pathname },
      });
      return "redirected";
    }, [pathname, userId]);
  return { state, reauthenticate };
};
