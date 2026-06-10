import QRCode from "qrcode";

export interface GenerateQrCodeSvgOptions {
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  readonly margin?: number;
  readonly width?: number;
  readonly darkColor?: string;
  readonly lightColor?: string;
}

export const generateQrCodeSvg = async (
  plaintext: string,
  options: GenerateQrCodeSvgOptions = {}
) => {
  if (!plaintext) {
    throw new Error("QR code plaintext must not be empty.");
  }

  return await QRCode.toString(plaintext, {
    type: "svg",
    errorCorrectionLevel: options.errorCorrectionLevel ?? "M",
    margin: options.margin ?? 2,
    width: options.width,
    color: {
      dark: options.darkColor ?? "#00024fff",
      light: options.lightColor ?? "#ffffffff",
    },
  });
};
