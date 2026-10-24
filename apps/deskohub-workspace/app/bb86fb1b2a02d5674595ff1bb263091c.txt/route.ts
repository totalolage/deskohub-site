import { env } from "@/env";
import { indexNowKey } from "@/features/public-pages";
import { markUnindexedResponse } from "@/shared/utils/unindexed-response";

/**
 * IndexNow key file. Only production submits pages to IndexNow, so other
 * deployments don't serve the key.
 */
export function GET() {
  if (env.VERCEL_ENV !== "production") {
    return new Response(null, { status: 404 });
  }

  return markUnindexedResponse(
    new Response(indexNowKey, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}
