/**
 * Captures the discount creation dialogs' date fields in a real Chromium for
 * review evidence: the real dialogs and app styles with the brand font, no
 * database or administrator session. Each state is shot at 390, 768, and
 * 1280 px with its anchor field near the top; the filled code dialog also in
 * Czech. Chromium draws the time fields in its own UI language (English
 * here), whatever the page's locale.
 *
 * Usage (from apps/deskohub-workspace):
 *   bun scripts/discounts-admin-dates/run.ts --out <directory outside the checkout>
 *   bun scripts/discounts-admin-dates/run.ts --out <directory> --state code-filled
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import "@/shared/polyfills/temporal";
import { m } from "@/features/administration/i18n";
import {
  buildDiscountDialogsBrowserPage,
  type DiscountDialog,
  discountDateFields,
  discountDialog,
  enterDate,
  openDiscountDialog,
} from "@/features/discounts/admin/creation-dialogs.browser-page.test-utils";
import { m as customerMessages, type Locale } from "@/features/i18n";

type DateFields = ReturnType<typeof discountDateFields>;

type CaptureState = {
  readonly name: string;
  readonly dialog: DiscountDialog;
  readonly locales: readonly Locale[];
  readonly description: string;
  /** Brings the dialog into the state and returns what to scroll into view. */
  readonly prepare: (
    page: Page,
    fields: DateFields,
    locale: Locale
  ) => Promise<Locator>;
};

const fillWindow = async (fields: DateFields) => {
  await enterDate(fields.validFrom, "2026-12-01");
  await fields.validFromTime.fill("09:30");
  await enterDate(fields.validUntil, "2027-01-31");
  await fields.validUntilTime.fill("18:00");
};

const submit = (page: Page) =>
  discountDialog(page).locator('button[type="submit"]').click();

const states: readonly CaptureState[] = [
  {
    description: "New code dialog before any entry, with Generate code",
    dialog: "code",
    locales: ["en-US"],
    name: "code-empty",
    prepare: async (_page, fields) => fields.validFrom,
  },
  {
    description: "Redemption window and reservation dates filled",
    dialog: "code",
    locales: ["en-US", "cs-CZ"],
    name: "code-filled",
    prepare: async (_page, fields) => {
      await fillWindow(fields);
      await enterDate(fields.serviceDateFrom, "2026-12-01");
      await enterDate(fields.serviceDateUntil, "2026-12-31");
      return fields.validFrom;
    },
  },
  {
    description: "Valid from calendar open",
    dialog: "code",
    locales: ["en-US"],
    name: "code-valid-from-calendar",
    prepare: async (page, fields) => {
      await enterDate(fields.validFrom, "2026-12-01");
      await fields.validFrom.press("ArrowDown");
      await page.locator('[role="dialog"] [role="grid"]').last().waitFor();
      return fields.validFrom;
    },
  },
  {
    description:
      "Valid until calendar opened from its button, which a narrow cell puts on its own row",
    dialog: "code",
    locales: ["en-US", "cs-CZ"],
    name: "code-valid-until-calendar-button",
    prepare: async (page, fields, locale) => {
      await enterDate(fields.validUntil, "2027-01-31");
      await discountDialog(page)
        .getByRole("button", {
          name: customerMessages.dateInputCalendarButtonLabel(
            { field: m.discountsValidUntilLabel({}, { locale }) },
            { locale }
          ),
        })
        .click();
      await page.locator('[role="dialog"] [role="grid"]').last().waitFor();
      return fields.validUntil;
    },
  },
  {
    description: "Valid until with a date and no time, after Save",
    dialog: "code",
    locales: ["en-US"],
    name: "code-incomplete-valid-until",
    prepare: async (page, fields) => {
      await enterDate(fields.validUntil, "2027-01-31");
      await submit(page);
      return fields.validUntil;
    },
  },
  {
    description: "Reservation dates out of order, after Save",
    dialog: "code",
    locales: ["en-US"],
    name: "code-service-dates-error",
    prepare: async (page, fields, locale) => {
      // A code first: the order check runs once every field is valid.
      await discountDialog(page)
        .getByRole("button", { name: m.discountsGenerateCode({}, { locale }) })
        .click();
      await enterDate(fields.serviceDateFrom, "2026-12-31");
      await enterDate(fields.serviceDateUntil, "2026-12-01");
      await submit(page);
      return fields.serviceDateFrom;
    },
  },
  {
    description: "New voucher dialog with the redemption window filled",
    dialog: "voucher",
    locales: ["en-US"],
    name: "voucher-filled",
    prepare: async (_page, fields) => {
      await fillWindow(fields);
      return fields.validFrom;
    },
  },
];

const viewports = [
  { height: 844, width: 390 },
  { height: 1024, width: 768 },
  { height: 900, width: 1280 },
] as const;

const readArgument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const outArgument = readArgument("out");
if (!outArgument) {
  throw new Error("Pass --out <directory> for the screenshots.");
}
const outDirectory = resolve(outArgument);
const onlyState = readArgument("state");
const selectedStates = onlyState
  ? states.filter((state) => state.name === onlyState)
  : states;
if (selectedStates.length === 0) {
  throw new Error(
    `Unknown state ${onlyState}; use one of ${states.map((state) => state.name).join(", ")}.`
  );
}

await mkdir(outDirectory, { recursive: true });
const harness = await buildDiscountDialogsBrowserPage();
const browser = await chromium.launch({ headless: true });
const shots: { file: string; state: string; description: string }[] = [];
try {
  for (const state of selectedStates) {
    for (const locale of state.locales) {
      for (const viewport of viewports) {
        const page = await browser.newPage({
          deviceScaleFactor: 1,
          locale,
          reducedMotion: "reduce",
          viewport,
        });
        const problems: string[] = [];
        page.on("pageerror", (error) => problems.push(error.message));
        try {
          await openDiscountDialog(page, harness, {
            dialog: state.dialog,
            locale,
          });
          const anchor = await state.prepare(
            page,
            discountDateFields(page, locale),
            locale
          );
          // The anchor field's label sits near the top of the shot, so the
          // fields below it show too.
          await anchor.evaluate((element) => {
            element.scrollIntoView({ block: "start" });
            element.closest('[role="dialog"]')?.scrollBy(0, -96);
          });
          if (problems.length > 0) {
            throw new Error(`${state.name}: ${problems.join("; ")}`);
          }
          const file = `${state.name}-${locale}-${viewport.width}.png`;
          await page.screenshot({ path: join(outDirectory, file) });
          shots.push({
            description: state.description,
            file,
            state: state.name,
          });
          process.stdout.write(`${join(outDirectory, file)}\n`);
        } finally {
          await page.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  await harness.dispose();
}
await writeFile(
  join(
    outDirectory,
    onlyState ? `manifest-${onlyState}.json` : "manifest.json"
  ),
  `${JSON.stringify(shots, null, 2)}\n`
);
