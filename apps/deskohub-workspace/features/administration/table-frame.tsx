import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

export function AdministrationTableFrame({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-navy-blue/10 bg-white",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AdministrationResponsiveTable({
  desktop,
  mobile,
}: {
  readonly desktop: ReactNode;
  readonly mobile: ReactNode;
}) {
  return (
    <AdministrationTableFrame>
      <div className="hidden overflow-x-auto md:block">{desktop}</div>
      <div className="md:hidden">{mobile}</div>
    </AdministrationTableFrame>
  );
}
