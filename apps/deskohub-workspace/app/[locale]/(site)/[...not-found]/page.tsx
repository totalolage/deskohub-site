import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NotFoundContent } from "../not-found-content";

// Every unmatched path gets the same answer, so the build prerenders it once
// per locale. A `notFound()` in the page's shell would turn that prerender
// into Next's bare error document, outside the locale layout. Instead the
// metadata throw gives the prerender its 404 status and the shell shows the
// localized 404 content; the page's own throw streams in after the shell, as
// on a gated page whose flag is off.
export const instant = true;

export function generateMetadata(): never {
  notFound();
}

async function UnmatchedPath(): Promise<never> {
  await connection();
  notFound();
}

export default function CatchAllPage() {
  return (
    <Suspense fallback={<NotFoundContent />}>
      <UnmatchedPath />
    </Suspense>
  );
}
