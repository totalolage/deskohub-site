import { redirect } from "next/navigation";
import {
  type AdministrationRedirectSearchParams,
  getAdministrationRedirectUrl,
} from "@/features/administration/administration-redirect";

export default async function LegacyNexiOrdersPage({
  searchParams,
}: {
  readonly searchParams: Promise<AdministrationRedirectSearchParams>;
}) {
  redirect(
    getAdministrationRedirectUrl("/admin/nexi/orders", await searchParams)
  );
}
