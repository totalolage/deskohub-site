import { mock } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { createContext, useContext } from "react";

/**
 * Bun can't load React Native or Expo's native modules, so tests get small
 * stand-ins for the parts the auth code touches: the platform, the app
 * scheme, and crypto backed by Node's.
 */
mock.module("react-native", () => ({
  // Host components stand in as their names, so a test can read the element
  // tree a component returns without a native renderer.
  ActivityIndicator: "ActivityIndicator",
  Modal: "Modal",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    absoluteFill: {},
    create: <Styles>(styles: Styles) => styles,
    hairlineWidth: 1,
  },
  AccessibilityInfo: { announceForAccessibility: () => undefined },
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
  getCustomTabsSupportingBrowsersAsync: async () => ({
    browserPackages: [],
    servicePackages: [],
  }),
  // Like Expo on Android, where a Custom Tab can't be closed.
  dismissAuthSession: () => {
    throw new Error("WebBrowser.dismissAuthSession is unavailable");
  },
}));
