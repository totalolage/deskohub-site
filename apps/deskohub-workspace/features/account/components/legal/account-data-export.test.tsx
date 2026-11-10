import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { accountDataExportSections } from "@/features/account/account-data-export-sections";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountDataExport } from "./account-data-export";

const exportHref = "/en-US/account/data-export";
const archiveBytes = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
let originalClick: HTMLAnchorElement["click"];

let requests: string[] = [];
let respond: () => Promise<Response> = async () => new Response();
let downloads: string[] = [];
const blobs = new Map<string, Blob>();

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  originalClick = HTMLAnchorElement.prototype.click;
});

beforeEach(() => {
  requests = [];
  downloads = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return respond();
  }) as typeof fetch;
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!blobs.has(this.href)) return originalClick.call(this);
    downloads.push(this.download);
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  HTMLAnchorElement.prototype.click = originalClick;
  URL.createObjectURL = originalCreateObjectURL;
});

afterAll(async () => {
  cleanup();
  await flushWorkspaceComponentWork();
  await unregisterWorkspaceComponentTestEnv();
});

const archiveResponse = () =>
  new Response(archiveBytes, {
    headers: {
      "Content-Disposition":
        'attachment; filename="deskohub-account-data-2026-11-09.zip"',
      "Content-Type": "application/zip",
    },
  });

const renderExport = (locale: "cs-CZ" | "en-US" = "en-US") => {
  const view = render(<AccountDataExport href={exportHref} locale={locale} />);
  const query = (slot: string) => {
    const element = view.container.querySelector<HTMLElement>(
      `[data-slot="${slot}"]`
    );
    if (!element) throw new Error(`missing ${slot}`);
    return element;
  };
  return {
    view,
    container: () => query("account-data-export"),
    action: () => query("account-data-export-action"),
    status: () => query("account-data-export-status"),
    toggle: () => query("account-data-export-contents-toggle"),
    contents: () => query("account-data-export-contents"),
  };
};

describe("AccountDataExport", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "starts ready in %s, with a mounted empty status and the contents collapsed",
    (locale) => {
      const { action, container, contents, status, toggle } =
        renderExport(locale);

      expect(container().getAttribute("data-state")).toBe("idle");
      expect(action().tagName.toLowerCase()).toBe("button");
      expect(action().getAttribute("type")).toBe("button");
      expect(action().getAttribute("aria-disabled")).toBe("false");
      expect(status().getAttribute("role")).toBe("status");
      expect(status().textContent).toBe("");
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(toggle().getAttribute("aria-controls")).toBe(contents().id);
      expect(contents().hidden).toBe(true);
      // The action comes before the disclosure, so a long list never pushes
      // it down.
      expect(
        action().compareDocumentPosition(toggle()) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  );

  test("lists one entry per catalog section plus the manifest", () => {
    const { contents, toggle } = renderExport();

    fireEvent.click(toggle());

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(contents().hidden).toBe(false);
    const items = Array.from(contents().querySelectorAll("li"));
    expect(items).toHaveLength(accountDataExportSections.length + 1);
    for (const item of items) expect(item.textContent).not.toBe("");
    expect(new Set(items.map((item) => item.textContent)).size).toBe(
      items.length
    );

    fireEvent.click(toggle());

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(contents().hidden).toBe(true);
  });

  test("shows the download as pending, then hands the archive to the browser under its own name", async () => {
    let finish!: () => void;
    respond = () =>
      new Promise((resolve) => {
        finish = () => resolve(archiveResponse());
      });
    const { action, container, status } = renderExport();
    const statusRegion = status();

    fireEvent.click(action());

    await waitFor(() =>
      expect(container().getAttribute("data-state")).toBe("pending")
    );
    expect(action().getAttribute("aria-disabled")).toBe("true");
    const pendingStatus = statusRegion.textContent;
    expect(pendingStatus).not.toBe("");

    // A second click while pending starts no second request.
    fireEvent.click(action());
    expect(requests).toEqual([exportHref]);

    finish();

    await waitFor(() =>
      expect(container().getAttribute("data-state")).toBe("delivered")
    );
    expect(downloads).toEqual(["deskohub-account-data-2026-11-09.zip"]);
    expect(requests).toEqual([exportHref]);
    expect(action().getAttribute("aria-disabled")).toBe("false");
    // The same mounted region now announces the outcome.
    expect(status()).toBe(statusRegion);
    expect(statusRegion.textContent).not.toBe("");
    expect(statusRegion.textContent).not.toBe(pendingStatus);
  });

  test.each([
    ["the route refuses the request", () => new Response("", { status: 404 })],
    ["the archive can't be assembled", () => new Response("", { status: 500 })],
    [
      "the request lands on an HTML page",
      () =>
        new Response("<!doctype html><title>Sign in</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ],
    [
      "the network fails",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
  ] as const)(
    "reports an error without saving a file when %s, and can retry",
    async (_, response) => {
      respond = async () => response();
      const { action, container, status } = renderExport();
      const statusRegion = status();

      fireEvent.click(action());

      await waitFor(() =>
        expect(container().getAttribute("data-state")).toBe("error")
      );
      expect(downloads).toEqual([]);
      expect(status()).toBe(statusRegion);
      expect(statusRegion.textContent).not.toBe("");
      expect(action().getAttribute("aria-disabled")).toBe("false");

      respond = async () => archiveResponse();
      fireEvent.click(action());

      await waitFor(() =>
        expect(container().getAttribute("data-state")).toBe("delivered")
      );
      expect(requests).toEqual([exportHref, exportHref]);
    }
  );
});
