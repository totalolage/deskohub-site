import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import { m } from "./i18n";

export function NexiOrderLink({
  accessibleLabel,
  children,
  className,
  locale,
  orderId,
}: {
  /** Names the order, such as "Nexi order 123"; the XPay note is added. */
  readonly accessibleLabel?: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly locale: Locale;
  readonly orderId: string;
}) {
  return (
    <a
      aria-label={m.administrationNexiOrderLinkLabel(
        {
          order:
            accessibleLabel ??
            m.administrationNexiOrderName({ orderId }, { locale }),
        },
        { locale }
      )}
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
