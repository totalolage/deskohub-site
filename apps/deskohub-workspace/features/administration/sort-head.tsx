import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { TableHead } from "@/shared/components/ui/table";
import { UnstyledButton } from "@/shared/components/ui/unstyled-button";
import { cn } from "@/shared/utils";
import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationHref } from "./administration-href";

const sortControlClassName =
  "-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-left hover:bg-navy-blue/5";

export type AdministrationSortDirection = false | "asc" | "desc";

export function AdministrationSortHead({
  children,
  className,
  direction = false,
  href,
  onToggle,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly direction?: AdministrationSortDirection;
  readonly href?: AdministrationHref;
  readonly onToggle?: MouseEventHandler<HTMLButtonElement>;
}) {
  const ariaSort = {
    asc: "ascending",
    desc: "descending",
    false: "none",
  }[String(direction)] as "ascending" | "descending" | "none";
  if (!(href || onToggle)) {
    return <TableHead className={className}>{children}</TableHead>;
  }

  const content = (
    <>
      {children}
      <AdministrationSortIndicator direction={direction} />
    </>
  );
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      {href ? (
        <Link
          className={cn(
            sortControlClassName,
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burned-orange"
          )}
          href={href}
        >
          {content}
        </Link>
      ) : (
        <UnstyledButton className={sortControlClassName} onClick={onToggle}>
          {content}
        </UnstyledButton>
      )}
    </TableHead>
  );
}

function AdministrationSortIndicator({
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
