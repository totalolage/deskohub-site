import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Locator } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "@/features/account/contracts";
import { getAccountSectionPath } from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import { getWorkspaceMeetingRoomProductTitle } from "@/features/checkout/product-catalog.i18n";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { ReservationHistory } from "./reservation-history";
import { AccountShell } from "./shell/account-shell";

const locale = "en-US" as const;
const copy = getAccountScreenCopy(locale);
const productTitle = getWorkspaceMeetingRoomProductTitle(locale);

const reservation = (
  overrides: Partial<CustomerReservationSummary>
): CustomerReservationSummary => ({
  id: "synthetic-reservation",
  product: { kind: "meeting-room" },
  startsAt: "2026-09-18T12:00:00Z",
  endsAt: "2026-09-18T14:00:00Z",
  seats: 2,
  status: "confirmed",
  ...overrides,
});

const history = {
  kind: "available",
  groups: {
    current: [reservation({ id: "synthetic-current" })],
    past: [
      reservation({
        id: "synthetic-past",
        startsAt: "2026-08-21T08:00:00Z",
        endsAt: "2026-08-21T10:00:00Z",
      }),
    ],
    unavailable: [],
  },
} satisfies CustomerReservationHistory;

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const renderReservationsScreen = () =>
  renderToStaticMarkup(
    createElement(
      AccountShell,
      {
        activeSection: "reservations",
        labels: copy.shell,
        onSectionChange: () => undefined,
        sectionHref: (section: AccountSection) =>
          getAccountSectionPath(locale, section),
        signOut: null,
        title: m.accountTitle({}, { locale }),
      },
      createElement(ReservationHistory, {
        copy: copy.reservations,
        history,
        locale,
      })
    )
  );

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("The element is not rendered.");
  return { ...rect, bottom: rect.y + rect.height, right: rect.x + rect.width };
};

// `shellWidth` narrows the whole account shell while the viewport stays wide,
// so only the content container, not the viewport, gets narrower.
const readFeaturedCardLayout = async ({
  shellWidth,
  viewportWidth,
}: {
  readonly shellWidth?: number;
  readonly viewportWidth: number;
}) => {
  if (!browser)
    throw new Error("The ReservationHistory browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { height: 1000, width: viewportWidth },
  });
  try {
    const shellStyle = shellWidth ? ` style="width:${shellWidth}px"` : "";
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div${shellStyle}>${renderReservationsScreen()}</div></body></html>`
    );
    await page.addStyleTag({ content: appStyles });

    const contentWidth = await page.evaluate(
      () =>
        document
          .querySelector("aside")
          ?.nextElementSibling?.getBoundingClientRect().width ?? 0
    );
    const assignedDeskLabel = page.getByText(copy.reservations.assignedDesk, {
      exact: true,
    });
    const product = await box(
      page.getByRole("heading", { level: 3, name: productTitle }).locator("..")
    );
    const validity = await box(
      page.getByText(copy.reservations.validity, { exact: true }).locator("..")
    );
    const desk = await box(assignedDeskLabel.locator("../.."));
    const assignedDeskLineHeight = await assignedDeskLabel.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).lineHeight)
    );
    const pastTableHeaderVisible = await page
      .getByRole("columnheader", { name: copy.reservations.date })
      .isVisible();

    return {
      assignedDeskHeight: (await box(assignedDeskLabel)).height,
      assignedDeskLineHeight,
      contentWidth,
      desk,
      pastTableHeaderVisible,
      product,
      validity,
    };
  } finally {
    await page.close();
  }
};

const expectStackedFeaturedCard = (
  layout: Awaited<ReturnType<typeof readFeaturedCardLayout>>
) => {
  expect(layout.validity.y).toBeGreaterThanOrEqual(layout.product.bottom);
  expect(layout.desk.y).toBeGreaterThanOrEqual(layout.validity.bottom);
  expect(layout.assignedDeskHeight).toBeLessThan(
    layout.assignedDeskLineHeight * 1.5
  );
  expect(layout.pastTableHeaderVisible).toBe(false);
};

test.skipIf(!chromiumAvailable)(
  "stacks the featured reservation blocks in a medium content area beside the sidebar",
  async () => {
    const layout = await readFeaturedCardLayout({ viewportWidth: 1040 });

    expect(layout.contentWidth).toBeLessThan(896);
    expectStackedFeaturedCard(layout);
  }
);

test.skipIf(!chromiumAvailable)(
  "places the featured reservation blocks in one row in a wide content area",
  async () => {
    const layout = await readFeaturedCardLayout({ viewportWidth: 1440 });

    expect(layout.contentWidth).toBeGreaterThanOrEqual(896);
    expect(layout.validity.x).toBeGreaterThanOrEqual(layout.product.right);
    expect(layout.desk.x).toBeGreaterThanOrEqual(layout.validity.right);
    expect(layout.validity.y).toBeLessThan(layout.product.bottom);
    expect(layout.desk.y).toBeLessThan(layout.validity.bottom);
    expect(layout.assignedDeskHeight).toBeLessThan(
      layout.assignedDeskLineHeight * 1.5
    );
    expect(layout.pastTableHeaderVisible).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "stacks the featured reservation blocks when a wide viewport has a narrow content area",
  async () => {
    const layout = await readFeaturedCardLayout({
      shellWidth: 940,
      viewportWidth: 1440,
    });

    expect(layout.contentWidth).toBeLessThanOrEqual(600);
    expectStackedFeaturedCard(layout);
  }
);
