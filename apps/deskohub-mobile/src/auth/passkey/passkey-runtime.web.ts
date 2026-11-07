import { Layer, ManagedRuntime } from "effect";
import { authClient } from "../auth-client.web";
import { PasskeyCeremonies } from "./passkey-ceremony";
import { PasskeyPluginClient } from "./passkey-plugin-client.service";

/**
 * The web bundle's passkey ceremonies, through Better Auth's browser passkey
 * client, whose sign-in refreshes the session itself. One runtime, so every
 * passkey control shares the one-ceremony-at-a-time gate.
 */
export const passkeyRuntime = ManagedRuntime.make(
  PasskeyCeremonies.Web.pipe(
    Layer.provide(PasskeyPluginClient.fromClient(authClient))
  )
);
