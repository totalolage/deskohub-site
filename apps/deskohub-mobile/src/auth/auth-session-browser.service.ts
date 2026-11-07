import { Context, Data, Effect, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

/**
 * How the in-app auth session ended: it returned to the app with a URL, or
 * it closed without one. Android reports `dismiss` whenever the app comes
 * back to the foreground, even when the callback link is on its way, so
 * `Closed` doesn't mean the customer gave up.
 */
export type AuthSessionResult = Data.TaggedEnum<{
  Returned: { readonly url: string };
  Closed: Record<never, never>;
}>;
export const AuthSessionResult = Data.taggedEnum<AuthSessionResult>();

/** The auth session couldn't open (no browser, or one already open). */
export class AuthSessionUnavailable extends Data.TaggedError(
  "AuthSessionUnavailable"
)<{ readonly cause: unknown }> {}

interface IAuthSessionBrowser {
  readonly open: (
    url: string,
    returnUri: string
  ) => Effect.Effect<AuthSessionResult, AuthSessionUnavailable>;
  /** Closes an open session on iOS; Android can't close a Custom Tab. */
  readonly dismiss: Effect.Effect<void>;
}

/**
 * The Custom Tabs browser to open the auth session in. The app claims its
 * host's /app/ links, sign-in page included, and Android hands an https link
 * without a named package to the app that claims it before any browser, so
 * the sign-in page would open in the app itself. Android without a known
 * Custom Tabs browser therefore can't open the auth session; only Android has
 * Custom Tabs, so other platforms skip the lookup.
 */
export const customTabsBrowserPackage = (
  browsers: WebBrowser.WebBrowserCustomTabsResults
): string | undefined =>
  browsers.preferredBrowserPackage ??
  browsers.defaultBrowserPackage ??
  browsers.browserPackages[0];

const customTabsBrowser: Effect.Effect<
  string | undefined,
  AuthSessionUnavailable
> = Effect.suspend(() =>
  Platform.OS === "android"
    ? Effect.tryPromise({
        try: () => WebBrowser.getCustomTabsSupportingBrowsersAsync(),
        catch: (cause) => new AuthSessionUnavailable({ cause }),
      }).pipe(
        Effect.map(customTabsBrowserPackage),
        Effect.flatMap((browserPackage) =>
          browserPackage === undefined
            ? Effect.fail(
                new AuthSessionUnavailable({
                  cause: "No browser supports Custom Tabs.",
                })
              )
            : Effect.succeed(browserPackage)
        )
      )
    : Effect.succeed(undefined)
);

export class AuthSessionBrowser extends Context.Service<
  AuthSessionBrowser,
  IAuthSessionBrowser
>()("deskohub-mobile/AuthSessionBrowser") {
  static Live = Layer.succeed(this, {
    open: (url, returnUri) =>
      customTabsBrowser.pipe(
        Effect.flatMap((browserPackage) =>
          Effect.tryPromise({
            try: () =>
              WebBrowser.openAuthSessionAsync(
                url,
                returnUri,
                browserPackage === undefined ? undefined : { browserPackage }
              ),
            catch: (cause) => new AuthSessionUnavailable({ cause }),
          })
        ),
        Effect.map((result) =>
          result.type === "success"
            ? AuthSessionResult.Returned({ url: result.url })
            : AuthSessionResult.Closed()
        )
      ),
    // Only iOS can close its auth sheet; Expo throws on Android. Closing is
    // a courtesy, so a failure is ignored.
    dismiss: Effect.when(
      Effect.try(() => WebBrowser.dismissAuthSession()).pipe(Effect.ignore),
      Effect.sync(() => Platform.OS === "ios")
    ).pipe(Effect.asVoid),
  });
}
