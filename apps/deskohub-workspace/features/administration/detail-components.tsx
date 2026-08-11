import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

export function AdministrationFact({
  label,
  value,
  valueClassName,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly valueClassName?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65">
        {label}
      </dt>
      <dd className={cn("mt-1.5 font-medium", valueClassName)}>{value}</dd>
    </div>
  );
}

export function AdministrationDetailSection({
  children,
  className,
  density = "default",
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly density?: "compact" | "default";
  readonly title: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-navy-blue/10 bg-white",
        {
          compact: "p-3",
          default: "p-5",
        }[density],
        className
      )}
    >
      <h2
        className={cn(
          "text-xs font-semibold uppercase text-navy-blue/65",
          {
            compact: "px-3 pb-2 pt-1 tracking-[0.12em]",
            default: "mb-4 tracking-[0.1em]",
          }[density]
        )}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
