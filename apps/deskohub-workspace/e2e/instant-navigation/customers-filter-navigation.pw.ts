import "@/shared/testing/workspace-test-environment";

import { expect, type Page, test } from "@playwright/test";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { resolveInstantNavigationAdminCredentials } from "../admin-basic-auth";
import {
  countDistinctCustomers,
  deleteSyntheticData,
  noJavaScriptCustomerIds,
  seedCustomers,
  softNavigationCustomerIds,
} from "./customers-filter-navigation.test-utils";
import { customersFilterNavigationEligibility } from "./customers-filter-navigation-eligibility";

// The delayed-response soft-navigation lifecycle can only be proven against a
// locally controlled server and a disposable database. Eligibility and the
// explicit disposable URL are decided before any connection is attempted, and
// the connection (which runs migrations) happens in the setup hook below, not
// at module import.
const eligibility = customersFilterNavigationEligibility();

test.skip(eligibility.skip, eligibility.reason);

let postgres: WorkspacePostgresTestDatabase | undefined;

test.beforeAll(async () => {
  if (eligibility.skip) return;
  const connected = await connectWorkspacePostgresTestDatabase();
  if (!connected) {
    throw new Error(
      "WORKSPACE_TEST_DATABASE_URL is configured but the disposable Postgres test database did not connect."
    );
  }
  postgres = connected;
});

test.afterAll(async () => {
  if (postgres) {
    await postgres.close();
    postgres = undefined;
  }
});

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
    // Both the toolbar count badge (a div role="status") and the table-local
    // overlay (a p role="status") show the pending label; assert them
    // independently so either one alone cannot satisfy the lifecycle.
    const pendingStatuses = page
      .getByRole("status")
      .filter({ hasText: "Loading customers" });
    const toolbarPendingCount = page
      .locator(
        "section[aria-label='customer table controls'] div[role='status']"
      )
      .filter({ hasText: "Loading customers" });
    const tablePendingStatus = page
      .locator("p[role='status']")
      .filter({ hasText: "Loading customers" });
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
      await expect(toolbarPendingCount).toBeVisible({ timeout: 5_000 });
      // The toolbar's old numeric count is gone while the pending badge shows.
      await expect(page.getByLabel(`${allTotal} customers`)).toHaveCount(0);
      await expect(tablePendingStatus).toBeVisible({ timeout: 8_000 });

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
      await expect(pendingStatuses).toHaveCount(0);
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
      // The soft navigation completed without a full document reload: the
      // pre-navigation probe marker survived releaseAll().
      expect(
        await page.getAttribute("html", "data-soft-navigation-probe")
      ).toBe("same-document");

      // A new filter submission resets pagination to the first page.
      await page.goto("/admin/customers?page=2&sort=activity&direction=asc");
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-withdrawn"]')
          .first()
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.dataset.softNavigationProbe = "same-document";
      });
      await page.locator("#customer-consent").selectOption("granted");
      armGate();
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(toolbarPendingCount).toBeVisible();
      await expect(tablePendingStatus).toBeVisible();
      releaseAll();
      await expect(pendingStatuses).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("page")).toBeNull();
      await expect(page.getByLabel(`${grantedTotal} customers`)).toBeVisible();
      await expect(
        page.locator('a[href="/admin/customers/e2e-soft-customer-01"]').first()
      ).toBeVisible();
      expect(
        await page.getAttribute("html", "data-soft-navigation-probe")
      ).toBe("same-document");

      // Browser Back restores the previous unfiltered view.
      await page.goBack();
      await expect(page).toHaveURL(/page=2&sort=activity&direction=asc/);
      await expect(page.getByLabel(`${allTotal} customers`)).toBeVisible();
      await expect(
        page
          .locator('a[href="/admin/customers/e2e-soft-customer-withdrawn"]')
          .first()
      ).toBeVisible();
      expect(
        await page.getAttribute("html", "data-soft-navigation-probe")
      ).toBe("same-document");
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
      expect(initial?.status()).toBe(200);
      // React swaps streamed Suspense content into place with inline scripts,
      // which never run with JavaScript disabled, so the server-rendered
      // controls stay inside hidden placeholders. Revealing them here is a
      // side-effect-free preparation step; the submission itself below is
      // issued by the browser natively.
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("[hidden]")) {
          element.removeAttribute("hidden");
        }
      });
      const initialHtml = await initial!.text();
      // The consent filter must remain a plain HTML GET form: without
      // JavaScript the browser itself builds and issues this submission.
      expect(initialHtml).toContain('method="get"');
      expect(initialHtml).toContain('name="consent"');
      // The hidden controls must serialize the form's actual defaults
      // (activity/desc), because the browser sends exactly these values.
      expect(initialHtml).toContain('name="sort"');
      expect(initialHtml).toContain('name="direction"');
      expect(initialHtml).toContain('value="activity"');
      expect(initialHtml).toContain('value="desc"');

      // Submit the form natively: select the consent option and click
      // "Apply filters" so the browser itself builds and issues the GET.
      await page.locator("#customer-consent").selectOption("granted");
      const [submitted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "GET" &&
            new URL(response.url()).pathname === "/admin/customers"
        ),
        page.getByRole("button", { name: "Apply filters" }).click(),
      ]);
      expect(submitted?.status()).toBe(200);
      const submittedUrl = new URL(submitted!.url());
      expect(submittedUrl.pathname).toBe("/admin/customers");
      expect(submittedUrl.searchParams.get("consent")).toBe("granted");
      expect(submittedUrl.searchParams.get("sort")).toBe("activity");
      expect(submittedUrl.searchParams.get("direction")).toBe("desc");
      // A new filter submission resets pagination: no page parameter.
      expect(submittedUrl.searchParams.get("page")).toBeNull();
      await expect(page).toHaveURL(
        /consent=granted&sort=activity&direction=desc/
      );
      const html = await submitted!.text();
      // Server-rendered results reflect the filter even though the streamed
      // Suspense fallbacks cannot be swapped in without JavaScript.
      expect(html).toContain(
        'href="/admin/customers/e2e-nojs-customer-granted-1"'
      );
      expect(html).toContain(
        'href="/admin/customers/e2e-nojs-customer-granted-2"'
      );
      expect(html).not.toContain("e2e-nojs-customer-withdrawn");
      expect(html).not.toContain("e2e-nojs-customer-never");
      expect(html).toContain(`${grantedTotal} customers`);
      expect(html).toContain('value="granted" selected');
    } finally {
      await context.close();
      await deleteSyntheticData(store, noJavaScriptCustomerIds);
    }
  });
});
