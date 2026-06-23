import { NextResponse } from "next/server";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";

export async function GET() {
  try {
    const image = new Uint8Array(await generateWorkspaceLocationMapImage());

    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch {
    return new NextResponse("Workspace location map could not be generated.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
