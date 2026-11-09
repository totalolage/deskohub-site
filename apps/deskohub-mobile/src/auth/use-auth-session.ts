import { authClient } from "./auth-client";
import {
  type AuthSessionState,
  toAuthSessionState,
} from "./auth-session-state";

/**
 * The session the app runs under: on native the cookie the Expo client keeps
 * in SecureStore (restored on launch), on web the site's own cookie.
 */
export const useAuthSession = (): AuthSessionState =>
  toAuthSessionState(authClient.useSession());
