import { notFound } from "next/navigation";

// Keeps unknown administration paths in the administration frame instead of
// the customer catch-all.
export default function AdministrationCatchAllPage() {
  notFound();
}
