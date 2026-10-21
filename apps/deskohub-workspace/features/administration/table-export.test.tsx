import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { m } from "./i18n";
import type { AdministrationListExportFailure } from "./table-export";

const exportPath = "/admin/reservations/export?status=complete";
const csvText = `${String.fromCodePoint(0xfe_ff)}Reservation ID\r\nr-1\r\n`;
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
let originalClick: HTMLAnchorElement["click"];

let requests: string[] = [];
let respond: () => Promise<Response> = async () => new Response();
let downloads: { readonly fileName: string; readonly text: string }[] = [];
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
    const blob = blobs.get(this.href);
    if (!blob) return originalClick.call(this);
    void blob.text().then((text) => {
      downloads.push({ fileName: this.download, text });
    });
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  HTMLAnchorElement.prototype.click = originalClick;
  URL.createObjectURL = originalCreateObjectURL;
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const renderExport = async () => {
  const { AdministrationTableExport, AdministrationTableExportAlert } =
    await import("./table-export");
  const href = Promise.resolve(exportPath);
  const ExportWithAlert = () => {
    const [failure, setFailure] =
      useState<AdministrationListExportFailure | null>(null);
    return (
      <>
        <AdministrationTableExport href={href} onFailureChange={setFailure} />
        <AdministrationTableExportAlert failure={failure} />
      </>
    );
  };
  // The export path arrives as a promise, so let React settle the Suspense.
  const view = await act(async () =>
    render(
      <RouteLocaleProvider locale="en-US">
        <ExportWithAlert />
      </RouteLocaleProvider>
    )
  );
  const link = await view.findByRole("link", {
    name: m.administrationListExportButton({}, { locale: "en-US" }),
  });
  return { link, view };
};

const csvResponse = () =>
  new Response(csvText, {
    headers: {
      "Content-Disposition":
        'attachment; filename="reservations-2026-08-11.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });

describe("AdministrationTableExport", () => {
  test("keeps a localized link to the export for browsers without JavaScript", async () => {
    const { link } = await renderExport();

    expect(link.getAttribute("href")).toBe(
      "/en-US/admin/reservations/export?status=complete"
    );
  });

  test("shows the export as pending, then downloads the file under its own name", async () => {
    let finish!: () => void;
    respond = () =>
      new Promise((resolve) => {
        finish = () => resolve(csvResponse());
      });
    const { link, view } = await renderExport();

    fireEvent.click(link);

    await waitFor(() =>
      expect(link.textContent).toBe(
        m.administrationListExportPending({}, { locale: "en-US" })
      )
    );
    expect(link.getAttribute("aria-disabled")).toBe("true");
    finish();
    await waitFor(() =>
      expect(downloads).toEqual([
        {
          fileName: "reservations-2026-08-11.csv",
          text: csvText,
        },
      ])
    );
    expect(requests).toEqual([
      "/en-US/admin/reservations/export?status=complete",
    ]);
    await waitFor(() =>
      expect(link.textContent).toBe(
        m.administrationListExportButton({}, { locale: "en-US" })
      )
    );
    expect(view.getByRole("alert").textContent).toBe("");
  });

  test.each([
    [
      "Dotypos details are unavailable",
      () =>
        Response.json(
          { error: "x", code: "administration_list_source_unavailable" },
          { status: 503 }
        ),
      m.administrationListExportSourceUnavailable({}, { locale: "en-US" }),
    ],
    [
      "the service is unavailable for another reason",
      () => new Response("Service unavailable", { status: 503 }),
      m.administrationListExportFailed({}, { locale: "en-US" }),
    ],
    [
      "the session ended and the request landed on the sign-in page",
      () =>
        new Response("<!doctype html><title>Sign in</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      m.administrationListExportSignedOut({}, { locale: "en-US" }),
    ],
    [
      "the export failed",
      () => new Response(JSON.stringify({ error: "x" }), { status: 500 }),
      m.administrationListExportFailed({}, { locale: "en-US" }),
    ],
  ] as const)(
    "explains when %s, without saving a file",
    async (_, response, message) => {
      respond = async () => response();
      const { link, view } = await renderExport();
      const alert = view.getByRole("alert");

      fireEvent.click(link);

      await waitFor(() => expect(alert.textContent).toBe(message));
      expect(view.getByRole("alert")).toBe(alert);
      expect(downloads).toEqual([]);
    }
  );
});
