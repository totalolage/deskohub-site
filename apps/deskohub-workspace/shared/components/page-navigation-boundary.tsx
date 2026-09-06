"use client";

import { useRouter } from "next/navigation";
import { Fragment, type ReactNode } from "react";

type PageNavigationBoundaryProps = {
  readonly children: ReactNode;
};

export function PageNavigationBoundary({
  children,
}: PageNavigationBoundaryProps) {
  const { bfcacheId } = useRouter();

  return <Fragment key={bfcacheId}>{children}</Fragment>;
}
