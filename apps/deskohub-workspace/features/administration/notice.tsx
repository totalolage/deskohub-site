import { AlertCircle, CheckCircle2, TriangleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";

export type AdministrationNotice = {
  readonly message: string;
  readonly status: "error" | "success" | "warning";
};

export function AdministrationAlert({
  children,
  className,
  status,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly children: ReactNode;
  readonly status: AdministrationNotice["status"];
}) {
  const Icon = {
    error: AlertCircle,
    success: CheckCircle2,
    warning: TriangleAlert,
  }[status];
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm leading-6",
        {
          error: "bg-burned-orange/10 text-burned-orange-ink",
          success: "bg-aquamarine-green/15 text-aquamarine-ink",
          warning: "bg-sunset-yellow/15 text-navy-blue",
        }[status],
        className
      )}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function AdministrationNoticeBanner({
  notice,
}: {
  readonly notice?: AdministrationNotice;
}) {
  if (!notice) return null;
  return (
    <AdministrationAlert
      className="mb-5 font-semibold"
      role={notice.status === "error" ? "alert" : "status"}
      status={notice.status}
    >
      {notice.message}
    </AdministrationAlert>
  );
}
