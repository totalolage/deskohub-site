import { Data } from "effect";
import type { TrustedWebActivityProvider } from "../../modules/trusted-web-activity";

/**
 * Where the sign-in page opens: a Trusted Web Activity, which shows the page
 * like part of the app, or the platform auth session (Safari's sheet on iOS,
 * a Custom Tab on Android).
 */
export type SignInBrowser = Data.TaggedEnum<{
  TrustedWebActivity: { readonly provider: TrustedWebActivityProvider };
  AuthSession: Record<never, never>;
}>;
export const SignInBrowser = Data.taggedEnum<SignInBrowser>();

/**
 * Opens a Trusted Web Activity only on Android with a browser that supports
 * one. `findProvider` runs only on Android; if it fails, sign-in still opens
 * in the auth session.
 */
export const chooseSignInBrowser = ({
  platform,
  findProvider,
}: {
  readonly platform: string;
  readonly findProvider: () => TrustedWebActivityProvider | null;
}): SignInBrowser => {
  if (platform !== "android") return SignInBrowser.AuthSession();
  let provider: TrustedWebActivityProvider | null;
  try {
    provider = findProvider();
  } catch {
    return SignInBrowser.AuthSession();
  }
  return provider?.launchMode === "trusted-web-activity"
    ? SignInBrowser.TrustedWebActivity({ provider })
    : SignInBrowser.AuthSession();
};
