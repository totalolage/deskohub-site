import { Context, Data, Effect, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { type PreviewAccess, withPreviewAccessCookie } from "./preview-access";

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

export class AuthSessionBrowser extends Context.Service<
  AuthSessionBrowser,
  IAuthSessionBrowser
>()("deskohub-mobile/AuthSessionBrowser") {
  /**
   * The system auth session. A development build with preview access opens
   * each session with the bypass that sets Vercel's preview cookie.
   */
  static layer = (previewAccess?: PreviewAccess) =>
    Layer.succeed(this, {
      open: (url, returnUri) =>
        Effect.tryPromise({
          try: () =>
            WebBrowser.openAuthSessionAsync(
              withPreviewAccessCookie(url, previewAccess),
              returnUri
            ),
          catch: (cause) => new AuthSessionUnavailable({ cause }),
        }).pipe(
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

  static Live = this.layer();
}
