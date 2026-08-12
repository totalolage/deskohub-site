import { type BrowserContext, expect, type Page } from "@playwright/test";

export async function enablePreviewAccess(
  context: BrowserContext,
  baseURL: string | undefined
) {
  const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!previewBypassSecret) return;

  const response = await context.request.get(
    new URL("/favicon.svg", requireBaseUrl(baseURL)).toString(),
    {
      headers: {
        "x-vercel-protection-bypass": previewBypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    }
  );
  expect(response.ok()).toBe(true);
  await response.dispose();
}

export async function expectPublicSiteShell(page: Page) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" })
  ).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
}

export async function hasLoadedResource(page: Page, pathname: string) {
  return page.evaluate((targetPathname) => {
    return performance.getEntriesByType("resource").some((entry) => {
      try {
        return (
          new URL(entry.name, window.location.href).pathname === targetPathname
        );
      } catch {
        return false;
      }
    });
  }, pathname);
}

export function requireBaseUrl(baseURL: string | undefined) {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for instant navigation");
  }

  return baseURL;
}
