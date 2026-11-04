import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/shared/components/ui/button";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { MenuPDFDownload } from "./menu-pdf-download";

/**
 * Renders the download button on the server, then puts the page in the fake
 * browser and returns the button's click handler.
 */
const renderDownloadButton = () => {
  let onClick: (() => Promise<void>) | undefined;
  const Capture = () => {
    const tree = MenuPDFDownload();
    onClick = findElementsOfType(tree, Button)[0]?.props.onClick as
      | (() => Promise<void>)
      | undefined;
    return tree;
  };
  const html = renderToStaticMarkup(<Capture />);
  if (!onClick) throw new Error("The download button has no click handler");
  openInBrowser();
  return { html, click: onClick };
};

const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });

let browser: {
  analyticsEvents: unknown[][];
  objectUrls: { created: Blob[]; revoked: string[] };
  anchors: { href: string; download: string; clicks: number }[];
};
let requested: string[];
let restoreSpies: (() => void)[];

const globals = globalThis as { window?: unknown; document?: unknown };

beforeEach(() => {
  browser = {
    analyticsEvents: [],
    objectUrls: { created: [], revoked: [] },
    anchors: [],
  };
  requested = [];
  restoreSpies = [];
});

/** Installs the browser globals the click handler uses. */
function openInBrowser() {
  globals.window = {
    va: (...event: unknown[]) => browser.analyticsEvents.push(event),
    URL: {
      createObjectURL: (blob: Blob) => {
        browser.objectUrls.created.push(blob);
        return "blob:menu-pdf";
      },
      revokeObjectURL: (url: string) => browser.objectUrls.revoked.push(url),
    },
  };
  globals.document = {
    createElement: (tag: string) => {
      expect(tag).toBe("a");
      const anchor = {
        href: "",
        download: "",
        clicks: 0,
        click: () => {
          anchor.clicks += 1;
        },
      };
      browser.anchors.push(anchor);
      return anchor;
    },
  };
}

afterEach(() => {
  delete globals.window;
  delete globals.document;
  for (const restore of restoreSpies) restore();
});

/** Answers the PDF request with `respond` and records requested URLs. */
const servePdf = (respond: () => Promise<Response>) => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request
  ) => {
    requested.push(String(input));
    return respond();
  }) as typeof fetch);
  restoreSpies.push(() => fetchSpy.mockRestore());
};

const captureConsoleErrors = () => {
  const errorSpy = spyOn(console, "error").mockImplementation(mock());
  restoreSpies.push(() => errorSpy.mockRestore());
  return errorSpy;
};

describe("MenuPDFDownload", () => {
  test("starts idle with an enabled download button", () => {
    const { html } = renderDownloadButton();

    expect(html).toContain("<button");
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain("animate-spin");
  });

  test("tracks the click and saves the generated menu PDF", async () => {
    servePdf(async () => new Response(pdf));
    const { click } = renderDownloadButton();

    await click();

    expect(browser.analyticsEvents).toEqual([
      ["event", { name: "Menu PDF Download", options: undefined }],
    ]);
    expect(requested).toEqual(["/api/menu/pdf"]);
    expect(await browser.objectUrls.created[0]?.text()).toBe("%PDF-1.7");
    expect(browser.anchors).toEqual([
      expect.objectContaining({
        href: "blob:menu-pdf",
        download: "deskohub-menu.pdf",
        clicks: 1,
      }),
    ]);
    expect(browser.objectUrls.revoked).toEqual(["blob:menu-pdf"]);
  });

  test("logs a failed PDF response without downloading anything", async () => {
    servePdf(async () => new Response("error", { status: 500 }));
    const errors = captureConsoleErrors();
    const { click } = renderDownloadButton();

    await click();

    expect(browser.anchors).toEqual([]);
    expect(browser.objectUrls.created).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  test("logs an unreachable PDF endpoint without downloading anything", async () => {
    const offline = new TypeError("Network request failed");
    servePdf(async () => {
      throw offline;
    });
    const errors = captureConsoleErrors();
    const { click } = renderDownloadButton();

    await click();

    expect(browser.anchors).toEqual([]);
    expect(errors.mock.calls[0]?.[1]).toBe(offline);
  });
});
