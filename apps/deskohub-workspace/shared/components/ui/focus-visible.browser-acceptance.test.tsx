import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { Button } from "./button";
import { ChoiceCard } from "./choice-card";
import { DisclosureButton } from "./disclosure-button";
import { NavItem } from "./nav-item";
import { SegmentedControl } from "./segmented-control";
import { UnstyledButton } from "./unstyled-button";

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

// Tab order: each control's keyboard stop, in document order.
const controls = [
  "Button",
  "Button tile",
  "Button link",
  "NavItem",
  "DisclosureButton",
  "UnstyledButton",
  "SegmentedControl",
  "ChoiceCard",
] as const;

const markup = renderToStaticMarkup(
  <main className="flex flex-col items-start gap-6 p-8">
    <span className="text-burned-orange" data-ring-reference>
      reference
    </span>
    <Button>Button</Button>
    <Button variant="tile">Button tile</Button>
    <Button asChild variant="secondary">
      <a href="#link">Button link</a>
    </Button>
    <NavItem>NavItem</NavItem>
    <DisclosureButton expanded={false}>DisclosureButton</DisclosureButton>
    <UnstyledButton>UnstyledButton</UnstyledButton>
    <SegmentedControl
      label="SegmentedControl"
      name="mode"
      onValueChange={() => undefined}
      options={[
        { label: "Existing", value: "existing" },
        { label: "New", value: "new" },
      ]}
      value="existing"
    />
    <ChoiceCard>
      <input aria-label="ChoiceCard" type="checkbox" />
      ChoiceCard
    </ChoiceCard>
  </main>
);

test.skipIf(!chromiumAvailable)(
  "keyboard focus shows the burned-orange ring on Button and each primitive",
  async () => {
    if (!browser) throw new Error("The focus browser has not been launched.");
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${markup}</body></html>`
      );
      await page.addStyleTag({
        content: `${appStyles}*{transition:none!important}`,
      });

      const readRing = () =>
        page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return undefined;
          // Radio and checkbox cards draw the ring on their label.
          const target =
            active instanceof HTMLInputElement
              ? (active.closest("label") ?? active)
              : active;
          const style = getComputedStyle(target);
          const focused = {
            boxShadow: style.boxShadow,
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
          };
          // Blurring keeps the Tab position, so the next press moves on.
          active.blur();
          const idle = getComputedStyle(target);
          const reference = document.querySelector("[data-ring-reference]");
          return {
            boxShadow: focused.boxShadow,
            idleBoxShadow: idle.boxShadow,
            idleOutlineStyle: idle.outlineStyle,
            name:
              active.getAttribute("aria-label") ??
              target.closest("fieldset")?.querySelector("legend")
                ?.textContent ??
              active.textContent?.trim(),
            outlineColor: focused.outlineColor,
            outlineStyle: focused.outlineStyle,
            ringColor: reference ? getComputedStyle(reference).color : "",
          };
        });

      for (const control of controls) {
        await page.keyboard.press("Tab");
        const ring = await readRing();

        expect(ring?.name).toBe(control);
        const showsRing =
          ring !== undefined &&
          ((ring.boxShadow !== ring.idleBoxShadow &&
            ring.boxShadow.includes(ring.ringColor)) ||
            (ring.outlineStyle !== ring.idleOutlineStyle &&
              ring.outlineColor === ring.ringColor));
        expect({ control, showsRing }).toEqual({ control, showsRing: true });
      }
    } finally {
      await page.close();
    }
  }
);
