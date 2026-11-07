import { authClient } from "../auth-client.web";
import { makeWebPasskeyCeremonies } from "./web-passkey-ceremonies";

/**
 * The web bundle's passkey ceremonies, through Better Auth's browser passkey
 * client. Its sign-in refreshes the session itself.
 */
export const passkeyCeremonies = makeWebPasskeyCeremonies({
  isSupported: () => typeof globalThis.PublicKeyCredential === "function",
  signIn: () => authClient.signIn.passkey(),
  addPasskey: ({ name }) => authClient.passkey.addPasskey({ name }),
});
