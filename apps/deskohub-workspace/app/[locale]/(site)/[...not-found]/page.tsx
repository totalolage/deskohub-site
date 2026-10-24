import { notFound } from "next/navigation";
import { connection } from "next/server";

// An unmatched path is known only per request. Thrown while the build
// prerenders the route, `notFound()` served production's unmatched URLs as
// Next's bare error document, outside the locale layout. Thrown per request
// before anything streams, it renders the localized `(site)/not-found.tsx`
// inside the layout with a 404 status. The metadata throw keeps the 404 for
// crawlers even if the page ever streams behind a shell.
export const instant = false;

export async function generateMetadata(): Promise<never> {
  await connection();
  notFound();
}

export default async function CatchAllPage() {
  await connection();
  notFound();
}
