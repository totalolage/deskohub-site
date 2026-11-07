import { ManagedRuntime } from "effect";
import { PasskeyCeremonies } from "./passkey-ceremony";

/**
 * The app's one passkey runtime, so every passkey control shares the
 * one-ceremony-at-a-time gate.
 */
export const passkeyRuntime = ManagedRuntime.make(PasskeyCeremonies.Live);
