import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { generateSvgPngBuffer } from "osm";
import faviconSvg from "@/public/favicon.svg" with { type: "text" };
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

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
  cacheLife("max");

  return generateSvgPngBuffer(faviconSvg, {
    canvas: {
      width: 512,
      height: 512,
      padding: 24,
      background: "#FFFFFF",
    },
  }).pipe(
    Effect.map((image) => new Uint8Array(image)),
    runWorkspaceEffect("workspaceFavicon.render")
  );
}
