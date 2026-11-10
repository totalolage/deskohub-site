import { mock } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { Component, createContext, useContext } from "react";

/**
 * Bun can't load React Native or Expo's native modules, so tests get small
 * stand-ins for the parts the auth code touches: the platform, the app
 * scheme, and crypto backed by Node's.
 */
// React Native's `StyleSheet.flatten`: nested arrays merged left to right,
// falsy entries skipped.
const flattenStyle = (style: unknown): Record<string, unknown> | undefined => {
  if (!style) return undefined;
  if (!Array.isArray(style)) return { ...(style as Record<string, unknown>) };
  return style.reduce<Record<string, unknown>>(
    (merged, entry) => Object.assign(merged, flattenStyle(entry)),
    {}
  );
};

mock.module("react-native", () => ({
  // Host components stand in as their names, so a test can read the element
  // tree a component returns without a native renderer.
  Modal: "Modal",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    absoluteFill: {},
    create: <Styles>(styles: Styles) => styles,
    flatten: flattenStyle,
    hairlineWidth: 1,
  },
  AccessibilityInfo: {
    announceForAccessibility: () => undefined,
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => undefined }),
  },
  Platform: {
    OS: "android",
    select: (options: Record<string, unknown>) =>
      options.android ?? options.native ?? options.default,
  },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

// Insets come from the context, as in the library, so a test can provide some.
const SafeAreaInsetsContext = createContext({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

mock.module("react-native-safe-area-context", () => ({
  SafeAreaInsetsContext,
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => useContext(SafeAreaInsetsContext),
}));

// Lottie's player is a class with commands a component calls through a ref;
// the stand-in keeps them and draws nothing.
class LottieView extends Component<Readonly<Record<string, unknown>>> {
  play() {}
  pause() {}
  resume() {}
  reset() {}
  override render() {
    return null;
  }
}

mock.module("lottie-react-native", () => ({ default: LottieView }));

mock.module("expo-constants", () => ({
  default: { expoConfig: { scheme: "deskohub" } },
}));

mock.module("expo-linking", () => ({
  createURL: (path: string, options?: { readonly scheme?: string }) =>
    `${options?.scheme ?? "deskohub"}://${path.replace(/^\//, "")}`,
}));

mock.module("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  getRandomBytes: (count: number) => new Uint8Array(randomBytes(count)),
  digest: async (_algorithm: string, data: Uint8Array) => {
    const digest = createHash("sha256").update(data).digest();
    return digest.buffer.slice(
      digest.byteOffset,
      digest.byteOffset + digest.byteLength
    );
  },
}));

// Better Auth's Expo online manager loads this when a session atom mounts.
mock.module("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));

mock.module("expo-web-browser", () => ({
  openAuthSessionAsync: async () => ({ type: "cancel" }),
  openBrowserAsync: async () => ({ type: "opened" }),
  getCustomTabsSupportingBrowsersAsync: async () => ({
    browserPackages: [],
    servicePackages: [],
  }),
  // Like Expo on Android, where a Custom Tab can't be closed.
  dismissAuthSession: () => {
    throw new Error("WebBrowser.dismissAuthSession is unavailable");
  },
}));

// The app's consent answer loads from here and reads the device language.
// Tests provide their own consent; these keep its module graph loadable.
mock.module("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
}));

const asyncStorageItems = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorageItems.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorageItems.set(key, value);
    },
    multiRemove: async (keys: readonly string[]) => {
      for (const key of keys) asyncStorageItems.delete(key);
    },
  },
}));
