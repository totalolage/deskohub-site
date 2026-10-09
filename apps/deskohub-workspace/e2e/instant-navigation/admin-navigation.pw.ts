import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { countCsvRecords } from "@/shared/utils";
import { resolveInstantNavigationAdminCredentials } from "../admin-basic-auth";
import { enablePreviewAccess, requireBaseUrl } from "./navigation-test-helpers";
import { evaluateReservationExportRowCount } from "./reservation-export-row-count";

const remoteBaseUrl = process.env.WORKSPACE_E2E_BASE_URL;
// Fail closed at collection time when a remote preview is targeted without the
// runner-owned admin Basic auth pair; local runs keep the synthetic pair.
const adminCredentials = resolveInstantNavigationAdminCredentials({
  adminBasicAuthPair: process.env.WORKSPACE_E2E_ADMIN_BASIC_AUTH,
  localCredentials: workspaceTestAdminCredentials,
  remoteBaseUrl: remoteBaseUrl !== undefined,
});

test.use({
  httpCredentials: {
    ...adminCredentials,
    ...(remoteBaseUrl === undefined
      ? {}
      : { origin: new URL(remoteBaseUrl).origin }),
    send: "always",
  },
});

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("serves the administration shell and granular loading regions", async ({
  baseURL,
  page,
}, testInfo) => {
  await instant(
    page,
    async () => {
      await page.goto("/admin/reservations");

      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible();
      await expect(page.getByLabel("Loading reservation count")).toBeVisible();
      await expect(page.getByLabel("Loading table filters")).toBeVisible();
      await expect(page.getByLabel("Loading reservations")).toBeVisible();

      const skeleton = page.locator('[data-slot="skeleton"]').first();
      await expect(skeleton).toBeVisible();
      expect(
        await skeleton.evaluate(
          (element) => getComputedStyle(element, "::after").animationName
        )
      ).toBe("skeleton-glimmer");

      await page.locator("nextjs-portal").evaluateAll((portals) => {
        for (const portal of portals) {
          (portal as HTMLElement).style.display = "none";
        }
      });
      const screenshotPath = "e2e-artifacts/admin-reservations-loading.png";
      await page.screenshot({ fullPage: true, path: screenshotPath });
      await testInfo.attach("admin-reservations-loading", {
        contentType: "image/png",
        path: screenshotPath,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await skeleton.evaluate(
          (element) => getComputedStyle(element, "::after").display
        )
      ).toBe("none");
      await page.close();
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

test("captures the resolved reservations export view", async ({
  page,
}, testInfo) => {
  await page.goto("/admin/reservations");

  const toolbar = page.getByRole("region", {
    name: "reservation table controls",
  });
  const exportLink = toolbar.getByRole("link", { name: "Export CSV" });
  await expect(toolbar).toBeVisible();
  await expect(exportLink).toBeVisible();
  await expect(toolbar.locator("#reservation-status")).toBeVisible();
  await expect(toolbar.locator("#reservation-type")).toBeVisible();
  await expect(toolbar.locator("#reservation-date-from")).toBeVisible();
  await expect(toolbar.locator("#reservation-date-to")).toBeVisible();
  await expect(
    toolbar.getByRole("navigation", { name: "Reservation date shortcuts" })
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Apply filters" })
  ).toBeVisible();

  const reservations = page.getByRole("table", { name: "Reservations" });
  const emptyState = page.getByText("No reservations match this view.", {
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await reservations.isVisible()) || (await emptyState.isVisible())
    )
    .toBe(true);

  // The table is inside an overflow wrapper within its outer responsive frame.
  const tableBoundary = reservations.locator("xpath=../..");
  const resultBoundary = (await reservations.isVisible())
    ? tableBoundary
    : emptyState;
  await expect(resultBoundary).toBeVisible();

  await page.locator("nextjs-portal").evaluateAll((portals) => {
    for (const portal of portals) {
      (portal as HTMLElement).style.display = "none";
    }
  });

  const viewportSize = page.viewportSize();
  const toolbarBounds = await toolbar.boundingBox();
  const exportBounds = await exportLink.boundingBox();
  const resultBounds = await resultBoundary.boundingBox();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  if (
    viewportSize === null ||
    toolbarBounds === null ||
    exportBounds === null ||
    resultBounds === null
  ) {
    throw new Error("Could not determine safe reservations screenshot bounds");
  }

  const toolbarBottom = toolbarBounds.y + toolbarBounds.height;
  const exportBottom = exportBounds.y + exportBounds.height;
  const resultClearance = 8;
  const clipHeight = Math.floor(resultBounds.y - resultClearance);
  expect(exportBounds.y).toBeGreaterThanOrEqual(toolbarBounds.y);
  expect(exportBottom).toBeLessThanOrEqual(toolbarBottom);
  expect(resultBounds.y - clipHeight).toBeGreaterThanOrEqual(resultClearance);
  expect(clipHeight).toBeGreaterThan(toolbarBottom);
  expect(clipHeight).toBeLessThanOrEqual(viewportSize.height);

  const screenshotPath =
    "e2e-artifacts/reservation-links/admin-reservations-export.png";
  await page.screenshot({
    clip: { height: clipHeight, width: viewportSize.width, x: 0, y: 0 },
    path: screenshotPath,
  });
  await testInfo.attach("admin-reservations-export", {
    contentType: "image/png",
    path: screenshotPath,
  });
});

/**
 * The export header row is emitted by the module-private
 * `reservationExportHeader` in
 * `features/administration/reservation-export.server.ts`, which is marked
 * `server-only` and therefore cannot be imported by this browser test. Keep
 * this copy aligned with that constant; there is no shared export to import.
 */
const reservationExportHeader =
  "Reservation ID,Booking date,Status,Customer,Reservation type,Created,Payment";

test("downloads the reservations export as CSV", async ({ page, context }) => {
  await page.goto("/admin/reservations");

  const toolbar = page.getByRole("region", {
    name: "reservation table controls",
  });
  const exportLink = toolbar.getByRole("link", { name: "Export CSV" });
  await expect(exportLink).toBeVisible();

  const countBadge = toolbar.getByLabel(/^\d+ reservations?$/);
  await expect(countBadge).toBeVisible();
  const countLabelBefore = await countBadge.getAttribute("aria-label");
  expect(countLabelBefore).toMatch(/^\d+ reservations?$/);
  // The export covers every match for the applied filters, so the rendered
  // total is the expected data-row count while the shared preview data is
  // stable. Mutating projects may run in parallel; the count is re-read after
  // the download so the parity verdict can bracket legitimate movement.
  const countBefore = Number.parseInt(countLabelBefore ?? "", 10);
  expect(Number.isInteger(countBefore)).toBe(true);
  expect(countBefore).toBeGreaterThanOrEqual(0);

  // Chromium download responses are not surfaced as page "response" events and
  // the Download API (Playwright 1.61) exposes no request/response objects, so
  // status and headers are asserted with a same-context API request that
  // reuses the exact export href and shares the browser context's cookie jar
  // and httpCredentials. The native click stays the download trigger.
  const exportHref = await exportLink.getAttribute("href");
  expect(exportHref === null, "export link href must be set").toBe(false);
  if (exportHref === null) {
    throw new Error("export link href must be set");
  }
  const exportUrl = new URL(exportHref, page.url());
  expect(
    exportUrl.pathname.endsWith("/admin/reservations/export.csv"),
    "export href must target the reservations export route"
  ).toBe(true);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportLink.click(),
  ]);
  // Compare the parsed pathname as a boolean with a fixed diagnostic: the
  // download URL carries the filter query string, and no URL may echo into
  // failure output.
  expect(
    new URL(download.url()).pathname === "/admin/reservations/export.csv",
    "download must target the reservations export route"
  ).toBe(true);
  const downloadFailure = await download.failure();
  expect(
    downloadFailure === null,
    "export download failed before completion"
  ).toBe(true);

  const exportResponse = await context.request.get(exportUrl.toString());
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["content-type"]).toBe(
    "text/csv; charset=utf-8"
  );
  expect(exportResponse.headers()["content-disposition"]).toBe(
    'attachment; filename="reservations-export.csv"'
  );
  expect(exportResponse.headers()["cache-control"]).toBe("private, no-store");
  await exportResponse.dispose();
  expect(download.suggestedFilename()).toBe("reservations-export.csv");

  // Read the CSV body in memory only; the body carries customer data and must
  // never be logged, attached, or persisted as an artifact.
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const csvText = Buffer.concat(chunks).toString("utf-8");

  const lines = csvText.split("\r\n");
  // Compare as a boolean with a fixed diagnostic so a failure message can
  // never echo CSV body content, which carries customer data.
  expect(
    lines[0] === reservationExportHeader,
    "CSV header must match the approved columns"
  ).toBe(true);
  // Quoted fields may embed CRLF, so count logical RFC 4180 records instead
  // of physical lines; the header is the first record.
  const dataRowCount = countCsvRecords(csvText) - 1;

  // Re-read the count with a plain read-only navigation; the download click
  // above stayed native. The verdict is exact parity when the count is stable
  // and an inclusive two-count bracket when shared preview data moved; a
  // result outside the bracket is failed evidence, with no slack.
  await page.goto("/admin/reservations");
  const refreshedBadge = page
    .getByRole("region", { name: "reservation table controls" })
    .getByLabel(/^\d+ reservations?$/);
  await expect(refreshedBadge).toBeVisible();
  const countLabelAfter = await refreshedBadge.getAttribute("aria-label");
  expect(countLabelAfter).toMatch(/^\d+ reservations?$/);
  const countAfter = Number.parseInt(countLabelAfter ?? "", 10);
  expect(Number.isInteger(countAfter)).toBe(true);
  expect(countAfter).toBeGreaterThanOrEqual(0);

  const verdict = evaluateReservationExportRowCount({
    countBefore,
    countAfter,
    dataRowCount,
  });
  // Counts are plain numbers and safe to print; no CSV content can appear.
  const verdictMessage = `reservation export row count verdict: ${
    verdict.ok ? verdict.evidence : verdict.reason
  } (countBefore=${countBefore}, countAfter=${countAfter}, dataRowCount=${dataRowCount})`;
  expect(verdict.ok, verdictMessage).toBe(true);

  await download.delete();
});

test("captures the customer activity section after hydration", async ({
  page,
}, testInfo) => {
  await page.goto("/admin");

  const customerActivity = page.getByRole("region", {
    name: "Customer activity",
  });
  await expect(customerActivity.getByText("Unique customers")).toBeVisible();
  await expect(customerActivity.getByText("New customers")).toBeVisible();

  const screenshotPath =
    "e2e-artifacts/account-review/admin-overview-customer-activity.png";
  await page.screenshot({ fullPage: true, path: screenshotPath });
  await testInfo.attach("admin-overview-customer-activity", {
    contentType: "image/png",
    path: screenshotPath,
  });
  await page.close();
});
