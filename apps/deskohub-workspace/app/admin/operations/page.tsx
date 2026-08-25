import { redirect } from "next/navigation";
import {
  type AdministrationRedirectSearchParams,
  getAdministrationRedirectUrl,
} from "@/features/administration/administration-redirect";

export default async function LegacyNexiOperationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<AdministrationRedirectSearchParams>;
}) {
  redirect(
    getAdministrationRedirectUrl("/admin/nexi/operations", await searchParams)
  );
}
