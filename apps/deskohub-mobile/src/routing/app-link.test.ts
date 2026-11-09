import { describe, expect, test } from "bun:test";
import { appLinkRoute } from "./app-link";

describe("appLinkRoute", () => {
  test("routes a sign-in App Link to the callback route with its query", () => {
    expect(
      appLinkRoute(
        "https://workspace.deskohub.cz/app/auth/callback?token=synthetic-token"
      )
    ).toBe("/auth/callback?token=synthetic-token");
  });

  test("routes the web app's root to the app's root", () => {
    expect(appLinkRoute("https://workspace.deskohub.cz/app")).toBe("/");
    expect(appLinkRoute("https://workspace.deskohub.cz/app/")).toBe("/");
  });

  test("keeps a hash", () => {
    expect(appLinkRoute("https://workspace.deskohub.cz/app/sign-in#top")).toBe(
      "/sign-in#top"
    );
  });

  test("leaves the app's own scheme and development links alone", () => {
    for (const path of [
      "deskohub://auth/callback?code=c&state=s",
      "exp+deskohub-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
      "/auth/callback?token=synthetic-token",
    ]) {
      expect(appLinkRoute(path)).toBe(path);
    }
  });

  test("leaves https links outside the web app's base path alone", () => {
    for (const path of [
      "https://workspace.deskohub.cz/",
      "https://workspace.deskohub.cz/application",
      "https://workspace.deskohub.cz/cs/app/auth/callback",
    ]) {
      expect(appLinkRoute(path)).toBe(path);
    }
  });

  test("leaves an unparseable value alone", () => {
    expect(appLinkRoute("not a url")).toBe("not a url");
  });
});
