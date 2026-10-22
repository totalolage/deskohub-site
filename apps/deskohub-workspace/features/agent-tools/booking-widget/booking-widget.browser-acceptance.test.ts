import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type {
  McpUiStyles,
  McpUiTheme,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  type Browser,
  chromium,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Schema } from "effect";
import { type Locale, m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { BookingMode } from "../show-booking.schema";
import {
  availabilityResult,
  bookingOfferings,
  bookingToday,
  quoteResult,
  reservationResult,
  showBookingResult,
} from "./booking-widget.test-utils";
import { buildBookingWidget } from "./build-booking-widget";

// Set to a directory to keep a screenshot of each state the suite reaches.
const screenshotDirectory = process.env.BOOKING_WIDGET_SCREENSHOT_DIRECTORY;

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let widgetHtml = "";
let buildDirectory = "";
let harnessPath = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  widgetHtml = await buildBookingWidget();
  buildDirectory = await mkdtemp(join(tmpdir(), "booking-widget-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "booking-widget.browser-harness.ts")],
    format: "iife",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harnessPath = build.outputs[0]?.path ?? "";
  if (screenshotDirectory)
    await mkdir(screenshotDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

type ToolCall = { readonly name: string; readonly args: Schema.JsonObject };

const toolResult = (
  structuredContent: CallToolResult["structuredContent"],
  isError = false
) => ({
  ...(isError && { isError }),
  content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  structuredContent,
});

type ToolAnswers = Partial<
  Record<string, (args: Schema.JsonObject) => ReturnType<typeof toolResult>>
>;

/** Synthetic host palettes, shaped like a host's style variables. */
const hostStyleVariables = {
  light: {
    "--color-background-primary": "#ffffff",
    "--color-text-primary": "#1f1e1d",
    "--color-text-danger": "#a32222",
    "--color-ring-primary": "#2c64d0",
  },
  dark: {
    "--color-background-primary": "#262624",
    "--color-text-primary": "#f5f4ef",
    "--color-text-danger": "#f28b82",
    "--color-ring-primary": "#7aa7ff",
  },
} satisfies Record<McpUiTheme, Partial<McpUiStyles>>;

const toLocale = (locale: Schema.Json | undefined): Locale =>
  locale === "cs-CZ" ? "cs-CZ" : "en-US";

const defaultAnswers: ToolAnswers = {
  list_offerings: () =>
    toolResult({
      business: {
        name: "DH Workspace",
        address: "Synthetic street 1, Prague",
        opening_hours: "Open 24/7.",
        booking: "Book on the website.",
      },
      advertised_on: bookingToday,
      offerings: bookingOfferings(),
    }),
  check_availability: ({ locale }) =>
    toolResult(availabilityResult(true, toLocale(locale))),
  get_quote: ({ locale }) => toolResult(quoteResult(toLocale(locale))),
  start_reservation: ({ locale }) =>
    toolResult(reservationResult(toLocale(locale))),
};

/**
 * Opens the built view in a host page whose bridge answers `tools/call`
 * with `answers` and records every call and opened link.
 */
const openBookingView = async ({
  mode,
  locale,
  hostLocale = locale as string | null,
  hostTheme,
  hostStyles,
  requestedLocale = locale as Locale | null,
  resultLocale = locale,
  answers = {},
  opensLinks = true,
  chatgptBridge = false,
  chatgptGlobals = {},
  waitForForm = true,
}: {
  readonly mode: BookingMode;
  readonly locale: Locale;
  /** The host context's language; `null` when it sends none. */
  readonly hostLocale?: string | null;
  readonly hostTheme?: McpUiTheme;
  readonly hostStyles?: Partial<McpUiStyles>;
  /** The agent's `locale` argument; `null` when it sends none. */
  readonly requestedLocale?: Locale | null;
  readonly resultLocale?: Locale;
  readonly answers?: ToolAnswers;
  /** Whether the host declares `openLinks`. */
  readonly opensLinks?: boolean;
  /** Whether the view gets ChatGPT's `window.openai` bridge. */
  readonly chatgptBridge?: boolean;
  /** The theme and language ChatGPT's bridge reports. */
  readonly chatgptGlobals?: Pick<
    NonNullable<Window["openai"]>,
    "theme" | "locale"
  >;
  /** Whether to wait until the view shows the booking form. */
  readonly waitForForm?: boolean;
}) => {
  if (!browser) throw new Error("The browser has not been launched.");
  const page = await browser.newPage({
    viewport: { width: 560, height: 900 },
    timezoneId: "Europe/Prague",
  });
  const calls: ToolCall[] = [];
  const linkOpened = Promise.withResolvers<string>();
  await page.exposeFunction(
    "callBookingTool",
    (name: string, args: Schema.JsonObject) => {
      calls.push({ name, args });
      const answer = { ...defaultAnswers, ...answers }[name];
      if (!answer) throw new Error(`Unexpected tool call ${name}`);
      return answer(args);
    }
  );
  await page.exposeFunction("openBookingLink", (url: string) => {
    linkOpened.resolve(url);
  });
  const externalOpened = Promise.withResolvers<Schema.Json>();
  if (chatgptBridge) {
    await page.exposeFunction("openBookingExternal", (options: Schema.Json) => {
      externalOpened.resolve(options);
    });
    // ChatGPT injects its bridge into the view's frame before the view runs.
    await page.addInitScript((globals) => {
      if (window === window.top) return;
      Object.assign(window, {
        openai: { ...globals, openExternal: window.openBookingExternal },
      });
    }, chatgptGlobals);
  }
  const hostBackground =
    hostStyles?.["--color-background-primary"] ??
    (hostTheme === "dark" ? "#212121" : "#ffffff");
  await page.setContent(
    `<!doctype html><html><head><meta charset='utf-8'></head><body style='margin:0; background:${hostBackground}'></body></html>`
  );
  await page.evaluate(
    (harness) => {
      Object.assign(window, { bookingHarness: harness });
    },
    {
      html: widgetHtml,
      host: {
        ...(hostLocale !== null && { locale: hostLocale }),
        ...(hostTheme && { theme: hostTheme }),
        ...(hostStyles && { styleVariables: hostStyles }),
      },
      opensLinks,
      toolArguments: requestedLocale ? { locale: requestedLocale } : {},
      toolResult: toolResult(showBookingResult({ mode, locale: resultLocale })),
    }
  );
  await page.addScriptTag({ path: harnessPath });
  const view = page.frameLocator("iframe");
  if (waitForForm) {
    await view
      .getByRole("heading", { name: m.bookingWidgetTitle({}, { locale }) })
      .waitFor();
  }
  return {
    page,
    view,
    calls,
    linkOpened: linkOpened.promise,
    externalOpened: externalOpened.promise,
  };
};

const capture = async (page: Page, name: string) => {
  if (!screenshotDirectory) return;
  await page.screenshot({
    fullPage: true,
    path: join(screenshotDirectory, `${name}.png`),
  });
};

/** Formats in the page, whose ICU the view's own formatting uses. */
const formatPrice = (page: Page, amount: number, locale: Locale) =>
  page.evaluate(
    ([amount, locale]) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "CZK",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount),
    [amount, locale] as const
  );

const checkAvailability = async (
  view: ReturnType<Page["frameLocator"]>,
  locale: Locale
) => {
  await view
    .getByRole("button", { name: m.bookingWidgetCheck({}, { locale }) })
    .click();
  await view
    .getByRole("status")
    .getByText(m.bookingWidgetAvailable({}, { locale }))
    .waitFor();
};

describe.skipIf(!chromiumAvailable)("booking view", () => {
  for (const locale of ["en-US", "cs-CZ"] as const) {
    test(`reserve mode in ${locale}: quotes, starts the booking, and opens the Pay page`, async () => {
      const { page, view, calls, linkOpened } = await openBookingView({
        mode: "reserve",
        locale,
      });
      try {
        await checkAvailability(view, locale);
        await view
          .getByRole("status")
          .getByText(
            m.bookingWidgetTotal(
              {
                price: await formatPrice(
                  page,
                  quoteResult().total.amount,
                  locale
                ),
              },
              { locale }
            )
          )
          .waitFor();
        expect(calls.map(({ name }) => name)).toEqual([
          "check_availability",
          "get_quote",
        ]);
        expect(calls[0]?.args).toEqual({
          family: "cowork",
          date: bookingToday,
          tier: "open-space",
          locale,
        });
        await capture(page, `reserve-${locale}`);

        await view
          .getByRole("button", { name: m.bookingWidgetReserve({}, { locale }) })
          .click();
        const payLink = view.getByRole("link", {
          name: m.bookingWidgetOpenPaymentPage({}, { locale }),
        });
        await payLink.waitFor();
        expect(calls.at(-1)).toEqual({
          name: "start_reservation",
          args: {
            family: "cowork",
            date: bookingToday,
            tier: "open-space",
            locale,
          },
        });
        const expiresAt = await page.evaluate(
          ([instant, locale]) =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(Date.parse(instant)),
          [reservationResult().pay_url_expires_at, locale] as const
        );
        await view
          .getByRole("status")
          .getByText(m.bookingWidgetHeld({ expiresAt }, { locale }))
          .waitFor();
        await expect(
          view.getByText(reservationResult().pay_url, { exact: true }).count()
        ).resolves.toBe(1);
        await capture(page, `reserve-held-${locale}`);

        await payLink.click();
        await expect(linkOpened).resolves.toBe(reservationResult().pay_url);
      } finally {
        await page.close();
      }
    });

    test(`reservation page mode in ${locale}: links the prefilled reservation page without a Reserve button`, async () => {
      const { page, view, calls } = await openBookingView({
        mode: "reservation_page",
        locale,
      });
      try {
        await checkAvailability(view, locale);
        await view
          .getByRole("link", {
            name: m.bookingWidgetOpenReservationPage({}, { locale }),
          })
          .waitFor();
        await expect(
          view
            .getByRole("button", {
              name: m.bookingWidgetReserve({}, { locale }),
            })
            .count()
        ).resolves.toBe(0);
        await expect(
          view.getByText(quoteResult().reservation_url, { exact: true }).count()
        ).resolves.toBe(1);
        expect(calls.map(({ name }) => name)).not.toContain(
          "start_reservation"
        );
        await capture(page, `reservation-page-${locale}`);
      } finally {
        await page.close();
      }
    });

    for (const theme of ["light", "dark"] as const) {
      test(`ChatGPT in ${locale} with a ${theme} host: links the prefilled reservation page, never a Pay page`, async () => {
        const { page, view, calls, linkOpened } = await openBookingView({
          mode: "reservation_page",
          locale,
          hostTheme: theme,
          chatgptBridge: true,
        });
        try {
          await expect(
            view.locator("html").getAttribute("data-theme")
          ).resolves.toBe(theme);
          await checkAvailability(view, locale);
          const reservationPageLink = view.getByRole("link", {
            name: m.bookingWidgetOpenReservationPage({}, { locale }),
          });
          await reservationPageLink.waitFor();
          await expect(
            view
              .getByRole("link")
              .evaluateAll((links) =>
                links.map((link) => link.getAttribute("href"))
              )
          ).resolves.toEqual([quoteResult().reservation_url]);
          await expect(
            view
              .getByRole("button", {
                name: m.bookingWidgetReserve({}, { locale }),
              })
              .count()
          ).resolves.toBe(0);
          // ChatGPT's directory admits no checkout copy.
          await expect(view.locator("body").innerText()).resolves.not.toMatch(
            /\bpa(y|id)|payment|zaplat|platb/i
          );
          await capture(page, `chatgpt-reservation-page-${theme}-${locale}`);

          await reservationPageLink.click();
          await expect(linkOpened).resolves.toBe(quoteResult().reservation_url);
          expect(calls.map(({ name }) => name)).toEqual([
            "check_availability",
            "get_quote",
          ]);
        } finally {
          await page.close();
        }
      });
    }
  }

  test("follows the host's theme and style variables as they change", async () => {
    const { page, view } = await openBookingView({
      mode: "reservation_page",
      locale: "en-US",
      hostTheme: "light",
      hostStyles: hostStyleVariables.light,
    });
    // Read once the controls' colour transitions have finished.
    const colors = (locator: Locator) =>
      locator.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished)
        );
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color];
      });
    const body = view.locator("body");
    const checkButton = view.getByRole("button", {
      name: m.bookingWidgetCheck({}, { locale: "en-US" }),
    });
    const changeTheme = async (theme: McpUiTheme) => {
      await page.evaluate(
        ([theme, styleVariables]) =>
          window.changeBookingHost({ theme, styleVariables }),
        [theme, hostStyleVariables[theme]] as const
      );
      await view.locator(`html[data-theme='${theme}']`).waitFor();
      await page.evaluate((background) => {
        document.body.style.background = background;
      }, hostStyleVariables[theme]["--color-background-primary"]);
    };
    try {
      await checkAvailability(view, "en-US");
      // Off the button, which shows its hover tint after the click.
      await page.mouse.move(0, 0);
      await expect(colors(body)).resolves.toEqual([
        "rgb(255, 255, 255)",
        "rgb(31, 30, 29)",
      ]);
      await expect(colors(checkButton)).resolves.toEqual([
        "rgb(184, 59, 6)",
        "rgb(255, 255, 255)",
      ]);
      await capture(page, "host-styles-light-en-US");

      // In a dark host the accent turns light and the text on it dark.
      await changeTheme("dark");
      await expect(colors(body)).resolves.toEqual([
        "rgb(38, 38, 36)",
        "rgb(245, 244, 239)",
      ]);
      await expect(colors(checkButton)).resolves.toEqual([
        "rgb(240, 138, 75)",
        "rgb(20, 21, 42)",
      ]);
      await capture(page, "host-styles-dark-en-US");

      await changeTheme("light");
      await expect(colors(checkButton)).resolves.toEqual([
        "rgb(184, 59, 6)",
        "rgb(255, 255, 255)",
      ]);
    } finally {
      await page.close();
    }
  });

  test("takes the theme and language from ChatGPT's bridge when the host context lacks them", async () => {
    const { page, view, calls } = await openBookingView({
      mode: "reservation_page",
      locale: "cs-CZ",
      hostLocale: null,
      requestedLocale: null,
      resultLocale: "en-US",
      chatgptBridge: true,
      chatgptGlobals: { theme: "dark", locale: "cs-CZ" },
    });
    try {
      expect(calls[0]).toEqual({
        name: "list_offerings",
        args: { locale: "cs-CZ" },
      });
      const html = view.locator("html");
      await expect(html.getAttribute("data-theme")).resolves.toBe("dark");

      // ChatGPT announces a theme change on its bridge.
      await html.evaluate(() => {
        Object.assign(window.openai ?? {}, { theme: "light" });
        window.dispatchEvent(
          new CustomEvent("openai:set_globals", {
            detail: { globals: { theme: "light" } },
          })
        );
      });
      await expect(html.getAttribute("data-theme")).resolves.toBe("light");
    } finally {
      await page.close();
    }
  });

  test("follows a Czech host when the agent asks for no locale, listing the offerings again in Czech", async () => {
    const { page, view, calls } = await openBookingView({
      mode: "reservation_page",
      locale: "cs-CZ",
      hostLocale: "cs",
      requestedLocale: null,
      resultLocale: "en-US",
    });
    try {
      expect(calls[0]).toEqual({
        name: "list_offerings",
        args: { locale: "cs-CZ" },
      });
      await view
        .getByRole("group", {
          name: m.bookingWidgetFamilyLabel({}, { locale: "cs-CZ" }),
        })
        .waitFor();
    } finally {
      await page.close();
    }
  });

  test("words the booking error itself and falls back to the reservation page", async () => {
    const { page, view } = await openBookingView({
      mode: "reserve",
      locale: "en-US",
      answers: {
        start_reservation: () =>
          toolResult(
            {
              error: {
                code: "profile_incomplete",
                message: m.agentToolErrorProfileIncomplete(
                  {},
                  { locale: "en-US" }
                ),
              },
            },
            true
          ),
      },
    });
    try {
      await checkAvailability(view, "en-US");
      await view
        .getByRole("button", {
          name: m.bookingWidgetReserve({}, { locale: "en-US" }),
        })
        .click();
      await view
        .getByRole("alert")
        .getByText(
          m.bookingWidgetErrorProfileIncomplete({}, { locale: "en-US" })
        )
        .waitFor();
      await view
        .getByRole("link", {
          name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
        })
        .waitFor();
      await capture(page, "reserve-failed-en-US");
    } finally {
      await page.close();
    }
  });

  test("asks for a meeting room start time before calling any tool", async () => {
    const { page, view, calls } = await openBookingView({
      mode: "reserve",
      locale: "en-US",
    });
    try {
      // The segment's radio is visually hidden; customers click its label.
      await view
        .getByText(m.bookingWidgetFamilyMeetingRoom({}, { locale: "en-US" }), {
          exact: true,
        })
        .click();
      await expect(
        view
          .getByRole("radio", {
            name: m.bookingWidgetFamilyMeetingRoom({}, { locale: "en-US" }),
          })
          .isChecked()
      ).resolves.toBe(true);
      await view
        .getByRole("button", {
          name: m.bookingWidgetCheck({}, { locale: "en-US" }),
        })
        .click();
      const startTime = view.getByLabel(
        m.bookingWidgetStartTimeLabel({}, { locale: "en-US" })
      );
      await view
        .getByText(m.bookingWidgetStartTimeRequired({}, { locale: "en-US" }))
        .waitFor();
      await expect(startTime.getAttribute("aria-invalid")).resolves.toBe(
        "true"
      );
      expect(calls).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("words a startup failure in the view's language", async () => {
    const { page, view } = await openBookingView({
      mode: "reservation_page",
      locale: "cs-CZ",
      hostLocale: "cs-CZ",
      requestedLocale: null,
      resultLocale: "en-US",
      answers: {
        list_offerings: () =>
          toolResult(
            {
              error: {
                code: "rate_limited",
                message: m.agentToolErrorRateLimited({}, { locale: "cs-CZ" }),
              },
            },
            true
          ),
      },
      waitForForm: false,
    });
    try {
      await view
        .getByRole("alert")
        .getByText(m.bookingWidgetStartFailed({}, { locale: "cs-CZ" }))
        .waitFor();
      await expect(view.locator("html").getAttribute("lang")).resolves.toBe(
        "cs-CZ"
      );
      await capture(page, "startup-error-cs-CZ");
    } finally {
      await page.close();
    }
  });

  test("opens links through ChatGPT's bridge when the host doesn't declare openLinks", async () => {
    const { page, view, externalOpened } = await openBookingView({
      mode: "reservation_page",
      locale: "en-US",
      opensLinks: false,
      chatgptBridge: true,
    });
    try {
      await checkAvailability(view, "en-US");
      await view
        .getByRole("link", {
          name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
        })
        .click();
      await expect(externalOpened).resolves.toEqual({
        href: quoteResult().reservation_url,
        redirectUrl: false,
      });
    } finally {
      await page.close();
    }
  });

  test("leaves a plain link with its address when the host can't open links", async () => {
    const { page, view } = await openBookingView({
      mode: "reservation_page",
      locale: "en-US",
      opensLinks: false,
    });
    try {
      await checkAvailability(view, "en-US");
      // The harness's sandbox blocks popups, as some hosts' do, so this
      // checks that the view leaves the anchor and its address to the
      // browser rather than following the link.
      const link = view.getByRole("link", {
        name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
      });
      await expect(link.getAttribute("href")).resolves.toBe(
        quoteResult().reservation_url
      );
      await expect(link.getAttribute("target")).resolves.toBe("_blank");
      await view
        .getByText(quoteResult().reservation_url, { exact: true })
        .waitFor();
    } finally {
      await page.close();
    }
  });
});
