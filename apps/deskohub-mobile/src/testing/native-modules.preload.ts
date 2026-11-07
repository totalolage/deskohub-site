import { mock } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

/**
 * Bun can't load React Native or Expo's native modules, so tests get small
 * stand-ins for the parts the auth code touches: the platform, the app
 * scheme, and crypto backed by Node's.
 */
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
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
