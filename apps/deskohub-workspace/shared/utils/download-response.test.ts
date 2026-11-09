import { describe, expect, test } from "bun:test";
import { createDownloadResponse } from "./download-response";

describe("createDownloadResponse", () => {
  test("returns a private attachment of the body", async () => {
    const response = createDownloadResponse({
      body: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      contentType: "application/pdf",
      filename: "WS-FV-2026-000042.pdf",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="WS-FV-2026-000042.pdf"'
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      0x25, 0x50, 0x44, 0x46,
    ]);
  });

  test("keeps the file name inside its quotes", () => {
    const response = createDownloadResponse({
      body: "",
      contentType: "text/plain",
      filename: 'evil"; filename=x.pdf',
    });

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="evil___filename_x.pdf"'
    );
  });
});
