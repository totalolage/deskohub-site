import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

export function NexiOrderLink({
  accessibleLabel,
  children,
  className,
  orderId,
}: {
  readonly accessibleLabel?: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly orderId: string;
}) {
  return (
    <a
      aria-label={`${accessibleLabel ?? `Nexi order ${orderId}`} (opens in XPay)`}
      className={cn(
        "inline-flex items-baseline gap-1.5 font-semibold text-burned-orange-ink underline decoration-burned-orange/30 underline-offset-4 hover:decoration-burned-orange",
        className
      )}
      href={`https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/${encodeURIComponent(orderId)}`}
      rel="noreferrer"
      target="_blank"
    >
      {children ?? orderId}
      <span aria-hidden>↗</span>
    </a>
  );
}
