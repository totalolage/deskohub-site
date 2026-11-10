import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { paidFulfillmentTopic } from "@/features/checkout/backend/fulfillment/paid-fulfillment-queue.service";
import { reservationHoldCleanupTopic } from "@/features/checkout/backend/holds/reservation-hold-cleanup-queue.service";
import { latePaymentRecoveryTopic } from "@/features/checkout/backend/payment/late-payment-recovery-queue.service";
import { automationUnitTopic } from "@/features/email-campaigns/automation/backend/automation-unit-queue.service";
import { campaignSendTopic } from "@/features/email-campaigns/backend/campaign-send-queue.service";
import { locales } from "@/features/i18n/routing";
import { publicPages } from "@/features/public-pages/public-page-definitions";
import vercelConfig from "./vercel.json";

// Vercel serves prerendered pages with the cached response's own `Vary`, so the
// proxy cannot add `Accept` there. A Vercel route transform appends it to every
// public page, which answers with Markdown when `Accept` prefers it.
const varyOnAcceptRoute = vercelConfig.routes.find(({ transforms }) =>
  transforms?.some(
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

// vercel.json must stay literal, so its locale alternation repeats the
// registry's locales.
test("varies on Accept under exactly the supported locales", () => {
  const localeAlternation =
    varyOnAcceptRoute?.src.match(/^\^\/\(\?:([^)]*)\)/)?.[1];

  expect(localeAlternation?.split("|")).toEqual([...supportedLocales]);
});

test("leaves other paths out of the Accept variation", () => {
  for (const pathname of [
    "/",
    "/en-US/",
    "/en-US/logo",
    "/cs-CZ/logo",
    "/en-US/account",
    "/cs-CZ/reservation/status",
    "/en-US/faq/extra",
    "/fr-FR/faq",
    "/page-markdown/en-US/faq",
    "/api/cron/workspace/reservation-holds",
  ]) {
    expect(variesOnAccept(pathname)).toBe(false);
  }
});

test("lets browsers keep the Temporal polyfill, whose URL carries its hash", () => {
  const polyfillRoute = vercelConfig.routes.find(({ src }) =>
    new RegExp(src).test("/polyfills/temporal.js")
  );

  expect(polyfillRoute?.headers?.["Cache-Control"]).toContain("immutable");
});

test("lets browsers keep the mobile web app's hashed build files, and nothing else under /app/", () => {
  // Vercel anchors a route's `src` at the end, as `normalizeRoutes` does.
  const cachedForever = (pathname: string) =>
    vercelConfig.routes.some(
      ({ src, headers }) =>
        headers?.["Cache-Control"]?.includes("immutable") &&
        new RegExp(src.endsWith("$") ? src : `${src}$`).test(pathname)
    );

  expect(cachedForever("/app/_expo/static/js/web/entry-0123abcd.js")).toBe(
    true
  );
  for (const pathname of [
    "/app/",
    "/app/index.html",
    "/app/sw.js",
    "/app/manifest.webmanifest",
  ]) {
    expect(cachedForever(pathname)).toBe(false);
  }
});

// Vercel reads queue triggers from the literal `vercel.json`, so this ties
// each topic definition to the trigger of its route.
const queueTopics = [
  campaignSendTopic,
  automationUnitTopic,
  paidFulfillmentTopic,
  latePaymentRecoveryTopic,
  reservationHoldCleanupTopic,
].map(({ topic }) => topic);

const queueTriggers = Object.entries(vercelConfig.functions).flatMap(
  ([route, { experimentalTriggers }]) =>
    experimentalTriggers
      .filter(({ type }) => type === "queue/v2beta")
      .map(({ topic }) => ({ route, topic }))
);

test("triggers each queue topic's route, and only those", async () => {
  expect(queueTriggers.map(({ topic }) => topic).toSorted()).toEqual(
    queueTopics.toSorted()
  );

  for (const topic of queueTopics) {
    const route = `app/api/queues/workspace/${topic.replace(/^workspace-/, "")}/route.ts`;
    expect(queueTriggers.filter((trigger) => trigger.topic === topic)).toEqual([
      { route, topic },
    ]);
    expect(await Bun.file(new URL(route, import.meta.url)).exists()).toBe(true);
  }
});
