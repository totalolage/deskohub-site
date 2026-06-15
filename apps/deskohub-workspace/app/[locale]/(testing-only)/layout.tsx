import type { ReactNode } from "react";
import { requireWorkspaceTestingOnlyAccess } from "@/shared/utils/testing-only";

type TestingOnlyLayoutProps = {
  children: ReactNode;
};

export default function TestingOnlyLayout({
  children,
}: TestingOnlyLayoutProps) {
  requireWorkspaceTestingOnlyAccess();

  return children;
}
