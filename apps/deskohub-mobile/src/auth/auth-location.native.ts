import type { AuthCallback } from "./auth-callback";

/** Native routes receive callbacks as route params; nothing to capture. */
export const prepareAuthLocation = (): void => undefined;

export const capturedAuthCallback = (): AuthCallback => ({ kind: "invalid" });
