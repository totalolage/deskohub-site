import { Option } from "effect";
import {
  type NativeHandoffRequest,
  restoreNativeHandoffRequest,
  serializeNativeHandoffRequest,
} from "./native-handoff-request";

/**
 * The native request kept in this browser's `localStorage`, so the tab the
 * sign-in email opens can still hand the session to the app. Storage that is
 * missing or refuses access reads as no request.
 */
const storageKey = "deskohub.native-handoff-request";

const readStoredRequest = Option.liftThrowable(() =>
  globalThis.localStorage.getItem(storageKey)
);

const writeStoredRequest = Option.liftThrowable((value: string) =>
  globalThis.localStorage.setItem(storageKey, value)
);

const removeStoredRequest = Option.liftThrowable(() =>
  globalThis.localStorage.removeItem(storageKey)
);

export const loadNativeHandoffRequest = (
  now: number
): Option.Option<NativeHandoffRequest> =>
  readStoredRequest().pipe(
    Option.flatMap((raw) => restoreNativeHandoffRequest(raw, now))
  );

export const saveNativeHandoffRequest = (
  request: NativeHandoffRequest,
  now: number
): void => {
  writeStoredRequest(serializeNativeHandoffRequest(request, now));
};

export const clearNativeHandoffRequest = (): void => {
  removeStoredRequest();
};
