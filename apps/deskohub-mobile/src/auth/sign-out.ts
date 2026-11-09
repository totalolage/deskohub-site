import { authClient } from "./auth-client";
import { signOutOf } from "./sign-out-request";

export { SignOutFailure } from "./sign-out-request";

/**
 * Ends the session; on native the Expo client also clears SecureStore. No
 * sign-in stores a session until the request has settled.
 */
export const signOut = signOutOf(authClient);
