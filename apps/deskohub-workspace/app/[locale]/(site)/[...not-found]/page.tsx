import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NotFoundContent } from "../not-found-content";

// An unmatched path is known only per request, and a `notFound()` that reaches
// the server-rendered shell turns the whole response into Next's bare error
// document, without the locale layout. So the shell shows the localized 404
// content itself, the metadata throw gives the response its 404 status, and
// the page's own throw streams in after the shell, as on a gated page.
export const instant = true;

export async function generateMetadata(): Promise<never> {
  await connection();
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
