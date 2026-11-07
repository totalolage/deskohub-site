import { brandColors } from "@deskohub/brand-tokens";
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

/** What opening a sign-in page needs from the device. */
interface IAuthSessionDevice {
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

export class AuthSessionDevice extends Context.Service<
  AuthSessionDevice,
  IAuthSessionDevice
>()("deskohub-mobile/AuthSessionDevice") {
  static Live = Layer.succeed(this, {
    platform: Platform.OS,
    trustedWebActivity,
    // The Custom Tab gets the brand navy toolbar; iOS takes no colours.
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
  });
}
