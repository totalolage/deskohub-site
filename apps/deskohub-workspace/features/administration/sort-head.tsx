import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
import { TableHead } from "@/shared/components/ui/table";

export type AdministrationSortDirection = false | "asc" | "desc";

export function AdministrationSortHead({
  children,
  direction = false,
  href,
  onToggle,
}: {
  readonly children: ReactNode;
  readonly direction?: AdministrationSortDirection;
  readonly href?: string;
  readonly onToggle?: MouseEventHandler<HTMLButtonElement>;
}) {
  const ariaSort = {
    asc: "ascending",
    desc: "descending",
    false: "none",
  }[String(direction)] as "ascending" | "descending" | "none";
  if (!(href || onToggle)) return <TableHead>{children}</TableHead>;

  const content = (
    <>
      {children}
      <AdministrationSortIndicator direction={direction} />
    </>
  );
  return (
    <TableHead aria-sort={ariaSort}>
      {href ? (
        <Link
          className="-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-left hover:bg-navy-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          href={href}
        >
          {content}
        </Link>
      ) : (
        <button
          className="-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-left hover:bg-navy-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          onClick={onToggle}
          type="button"
        >
          {content}
        </button>
      )}
    </TableHead>
  );
}

export function AdministrationSortIndicator({
  direction,
}: {
  readonly direction: AdministrationSortDirection;
}) {
  if (direction === "asc") return <ArrowUp aria-hidden className="size-3.5" />;
  if (direction === "desc") {
    return <ArrowDown aria-hidden className="size-3.5" />;
  }
  return <ArrowUpDown aria-hidden className="size-3.5 opacity-55" />;
}
