import type { TrustedWebActivity } from "./src/trusted-web-activity.types";

export type * from "./src/trusted-web-activity.types";

/** Trusted Web Activities exist only on Android (`index.android.ts`). */
export const trustedWebActivity: TrustedWebActivity = {
  findProvider: () => null,
  launch: () =>
    Promise.reject(
      new Error("Trusted Web Activities are only available on Android")
    ),
  release: () => Promise.resolve(),
};
