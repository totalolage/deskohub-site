import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  accountSectionHref,
  accountSectionOrder,
} from "../account/account-gating";
import { screenPathPattern } from "../analytics/screen-path";
import {
  bookCheckoutHref,
  bookFamilyHref,
  paymentStatusHref,
  reservationsHref,
} from "../booking/booking-routes";
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
        "/account/language",
        "/account/legal",
        "/account/profile",
        "/account/referrals",
        "/account/security",
        "/auth/callback",
        "/book",
        "/book/checkout",
        "/book/cowork",
        "/book/meeting-room",
        "/book/office",
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
      "https://workspace.deskohub.cz/app/account",
      "/reservations/synthetic-order/access",
    ]) {
      expect({ link, resolves: resolves(link) }).toEqual({
        link,
        resolves: true,
      });
    }
    expect(resolves("deskohub://no-such-screen")).toBe(false);
  });

  test("booking's links name a screen", () => {
    for (const href of [
      "/book",
      bookFamilyHref("cowork"),
      bookFamilyHref("meeting-room"),
      bookFamilyHref("office", "quote_expired"),
      bookCheckoutHref,
      reservationsHref,
      paymentStatusHref("synthetic-order"),
    ]) {
      expect({ href, resolves: resolves(href) }).toEqual({
        href,
        resolves: true,
      });
    }
  });

  test("every Account section links to a screen", () => {
    for (const section of accountSectionOrder) {
      const href = accountSectionHref[section];
      expect({ section, resolves: resolves(href) }).toEqual({
        section,
        resolves: true,
      });
    }
  });
});
