"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useConfirmDiscardChanges } from "@/shared/components/unsaved-changes-guard";

type NextLinkProps = ComponentProps<typeof Link>;

export type GuardedLinkProps = Omit<NextLinkProps, "href"> & {
  readonly href: string;
};

export function GuardedLink({ href, onNavigate, ...props }: GuardedLinkProps) {
  const confirmDiscardChanges = useConfirmDiscardChanges();

  const handleNavigate: NonNullable<NextLinkProps["onNavigate"]> = (event) => {
    const current = new URL(window.location.href);
    const destination = new URL(href, current);
    const leavesCurrentPage =
      destination.pathname !== current.pathname ||
      destination.search !== current.search;

    if (leavesCurrentPage && !confirmDiscardChanges()) {
      event.preventDefault();
      return;
    }

    onNavigate?.(event);
  };

  return <Link href={href} {...props} onNavigate={handleNavigate} />;
}
