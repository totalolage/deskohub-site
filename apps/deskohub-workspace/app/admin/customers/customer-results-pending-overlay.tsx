"use client";

import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { useCustomerFilterNavigation } from "./customer-filter-navigation";

export function CustomerResultsPendingOverlay({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isFilterNavigationPending } = useCustomerFilterNavigation();

  return (
    <div className="relative">
      <div
        aria-busy={isFilterNavigationPending || undefined}
        inert={isFilterNavigationPending}
      >
        {children}
      </div>
      {isFilterNavigationPending && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-[#f6f6f3] pt-24">
          <p
            className="rounded-full border px-4 py-2 text-sm text-muted-foreground"
            role="status"
          >
            {m.adminCustomersPendingLabel({})}
          </p>
        </div>
      )}
    </div>
  );
}
