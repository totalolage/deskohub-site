import { Effect } from "effect";
import { generateSvgPngBuffer } from "osm";
import faviconSvg from "@/public/favicon.svg" with { type: "text" };
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";

export async function GET() {
  const image = await getWorkspaceFavicon();

  return new Response(image, {
    headers: {
      "Cache-Control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": "image/png",
    },
  });
}

async function getWorkspaceFavicon() {
  "use cache";

  // The image is rendered from a bundled SVG, so a failure is a defect to
  // surface, never to share.
  return await readSharedSnapshot(
    "workspaceFavicon.render",
    generateSvgPngBuffer(faviconSvg, {
      canvas: {
        width: 512,
        height: 512,
        padding: 24,
        background: "#FFFFFF",
      },
    }).pipe(Effect.map((image) => new Uint8Array(image))),
    { complete: { lifetime: "max" } }
  );
}
