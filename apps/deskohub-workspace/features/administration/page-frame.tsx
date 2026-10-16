import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

export function AdministrationPage({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "mx-auto w-full max-w-[92rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9",
        className
      )}
    >
      {children}
    </main>
  );
}

export function AdministrationPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly title: string;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0 sm:flex-[1_1_24rem]">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-burned-orange-ink">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl leading-tight tracking-[-0.025em] sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-navy-blue/62">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
