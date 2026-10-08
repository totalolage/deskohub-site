import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceDir } from "../runtime";

export const workspaceE2EReferralCheckoutReviewTargets = [
  "account-referral-invitation-applied",
  "account-referral-with-ordinary-code",
  "account-referral-with-voucher",
] as const;

export type WorkspaceE2EReferralCheckoutReviewTarget =
  (typeof workspaceE2EReferralCheckoutReviewTargets)[number];

export const getWorkspaceE2EReferralCheckoutReviewArtifactPath = (
  target: WorkspaceE2EReferralCheckoutReviewTarget
) => resolve(workspaceDir, "e2e-artifacts", "account-review", `${target}.png`);

export const isOwnedReferralCheckoutReviewUrl = ({
  actualUrl,
  baseUrl,
  expectedUrl,
  orderId,
}: {
  readonly actualUrl: string;
  readonly baseUrl: string;
  readonly expectedUrl: string;
  readonly orderId: WorkspaceReservationId;
}) => {
  try {
    const actual = new URL(actualUrl);
    const expected = new URL(expectedUrl);
    const base = new URL(baseUrl);
    const payState = actual.searchParams.getAll("payState");
    const orderIds = actual.searchParams.getAll("orderId");
    return (
      actual.href === expected.href &&
      actual.origin === base.origin &&
      actual.pathname === "/en-US/checkout/pay" &&
      payState.length === 1 &&
      Boolean(payState[0]) &&
      orderIds.length === 1 &&
      orderIds[0] === orderId &&
      !actual.searchParams.has("ref") &&
      !actual.searchParams.has("submittedCode")
    );
  } catch {
    return false;
  }
};

export const captureReferralCheckoutReview = async ({
  baseUrl,
  expectedPayUrl,
  orderId,
  page,
  target,
}: {
  readonly baseUrl: string;
  readonly expectedPayUrl: string;
  readonly orderId: WorkspaceReservationId;
  readonly page: Page;
  readonly target: WorkspaceE2EReferralCheckoutReviewTarget;
}) => {
  assertOwnedUrl(page.url(), baseUrl, expectedPayUrl, orderId);
  const originalViewport = page.viewportSize();
  try {
    const artifactPath =
      getWorkspaceE2EReferralCheckoutReviewArtifactPath(target);
    await mkdir(dirname(artifactPath), { recursive: true });
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page
      .locator("[data-checkout-discount-details]")
      .waitFor({ state: "visible" });
    const png = await page.screenshot({
      animations: "disabled",
      fullPage: true,
      mask: [page.locator("input, [data-ph-mask]")],
      type: "png",
    });
    assertOwnedUrl(page.url(), baseUrl, expectedPayUrl, orderId);
    await writeFile(artifactPath, png);
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
};

const assertOwnedUrl = (
  actualUrl: string,
  baseUrl: string,
  expectedUrl: string,
  orderId: WorkspaceReservationId
) => {
  if (
    !isOwnedReferralCheckoutReviewUrl({
      actualUrl,
      baseUrl,
      expectedUrl,
      orderId,
    })
  ) {
    throw new Error("checkout review is outside its owned signed pay state");
  }
};
