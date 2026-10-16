import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function CliSessionsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["cli", "sessions"]} />;
}
