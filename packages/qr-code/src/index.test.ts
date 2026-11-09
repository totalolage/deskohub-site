import { describe, expect, test } from "bun:test";
import { generateQrCodePngBuffer } from ".";

describe("generateQrCodePngBuffer", () => {
  test("returns a PNG QR code buffer for plaintext", async () => {
    const png = await generateQrCodePngBuffer(
      "WIFI:T:WPA;S:Deskohub;P:workspace;;"
    );

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
