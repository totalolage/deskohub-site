import { Context, Layer } from "effect";
import * as WebBrowser from "expo-web-browser";
import { AppState, type AppStateStatus, Linking, Platform } from "react-native";
import {
  type TrustedWebActivity,
  trustedWebActivity,
} from "../../modules/trusted-web-activity";

interface Subscription {
  readonly remove: () => void;
}

/** How an Android auth session opens its Custom Tab. */
export interface CustomTabOptions {
  readonly browserPackage: string;
  readonly createTask: boolean;
}

/** What opening a sign-in page needs from the device. */
interface IAuthSessionDevice {
  readonly platform: string;
  readonly trustedWebActivity: TrustedWebActivity;
  /** The Android browsers that can show a Custom Tab. */
  readonly findCustomTabsBrowsers: () => Promise<WebBrowser.WebBrowserCustomTabsResults>;
  /**
   * Expo's auth session: Safari's sheet on iOS, a Custom Tab on Android.
   */
  readonly openAuthSession: (
    url: string,
    returnUri: string,
    options: CustomTabOptions | undefined
  ) => Promise<WebBrowser.WebBrowserAuthSessionResult>;
  /** Links the app receives while it runs. */
  readonly onUrl: (listener: (url: string) => void) => Subscription;
  readonly onAppStateChange: (
    listener: (state: AppStateStatus) => void
  ) => Subscription;
}

export class AuthSessionDevice extends Context.Service<
  AuthSessionDevice,
  IAuthSessionDevice
>()("deskohub-mobile/AuthSessionDevice") {
  // Built when provided, so the platform is read then, not at import.
  static Live = Layer.sync(this, () => ({
    platform: Platform.OS,
    trustedWebActivity,
    findCustomTabsBrowsers: () =>
      WebBrowser.getCustomTabsSupportingBrowsersAsync(),
    openAuthSession: (url, returnUri, options) =>
      WebBrowser.openAuthSessionAsync(url, returnUri, options),
    onUrl: (listener) =>
      Linking.addEventListener("url", ({ url }) => listener(url)),
    onAppStateChange: (listener) =>
      AppState.addEventListener("change", listener),
  }));
}
