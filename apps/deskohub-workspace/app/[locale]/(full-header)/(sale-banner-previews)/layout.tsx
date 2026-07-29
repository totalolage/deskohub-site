import type { ReactNode } from "react";
import { requireWorkspaceTestingOnlyAccess } from "@/shared/utils/testing-only";

type SaleBannerPreviewsLayoutProps = {
  children: ReactNode;
};

export default function SaleBannerPreviewsLayout({
  children,
}: SaleBannerPreviewsLayoutProps) {
  requireWorkspaceTestingOnlyAccess();

  return children;
}
