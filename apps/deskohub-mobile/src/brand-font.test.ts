import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brandFontFamilies, brandFonts } from "@deskohub/brand-tokens";
import appJson from "../app.json";

const appRoot = join(import.meta.dir, "..");
const brandFontPath = "./assets/fonts/Sculpin.ttf";

const fontPluginOptions = (): unknown => {
  const entry = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-font"
  );
  if (!Array.isArray(entry)) {
    throw new Error("app.json must configure the expo-font plugin's fonts.");
  }
  return entry[1];
};

// The name table's family (name ID 16, else 1) in its Windows Unicode record,
// which is the name iOS registers the font under.
const readFontFamilyName = (font: Buffer): string => {
  const tableCount = font.readUInt16BE(4);
  for (let table = 0; table < tableCount; table++) {
    const record = 12 + table * 16;
    if (font.toString("latin1", record, record + 4) !== "name") continue;
    const nameTable = font.readUInt32BE(record + 8);
    const count = font.readUInt16BE(nameTable + 2);
    const strings = nameTable + font.readUInt16BE(nameTable + 4);
    const names = new Map<number, string>();
    for (let index = 0; index < count; index++) {
      const name = nameTable + 6 + index * 12;
      if (font.readUInt16BE(name) !== 3) continue;
      const start = strings + font.readUInt16BE(name + 10);
      const utf16be = font.subarray(start, start + font.readUInt16BE(name + 8));
      names.set(
        font.readUInt16BE(name + 6),
        Buffer.from(utf16be).swap16().toString("utf16le")
      );
    }
    const family = names.get(16) ?? names.get(1);
    if (family) return family;
  }
  throw new Error("The font has no family name.");
};

describe("brand font", () => {
  test("embeds the brand face on iOS and Android under the family and weights the theme uses", () => {
    expect(fontPluginOptions()).toEqual({
      ios: { fonts: [brandFontPath] },
      android: {
        fonts: [
          {
            fontFamily: brandFontFamilies.native,
            path: brandFontPath,
            // One face per weight the brand text uses, drawn at that weight.
            fontDefinitions: [
              ...new Set(Object.values(brandFonts.weights)),
            ].map((weight) => ({ weight })),
          },
        ],
      },
    });
  });

  test("ships a TrueType file whose family name iOS registers as the theme's", async () => {
    const font = await readFile(join(appRoot, brandFontPath));
    expect(font.readUInt32BE(0)).toBe(0x00010000);
    expect(readFontFamilyName(font)).toBe(brandFontFamilies.native);
  });
});
