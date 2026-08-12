import "server-only";

import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";

export function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  return <AdministrationBreadcrumbs segments={["admin", ...segments]} />;
}
