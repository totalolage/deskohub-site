import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { screenPathPattern } from "../analytics/screen-path";

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

const screens = () =>
  routeFiles().filter((segments) => segments.at(-1) !== "_layout");

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

  test("the signed-in group is a stack over the tabs", () => {
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
});
