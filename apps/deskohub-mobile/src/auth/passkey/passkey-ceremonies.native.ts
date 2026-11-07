import * as Passkeys from "react-native-passkeys";
import { authClient } from "../auth-client.native";
import { makeNativePasskeyCeremonies } from "./native-passkey-ceremonies";

/**
 * The app's passkey ceremonies on Android and iOS: `react-native-passkeys`
 * against the Workspace's passkey endpoints, through the Expo auth client.
 */
export const passkeyCeremonies = makeNativePasskeyCeremonies({
  fetch: (path, { method, body, signal }) =>
    authClient.$fetch(path, { method, body, signal, throw: false }),
  authenticator: {
    isSupported: Passkeys.isSupported,
    create: (options) => Passkeys.create(options),
    get: (options) => Passkeys.get(options),
  },
  refreshSession: () => authClient.$store.notify("$sessionSignal"),
});
