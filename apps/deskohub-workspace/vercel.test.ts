import { expect, test } from "bun:test";
import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { locales } from "@/features/i18n/routing";
import { publicPages } from "@/features/public-pages/public-pages";
import vercelConfig from "./vercel.json";

// Vercel serves prerendered pages with the cached response's own `Vary`, so the
// proxy cannot add `Accept` there. A Vercel route transform appends it to every
// public page, which answers with Markdown when `Accept` prefers it.
const varyOnAcceptRoute = vercelConfig.routes.find(({ transforms }) =>
  transforms.some(
    ({ type, op, target, args }) =>
      type === "response.headers" &&
      op === "append" &&
      target.key.toLowerCase() === "vary" &&
      args === "Accept"
  )
);

const variesOnAccept = (pathname: string) =>
  new RegExp(varyOnAcceptRoute?.src ?? "(?!)").test(pathname);

test("varies every localized public page on Accept", () => {
  for (const locale of locales) {
    for (const { pathname } of publicPages) {
      expect(variesOnAccept(prefixPathnameWithLocale(pathname, locale))).toBe(
        true
      );
    }
  }
});

test("leaves other paths out of the Accept variation", () => {
  for (const pathname of [
    "/",
    "/en-US/",
    "/en-US/account",
    "/cs-CZ/reservation/status",
    "/en-US/faq/extra",
    "/de-DE/faq",
    "/page-markdown/en-US/faq",
    "/api/cron/workspace/reservation-holds",
  ]) {
    expect(variesOnAccept(pathname)).toBe(false);
  }
});
