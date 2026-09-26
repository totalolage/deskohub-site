"use client";

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Fragment, type ReactNode } from "react";

type PageNavigationBoundaryProps = {
  readonly children: ReactNode;
  readonly persistentSegments?: readonly string[];
};

export function PageNavigationBoundary({
  children,
  persistentSegments = [],
}: PageNavigationBoundaryProps) {
  const { bfcacheId } = useRouter();
  const selectedLayoutSegment = useSelectedLayoutSegment();
  const key =
    selectedLayoutSegment !== null &&
    persistentSegments.includes(selectedLayoutSegment)
      ? `persistent:${selectedLayoutSegment}`
      : bfcacheId;

  return <Fragment key={key}>{children}</Fragment>;
}
