import { connection } from "next/server";

// Fails every request so end-to-end tests can check where the customer error
// page renders.
export default async function RouteErrorPreviewPage() {
  await connection();
  throw new Error("Route error preview");
}
