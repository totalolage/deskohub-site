import { brandColors } from "@deskohub/brand-tokens";
import { Context, Data, Deferred, Effect, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import type { TrustedWebActivityProvider } from "../../modules/trusted-web-activity";
import {
  AuthSessionDevice,
  type CustomTabOptions,
} from "./auth-session-device.service";
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

/**
 * Opens sign-in pages in a Trusted Web Activity where Android has a browser
 * for one, else in Expo's auth session, which on Android needs a named
 * Custom Tabs browser.
 */
export class AuthSessionBrowser extends Context.Service<
  AuthSessionBrowser,
  IAuthSessionBrowser
>()("deskohub-mobile/AuthSessionBrowser") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const device = yield* AuthSessionDevice;
      const trustedWebActivity = makeTrustedWebActivitySessions(device);
      return {
        open: (url, returnUri) =>
          Effect.suspend(() => {
            const browser = chooseSignInBrowser({
              platform: device.platform,
              findProvider: device.trustedWebActivity.findProvider,
            });
            return browser._tag === "TrustedWebActivity"
              ? trustedWebActivity.open(url, returnUri, browser.provider)
              : openAuthSession(device, url, returnUri);
          }),
        // Only iOS can close its auth sheet; Expo throws on Android. Closing
        // is a courtesy, so a failure is ignored.
        dismiss: Effect.when(
          Effect.try(() => WebBrowser.dismissAuthSession()).pipe(Effect.ignore),
          Effect.sync(() => Platform.OS === "ios")
        ).pipe(Effect.asVoid),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(AuthSessionDevice.Live));
}

// The brand navy, so the browser's bars match the app around them.
const signInBarColors = {
  toolbar: brandColors.navyBlue,
  navigationBar: brandColors.navyBlue,
};

/**
 * How long the browser may take to show the page. Android Browser Helper
 * reports nothing when its browser connection drops before the launch.
 */
const launchTimeout = "10 seconds";

const makeTrustedWebActivitySessions = (
  device: AuthSessionDevice["Service"]
) => {
  let sessionOpen = false;

  // One page at a time; ending a session drops its browser connection.
  const claimSession = Effect.acquireRelease(
    Effect.suspend(() => {
      if (sessionOpen) {
        return Effect.fail(
          new AuthSessionUnavailable({
            cause: new Error("A sign-in page is already open"),
          })
        );
      }
      sessionOpen = true;
      return Effect.void;
    }),
    () =>
      Effect.tryPromise(() => device.trustedWebActivity.release()).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            sessionOpen = false;
          })
        )
      )
  );

  const listen = (subscribe: () => { readonly remove: () => void }) =>
    Effect.acquireRelease(Effect.sync(subscribe), (subscription) =>
      Effect.sync(() => subscription.remove())
    );

  // Like Expo's Android auth session: the page returns with a link to
  // `returnUri`, or the customer comes back to the app without one.
  const awaitReturn = (returnUri: string) =>
    Effect.gen(function* () {
      const outcome = yield* Deferred.make<AuthSessionResult>();
      yield* listen(() =>
        device.onUrl((url) => {
          if (url.startsWith(returnUri)) {
            Deferred.doneUnsafe(
              outcome,
              Effect.succeed(AuthSessionResult.Returned({ url }))
            );
          }
        })
      );
      let leftApp = false;
      yield* listen(() =>
        device.onAppStateChange((state) => {
          if (state !== "active") leftApp = true;
          else if (leftApp) {
            Deferred.doneUnsafe(
              outcome,
              Effect.succeed(AuthSessionResult.Closed())
            );
          }
        })
      );
      return outcome;
    });

  const open = (
    url: string,
    returnUri: string,
    provider: TrustedWebActivityProvider
  ) =>
    Effect.gen(function* () {
      yield* claimSession;
      // Listening before the launch, so no return goes unseen.
      const outcome = yield* awaitReturn(returnUri);
      yield* Effect.tryPromise({
        try: () =>
          device.trustedWebActivity.launch(url, provider, signInBarColors),
        catch: (cause) => new AuthSessionUnavailable({ cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: launchTimeout,
          orElse: () =>
            Effect.fail(
              new AuthSessionUnavailable({
                cause: new Error("The browser didn't open the sign-in page"),
              })
            ),
        })
      );
      return yield* Deferred.await(outcome);
    }).pipe(Effect.scoped);

  return { open };
};

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

const customTabsBrowser = (
  device: AuthSessionDevice["Service"]
): Effect.Effect<string | undefined, AuthSessionUnavailable> =>
  device.platform === "android"
    ? Effect.tryPromise({
        try: () => device.findCustomTabsBrowsers(),
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
    : Effect.succeed(undefined);

/**
 * The Custom Tab opens in the app's own task, like the Trusted Web Activity,
 * so the return link to the app closes it and every sign-in opens a new page.
 * Expo's default opens it in a task of its own, which outlives the attempt:
 * the next sign-in brings that task back with the previous page, whose state
 * the app then refuses.
 */
const customTabOptions = (browserPackage: string): CustomTabOptions => ({
  browserPackage,
  createTask: false,
});

const openAuthSession = (
  device: AuthSessionDevice["Service"],
  url: string,
  returnUri: string
) =>
  customTabsBrowser(device).pipe(
    Effect.flatMap((browserPackage) =>
      Effect.tryPromise({
        try: () =>
          device.openAuthSession(
            url,
            returnUri,
            browserPackage === undefined
              ? undefined
              : customTabOptions(browserPackage)
          ),
        catch: (cause) => new AuthSessionUnavailable({ cause }),
      })
    ),
    Effect.map((result) =>
      result.type === "success"
        ? AuthSessionResult.Returned({ url: result.url })
        : AuthSessionResult.Closed()
    )
  );
