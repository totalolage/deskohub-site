import { Context, Data, Effect, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";

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
  static Live = Layer.succeed(this, {
    open: (url, returnUri) =>
      Effect.tryPromise({
        try: () => WebBrowser.openAuthSessionAsync(url, returnUri),
        catch: (cause) => new AuthSessionUnavailable({ cause }),
      }).pipe(
        Effect.map((result) =>
          result.type === "success"
            ? AuthSessionResult.Returned({ url: result.url })
            : AuthSessionResult.Closed()
        )
      ),
    dismiss: Effect.sync(() => WebBrowser.dismissAuthSession()),
  });
}
