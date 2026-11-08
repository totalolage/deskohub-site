import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { screenPathPattern } from "../analytics/screen-path";
import { appLinkRoute } from "./app-link";

const appDir = join(import.meta.dir, "../../app");

/** Every route file under app/, as segments relative to it, without the extension. */
const routeFiles = () =>
  readdirSync(appDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) =>
      relative(appDir, join(entry.parentPath, entry.name))
        .replace(/\.tsx?$/, "")
        .split(sep)
    );

/** Screens, without layouts and Expo Router's `+` files such as `+native-intent`. */
const screens = () =>
  routeFiles().filter(
    (segments) =>
      segments.at(-1) !== "_layout" && !segments.at(-1)?.startsWith("+")
  );

/** Whether a link's path names a screen, matching dynamic segments to any one segment. */
const resolves = (link: string) => {
  const route = appLinkRoute(link).replace(/^deskohub:\/\//, "/");
  const path = route.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
  return screens()
    .map(screenPathPattern)
    .some((pattern) =>
      new RegExp(`^${pattern.replace(/\[[^\]/]+\]/g, "[^/]+")}$`).test(path)
    );
};

const layouts = () =>
  routeFiles()
    .filter((segments) => segments.at(-1) === "_layout")
    .map((segments) => segments.slice(0, -1).join("/"));

describe("app route tree", () => {
  test("groups keep every screen's URL", () => {
    const urls = screens().map(screenPathPattern).sort();
    expect(urls).toEqual(
      [
        "/",
        "/account",
        "/account-deleted",
        "/account/assistants",
        "/account/billing",
        "/account/complete",
        "/account/danger",
        "/account/legal",
        "/account/profile",
        "/account/referrals",
        "/account/security",
        "/auth/callback",
        "/dev/effect-smoke",
        "/reservations",
        "/reservations/[orderId]",
        "/reservations/[orderId]/access",
        "/sign-in",
      ].sort()
    );
  });

  test("the signed-in group and the tabs each have a layout file", () => {
    expect(layouts()).toContain("(account)");
    expect(layouts()).toContain("(account)/(tabs)");
  });

  test("only the tab stacks sit inside the tabs", () => {
    // A hidden tab (`href: null`) that gains focus is redirected to the
    // initial tab, so screens outside the tab bar, such as booking, belong
    // to the signed-in stack beside `(tabs)`.
    const tabs = readdirSync(join(appDir, "(account)", "(tabs)"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(tabs).toEqual(["account", "reservations"]);
  });

  test("app and web link paths match a screen's route pattern", () => {
    for (const link of [
      "deskohub://reservations/synthetic-order?after=payment",
      "deskohub://account/legal",
      "https://workspace.deskohub.cz/app/reservations/synthetic-order?after=payment",
      "https://workspace.deskohub.cz/app/account/legal",
      "/reservations/synthetic-order/access",
    ]) {
      expect({ link, resolves: resolves(link) }).toEqual({
        link,
        resolves: true,
      });
    }
    expect(resolves("deskohub://no-such-screen")).toBe(false);
  });
});
