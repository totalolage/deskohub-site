import QRCode from "qrcode";

export interface GenerateQrCodeSvgOptions {
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  readonly margin?: number;
  readonly width?: number;
  readonly darkColor?: string;
  readonly lightColor?: string;
}

export type GenerateQrCodePngBufferOptions = GenerateQrCodeSvgOptions;

const createQrCodeOptions = (options: GenerateQrCodeSvgOptions = {}) => ({
  errorCorrectionLevel: options.errorCorrectionLevel ?? "M",
  margin: options.margin ?? 2,
  width: options.width,
  color: {
    dark: options.darkColor ?? "#00024fff",
    light: options.lightColor ?? "#ffffffff",
  },
});

const assertPlaintext = (plaintext: string) => {
  if (!plaintext) {
    throw new Error("QR code plaintext must not be empty.");
  }
};

export const generateQrCodeSvg = async (
  plaintext: string,
  options: GenerateQrCodeSvgOptions = {}
) => {
  assertPlaintext(plaintext);

  return await QRCode.toString(plaintext, {
    ...createQrCodeOptions(options),
    type: "svg",
  });
};

export const generateQrCodePngBuffer = async (
  plaintext: string,
  options: GenerateQrCodePngBufferOptions = {}
) => {
  assertPlaintext(plaintext);

  return await QRCode.toBuffer(plaintext, createQrCodeOptions(options));
};
