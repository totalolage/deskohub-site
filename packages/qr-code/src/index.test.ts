import { describe, expect, test } from "bun:test";
import { generateQrCodeSvg } from ".";

describe("generateQrCodeSvg", () => {
  test("returns an SVG QR code for plaintext", async () => {
    const svg = await generateQrCodeSvg("WIFI:T:WPA;S:Deskohub;P:workspace;;");

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("viewBox");
  });
});
