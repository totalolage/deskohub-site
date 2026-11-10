"use client";

import type { ComponentProps, ReactNode } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  DateInput,
  type DateInputProps,
} from "@/shared/components/date-time/date-input";
import { cn } from "@/shared/utils";
import {
  type AdministrationHref,
  localizeAdministrationHref,
} from "./administration-href";

const controlClassName =
  "h-10 w-full rounded-lg border border-navy-blue/15 bg-white px-3 text-sm text-navy-blue outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15 disabled:cursor-not-allowed disabled:opacity-50";

const fieldLabelClassName = "text-xs font-semibold text-navy-blue/65";

export function AdministrationFilterField({
  children,
  className,
  htmlFor,
  label,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly htmlFor: string;
  readonly label: string;
}) {
  return (
    <label
      className={cn("grid gap-1.5", fieldLabelClassName, className)}
      htmlFor={htmlFor}
    >
      {label}
      {children}
    </label>
  );
}

/**
 * A filter's date on the shared date control. The label sits above the
 * control instead of around it, as the control holds its own calendar
 * button. The control takes the width of its cell, so a standalone filter
 * form gives it one.
 */
export function AdministrationFilterDateField({
  className,
  id,
  label,
  ...props
}: Omit<DateInputProps, "displayValue" | "id"> & {
  readonly id: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label className={fieldLabelClassName} htmlFor={id}>
        {label}
      </label>
      <DateInput {...props} displayValue={false} id={id} label={label} />
    </div>
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
  action,
  children,
  className,
  method = "get",
  variant = "toolbar",
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  readonly action?: AdministrationHref;
  readonly variant?: "standalone" | "toolbar";
}) {
  const locale = useRouteLocale();
  const localizedAction =
    action === undefined
      ? undefined
      : localizeAdministrationHref(action, locale);

  return (
    <form
      className={cn(
        {
          standalone: "flex flex-wrap items-end gap-3",
          toolbar: "grid gap-3 sm:grid-cols-2 2xl:items-end 2xl:justify-end",
        }[variant],
        className
      )}
      action={localizedAction}
      method={method}
      {...props}
    >
      {children}
    </form>
  );
}
