"use client";

import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import { useCustomerFilterNavigation } from "./customer-filter-navigation";

export function CustomerCountPending({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isFilterNavigationPending } = useCustomerFilterNavigation();

  if (isFilterNavigationPending) {
    return (
      <Badge
        aria-live="polite"
        className="w-fit"
        role="status"
        variant="subtle"
      >
        {m.adminCustomersPendingLabel({})}
      </Badge>
    );
  }

  return <>{children}</>;
}
