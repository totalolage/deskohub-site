import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/utils";

const controlClassName =
  "h-10 w-full rounded-lg border border-navy-blue/15 bg-white px-3 text-sm text-navy-blue outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15 disabled:cursor-not-allowed disabled:opacity-50";

export function AdministrationFilterField({
  children,
  htmlFor,
  label,
}: {
  readonly children: ReactNode;
  readonly htmlFor: string;
  readonly label: string;
}) {
  return (
    <label
      className="grid gap-1.5 text-xs font-semibold text-navy-blue/65"
      htmlFor={htmlFor}
    >
      {label}
      {children}
    </label>
  );
}

export function AdministrationFilterInput({
  className,
  ...props
}: ComponentProps<"input">) {
  return <input className={cn(controlClassName, className)} {...props} />;
}

export function AdministrationFilterSelect({
  children,
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select className={cn(controlClassName, className)} {...props}>
      {children}
    </select>
  );
}

export function AdministrationFilterForm({
  children,
  className,
  variant = "toolbar",
  ...props
}: ComponentProps<"form"> & {
  readonly variant?: "standalone" | "toolbar";
}) {
  return (
    <form
      className={cn(
        {
          standalone: "flex flex-wrap items-end gap-3",
          toolbar: "grid gap-3 sm:grid-cols-2 2xl:items-end 2xl:justify-end",
        }[variant],
        className
      )}
      {...props}
    >
      {children}
    </form>
  );
}
