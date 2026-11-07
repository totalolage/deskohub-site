import { router, usePathname } from "expo-router";
import { useCallback } from "react";
import type { AuthUser } from "./auth-session-state";
import type { NativeSignInFailure } from "./native-sign-in-errors";
import type {
  Reauthentication,
  ReauthenticationOutcome,
} from "./reauthentication.native";
import type { AuthTaskState } from "./use-auth-task";

export { isReauthenticationRequired } from "./auth-session-state";
export type {
  Reauthentication,
  ReauthenticationOutcome,
} from "./reauthentication.native";

const idle: AuthTaskState<AuthUser, NativeSignInFailure> = { status: "idle" };

/**
 * Web reauthentication goes through the sign-in page with `prompt=login`,
 * which signs in again even with a browser session and then returns to the
 * current route, where the customer repeats the action.
 */
export const useReauthentication = (): Reauthentication => {
  const pathname = usePathname();
  const reauthenticate =
    useCallback(async (): Promise<ReauthenticationOutcome> => {
      router.push({
        pathname: "/sign-in",
        params: { prompt: "login", return_to: pathname },
      });
      return "redirected";
    }, [pathname]);
  return { state: idle, reauthenticate };
};
