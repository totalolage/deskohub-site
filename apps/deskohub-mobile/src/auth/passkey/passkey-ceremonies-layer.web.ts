import { Layer } from "effect";
import { authClient } from "../auth-client.web";
import { PasskeyCeremonies } from "./passkey-ceremony";
import { PasskeyPluginClient } from "./passkey-plugin-client.service";

/**
 * The web bundle's passkey ceremonies, through Better Auth's browser passkey
 * client, whose sign-in refreshes the session itself.
 */
export const makePasskeyCeremoniesLayer = (): Layer.Layer<PasskeyCeremonies> =>
  PasskeyCeremonies.Web.pipe(
    Layer.provide(PasskeyPluginClient.fromClient(authClient))
  );
