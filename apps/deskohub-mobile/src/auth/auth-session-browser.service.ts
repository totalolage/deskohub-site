import { brandColors } from "@deskohub/brand-tokens";
import { Context, Data, Deferred, Effect, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { AppState, type AppStateStatus, Linking, Platform } from "react-native";
import {
  type TrustedWebActivity,
  type TrustedWebActivityProvider,
  trustedWebActivity,
} from "../../modules/trusted-web-activity";
import { chooseSignInBrowser } from "./sign-in-browser-choice";

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

interface Subscription {
  readonly remove: () => void;
}

/** What opening a sign-in page needs from the device. */
export interface AuthSessionDevice {
  readonly platform: string;
  readonly trustedWebActivity: TrustedWebActivity;
  /** Expo's auth session: Safari's sheet on iOS, a Custom Tab on Android. */
  readonly openAuthSession: (
    url: string,
    returnUri: string
  ) => Promise<WebBrowser.WebBrowserAuthSessionResult>;
  /** Links the app receives while it runs. */
  readonly onUrl: (listener: (url: string) => void) => Subscription;
  readonly onAppStateChange: (
    listener: (state: AppStateStatus) => void
  ) => Subscription;
}

// The brand navy, so the browser's bars match the app around them.
const signInBarColors = {
  toolbar: brandColors.navyBlue,
  navigationBar: brandColors.navyBlue,
};

/**
 * Opens sign-in pages on `device`: in a Trusted Web Activity where Android
 * has a browser for one, else in Expo's auth session.
 */
export const makeOpenAuthSession = (
  device: AuthSessionDevice
): IAuthSessionBrowser["open"] => {
  let trustedWebActivityOpen = false;

  const claimTrustedWebActivity = Effect.acquireRelease(
    Effect.suspend(() => {
      if (trustedWebActivityOpen) {
        return Effect.fail(
          new AuthSessionUnavailable({
            cause: new Error("A sign-in page is already open"),
          })
        );
      }
      trustedWebActivityOpen = true;
      return Effect.void;
    }),
    () =>
      Effect.tryPromise(() => device.trustedWebActivity.release()).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            trustedWebActivityOpen = false;
          })
        )
      )
  );

  // Like Expo's Android auth session: the page returns with a link to
  // `returnUri`, or the customer comes back to the app without one.
  const awaitReturn = (returnUri: string) =>
    Effect.gen(function* () {
      const outcome = yield* Deferred.make<AuthSessionResult>();
      let leftApp = false;
      yield* Effect.acquireRelease(
        Effect.sync(() => [
          device.onUrl((url) => {
            if (url.startsWith(returnUri)) {
              Deferred.doneUnsafe(
                outcome,
                Effect.succeed(AuthSessionResult.Returned({ url }))
              );
            }
          }),
          device.onAppStateChange((state) => {
            if (state !== "active") leftApp = true;
            else if (leftApp) {
              Deferred.doneUnsafe(
                outcome,
                Effect.succeed(AuthSessionResult.Closed())
              );
            }
          }),
        ]),
        (subscriptions) =>
          Effect.sync(() => {
            for (const subscription of subscriptions) subscription.remove();
          })
      );
      return outcome;
    });

  const openTrustedWebActivity = (
    url: string,
    returnUri: string,
    provider: TrustedWebActivityProvider
  ) =>
    Effect.gen(function* () {
      yield* claimTrustedWebActivity;
      // Listening before the launch, so no return goes unseen.
      const outcome = yield* awaitReturn(returnUri);
      yield* Effect.tryPromise({
        try: () =>
          device.trustedWebActivity.launch(url, provider, signInBarColors),
        catch: (cause) => new AuthSessionUnavailable({ cause }),
      });
      return yield* Deferred.await(outcome);
    }).pipe(Effect.scoped);

  const openAuthSession = (url: string, returnUri: string) =>
    Effect.tryPromise({
      try: () => device.openAuthSession(url, returnUri),
      catch: (cause) => new AuthSessionUnavailable({ cause }),
    }).pipe(
      Effect.map((result) =>
        result.type === "success"
          ? AuthSessionResult.Returned({ url: result.url })
          : AuthSessionResult.Closed()
      )
    );

  return (url, returnUri) =>
    Effect.suspend(() => {
      const browser = chooseSignInBrowser({
        platform: device.platform,
        findProvider: device.trustedWebActivity.findProvider,
      });
      return browser._tag === "TrustedWebActivity"
        ? openTrustedWebActivity(url, returnUri, browser.provider)
        : openAuthSession(url, returnUri);
    });
};

export class AuthSessionBrowser extends Context.Service<
  AuthSessionBrowser,
  IAuthSessionBrowser
>()("deskohub-mobile/AuthSessionBrowser") {
  static Live = Layer.succeed(this, {
    open: makeOpenAuthSession({
      platform: Platform.OS,
      trustedWebActivity,
      openAuthSession: (url, returnUri) =>
        Platform.OS === "android"
          ? WebBrowser.openAuthSessionAsync(url, returnUri, {
              toolbarColor: brandColors.navyBlue,
            })
          : WebBrowser.openAuthSessionAsync(url, returnUri),
      onUrl: (listener) =>
        Linking.addEventListener("url", ({ url }) => listener(url)),
      onAppStateChange: (listener) =>
        AppState.addEventListener("change", listener),
    }),
    // Only iOS can close its auth sheet; Expo throws on Android. Closing is a
    // courtesy, so a failure is ignored.
    dismiss: Effect.when(
      Effect.try(() => WebBrowser.dismissAuthSession()).pipe(Effect.ignore),
      Effect.sync(() => Platform.OS === "ios")
    ).pipe(Effect.asVoid),
  });
}
