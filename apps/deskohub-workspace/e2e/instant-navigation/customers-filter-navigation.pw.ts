import "@/shared/testing/workspace-test-environment";

import { expect, type Page, test } from "@playwright/test";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { resolveInstantNavigationAdminCredentials } from "../admin-basic-auth";
import {
  countDistinctCustomers,
  customersFilterNavigationPostgres,
  deleteSyntheticData,
  noJavaScriptCustomerIds,
  seedCustomers,
  softNavigationCustomerIds,
} from "./customers-filter-navigation.test-utils";

// The delayed-response soft-navigation lifecycle can only be proven against a
// locally controlled server and a disposable database. Remote preview runs keep
// the existing instant-navigation coverage.
const remoteBaseUrl = process.env.WORKSPACE_E2E_BASE_URL;
const postgres = customersFilterNavigationPostgres;

test.skip(
  remoteBaseUrl !== undefined || postgres === null,
  "requires a local server and the disposable Postgres test database"
);

// Local dev compilation of the administration route can exceed the project's
// production-navigation timeout on a cold server.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.use({
  httpCredentials: {
    ...resolveInstantNavigationAdminCredentials({
      adminBasicAuthPair: undefined,
      localCredentials: workspaceTestAdminCredentials,
      remoteBaseUrl: false,
    }),
    send: "always",
  },
});

test.describe("admin customers filter navigation", () => {
  test("keeps the document alive and obscures stale results while a filter navigation is pending", async ({
    page,
  }) => {
    const store = postgres as WorkspacePostgresTestDatabase;
    const status = page
      .getByRole("status")
      .filter({ hasText: "Loading customers" })
      .first();
    await deleteSyntheticData(store, softNavigationCustomerIds);
    await seedCustomers(store, softNavigationCustomerIds, 26);
    const grantedTotal = await countDistinctCustomers(store, "granted");
    const allTotal = await countDistinctCustomers(store, "all");

    // Each armed gate delays exactly one RSC navigation response so the
    // pending lifecycle can be asserted while the request is in flight. The
    // gate must be released quickly: a stalled RSC fetch is eventually
    // abandoned by the Next.js router.
    const gates: Array<{ promise: Promise<void>; release: () => void }> = [];
    const armGate = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.push({ promise, release });
    };
    const releaseAll = () => {
      while (gates.length > 0) {
        gates.shift()?.release();
      }
    };

    try {
      // Warm the dev compilation of both URLs before the client-side run; a
      // first-hit rebuild otherwise triggers an HMR reload mid-test.
      const warmUrls = [
        "/admin/customers?sort=activity&direction=asc",
        "/admin/customers?page=2&sort=activity&direction=asc",
      ];
      for (const warmUrl of warmUrls) {
        // Drain the streamed body so the cold-compile render fully finishes
        // before the browser navigation starts.
        const warm = await page.request.get(warmUrl);
        await warm.body();
      }

      await page.route("**/admin/customers**", async (route) => {
        if (route.request().headers()["rsc"] === "1") {
          // Peek instead of shifting: releaseAll() drains the queue.
          const gate = gates[0];
          if (gate) await gate.promise;
        }
        try {
          await route.continue();
        } catch {
          // A superseded navigation can invalidate the route before it is
          // continued; the replacement request re-enters this handler.
        }
      });

      await page.goto("/admin/customers?sort=activity&direction=asc");
      // The route announcer mounts once the App Router has hydrated.
      await page.locator("next-route-announcer").waitFor({ state: "attached" });
      await expect(page.getByRole("status")).toHaveCount(0);
      await page.evaluate(() => {
        document.documentElement.dataset.softNavigationProbe = "same-document";
      });
      const staleRow = page
        .locator('a[href="/admin/customers/e2e-soft-customer-05"]')
        .first();

      await page.locator("#customer-consent").selectOption("granted");
      armGate();
      await page.getByRole("button", { name: "Apply filters" }).click();

      // The soft navigation is pending: the RSC response is gated above.
      // The Next.js router abandons RSC fetches held roughly fifteen seconds,
      // so the pending assertions use tight timeouts and release promptly.
      await expect(status).toBeVisible({ timeout: 5_000 });

      // Stale results are occluded and inert rather than removed.
      await expect(page.locator("[aria-busy='true'][inert]")).toBeAttached({
        timeout: 8_000,
      });
      await expect(staleRow).toBeAttached({ timeout: 3_000 });
      expect(
        await staleRow.evaluate((element) =>
          Boolean(element.closest("[inert]"))
        )
      ).toBe(true);

      // The administration chrome stays visible and interactive.
      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible({ timeout: 3_000 });
      await expect(
        page.getByPlaceholder("Search by name or email")
      ).toBeVisible({ timeout: 3_000 });
      await expect(page.locator("#customer-consent")).toBeVisible({
        timeout: 3_000,
      });
      expect(
        await page.getAttribute("html", "data-soft-navigation-probe")
      ).toBe("same-document");

      releaseAll();

      await expect(page).toHaveURL(
        /consent=granted&sort=activity&direction=asc/
      );
      await expect(status).toHaveCount(0);
      await expect(page.getByLabel(`${grantedTotal} customers`)).toBeVisible();
      await expect(staleRow).toBeVisible();
      // Customer 26 is the newest granted customer but sorts onto page 2
      // under the preserved ascending activity sort.
      await expect(
        page.locator('a[href="/admin/customers/e2e-soft-customer-26"]').first()
      ).toHaveCount(0);
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-withdrawn"]')
          .first()
      ).toHaveCount(0);
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-never"]')
          .first()
      ).toHaveCount(0);
      // Ascending activity order is preserved from the pre-filter URL.
      await expect(
        page.locator('a[href="/admin/customers/e2e-soft-customer-01"]').first()
      ).toBeVisible();

      // A new filter submission resets pagination to the first page.
      await page.goto("/admin/customers?page=2&sort=activity&direction=asc");
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-withdrawn"]')
          .first()
      ).toBeVisible();
      await page.locator("#customer-consent").selectOption("granted");
      armGate();
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(status).toBeVisible();
      releaseAll();
      await expect(status).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("page")).toBeNull();
      await expect(page.getByLabel(`${grantedTotal} customers`)).toBeVisible();
      await expect(
        page.locator('a[href="/admin/customers/e2e-soft-customer-01"]').first()
      ).toBeVisible();

      // Browser Back restores the previous unfiltered view.
      await page.goBack();
      await expect(page).toHaveURL(/page=2&sort=activity&direction=asc/);
      await expect(page.getByLabel(`${allTotal} customers`)).toBeVisible();
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-withdrawn"]')
          .first()
      ).toBeVisible();
    } finally {
      releaseAll();
      await page.unroute("**/admin/customers**");
      await deleteSyntheticData(store, softNavigationCustomerIds);
    }
  });

  test("serves the native GET form submission when JavaScript is disabled", async ({
    browser,
  }) => {
    const store = postgres as WorkspacePostgresTestDatabase;
    await deleteSyntheticData(store, noJavaScriptCustomerIds);
    await seedCustomers(store, noJavaScriptCustomerIds, 2);
    const grantedTotal = await countDistinctCustomers(store, "granted");

    const context = await browser.newContext({
      javaScriptEnabled: false,
      httpCredentials: {
        username: workspaceTestAdminCredentials.username,
        password: workspaceTestAdminCredentials.password,
        send: "always",
      },
    });

    try {
      const page: Page = await context.newPage();
      const warm = await page.request.get("/admin/customers");
      await warm.body();
      const initial = await page.goto("/admin/customers");
      const initialHtml = await initial!.text();
      // The consent filter must remain a plain HTML GET form: without
      // JavaScript the browser itself builds and issues this submission.
      expect(initialHtml).toContain('method="get"');
      expect(initialHtml).toContain('name="consent"');
      expect(initialHtml).toContain('name="sort"');
      expect(initialHtml).toContain('name="direction"');

      // The exact document GET a native form submission of the unfiltered
      // form produces (select consent=granted; hidden sort/direction kept).
      const submitted = await page.goto(
        "/admin/customers?consent=granted&sort=activity&direction=asc"
      );
      expect(submitted?.status()).toBe(200);
      await expect(page).toHaveURL(
        /consent=granted&sort=activity&direction=asc/
      );
      const html = await submitted!.text();
      // Server-rendered results reflect the filter even though the streamed
      // Suspense fallbacks cannot be swapped in without JavaScript.
      expect(html).toContain(
        'href="/admin/customers/e2e-nojs-customer-granted-1"'
      );
      expect(html).not.toContain("e2e-nojs-customer-never");
      expect(html).toContain(`${grantedTotal} customers`);
      expect(html).toContain('value="granted" selected');
    } finally {
      await context.close();
      await deleteSyntheticData(store, noJavaScriptCustomerIds);
    }
  });
});
