import { Layer, ManagedRuntime } from "effect";
import * as Passkeys from "react-native-passkeys";
import { authClient } from "../auth-client.native";
import { NativePasskeyModule } from "./native-passkey-module.service";
import { PasskeyAuthClient } from "./passkey-auth-client.service";
import { PasskeyCeremonies } from "./passkey-ceremony";

/**
 * The passkey ceremonies on Android and iOS: `react-native-passkeys` against
 * the Workspace's passkey endpoints, through the Expo auth client. One
 * runtime, so every passkey control shares the one-ceremony-at-a-time gate.
 */
export const passkeyRuntime = ManagedRuntime.make(
  PasskeyCeremonies.Native.pipe(
    Layer.provide(
      Layer.mergeAll(
        PasskeyAuthClient.fromClient(authClient),
        NativePasskeyModule.fromModule(Passkeys)
      )
    )
  )
);
