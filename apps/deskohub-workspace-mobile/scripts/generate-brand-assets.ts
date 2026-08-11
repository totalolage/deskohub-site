import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageDirectory = path.resolve(scriptDirectory, "../assets/images");
const sourcePath = path.resolve(
  scriptDirectory,
  "../../deskohub-workspace/assets/logo/small-bg:dark.svg"
);
const markSvg = await readFile(sourcePath, "utf8");
await mkdir(imageDirectory, { recursive: true });

const navy = "#00024f";
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function mark(size: number, color = "#efefef") {
  return sharp(Buffer.from(markSvg.replace("rgb(239,239,239)", color)), {
    density: 600,
  })
    .trim({ background: transparent })
    .resize(size, size, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
}

async function squareIcon(
  filename: string,
  canvasSize: number,
  markSize: number,
  background: string | typeof transparent
) {
  const logo = await mark(markSize);
  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background,
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(imageDirectory, filename));
}

await Promise.all([
  squareIcon("icon.png", 1024, 620, navy),
  squareIcon("favicon.png", 256, 164, navy),
  squareIcon("splash-icon.png", 512, 360, transparent),
  squareIcon("android-icon-foreground.png", 1024, 440, transparent),
  squareIcon("android-icon-monochrome.png", 432, 248, transparent),
  sharp({ create: { width: 432, height: 432, channels: 4, background: navy } })
    .png()
    .toFile(path.join(imageDirectory, "android-icon-background.png")),
]);
