import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { buildMobileApiUrl } from "@/src/api/mobile-api-url";
import type { Locale } from "@/src/domain/shop";

const sessionKey = "deskohub.workspace.neon-session-cookie";
const verifierKey = "deskohub.workspace.auth-pkce-verifier";
const sessionCookiePrefix = "__Secure-neon-auth.session_token=";

const toBase64Url = (value: string) =>
  value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const hasUnsafeCookieCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127 || character === ";" || character === ",";
  });

const getScheme = () => {
  const extra = (Constants.expoConfig?.extra ?? {}) as { scheme?: string };
  const scheme = extra.scheme?.trim();
  if (!scheme)
    throw new Error("The Android authentication scheme is unavailable");
  return scheme;
};

export const getNativeSessionCookie = async () =>
  Platform.OS === "web" ? null : SecureStore.getItemAsync(sessionKey);

export const clearNativeSession = async () => {
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(sessionKey);
};

export async function prepareSignInHandoff(baseUrl: string, locale: Locale) {
  const localePath = locale === "cs" ? "cs-CZ" : "en-US";
  if (Platform.OS === "web") {
    const url = buildMobileApiUrl(baseUrl, `/${localePath}/auth/sign-in`);
    url.searchParams.set("redirectTo", "/");
    return { url: url.toString() };
  }

  const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replaceAll(
    "-",
    ""
  );
  const challenge = toBase64Url(
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      {
        encoding: Crypto.CryptoEncoding.BASE64,
      }
    )
  );
  const scheme = getScheme();
  const callbackUrl = `${scheme}://auth/callback`;
  const handoff = buildMobileApiUrl(baseUrl, "/api/v1/mobile-auth/handoff");
  handoff.searchParams.set("challenge", challenge);
  handoff.searchParams.set("scheme", scheme);
  const signIn = buildMobileApiUrl(baseUrl, `/${localePath}/auth/sign-in`);
  signIn.searchParams.set("redirectTo", `${handoff.pathname}${handoff.search}`);
  await SecureStore.setItemAsync(verifierKey, verifier);
  return { url: signIn.toString(), callbackUrl };
}

export async function exchangeSignInHandoff(
  baseUrl: string,
  callbackUrl: string
) {
  if (Platform.OS === "web") return;
  const code = new URL(callbackUrl).searchParams.get("code");
  const verifier = await SecureStore.getItemAsync(verifierKey);
  if (!code || !verifier)
    throw new Error("The authentication handoff is incomplete");

  const response = await fetch(
    buildMobileApiUrl(baseUrl, "/api/v1/mobile-auth/handoff"),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code, verifier }),
    }
  );
  const body = (await response.json()) as {
    ok?: boolean;
    data?: { sessionCookie?: unknown };
  };
  const sessionCookie = body.data?.sessionCookie;
  const validatedSessionCookie =
    typeof sessionCookie === "string" &&
    sessionCookie.startsWith(sessionCookiePrefix)
      ? sessionCookie
      : null;
  const sessionToken = validatedSessionCookie?.slice(
    sessionCookiePrefix.length
  );
  if (
    !response.ok ||
    body.ok !== true ||
    !validatedSessionCookie ||
    !sessionToken ||
    hasUnsafeCookieCharacter(sessionToken)
  ) {
    throw new Error("The authentication handoff was rejected");
  }
  await SecureStore.setItemAsync(sessionKey, validatedSessionCookie);
  await SecureStore.deleteItemAsync(verifierKey);
}
