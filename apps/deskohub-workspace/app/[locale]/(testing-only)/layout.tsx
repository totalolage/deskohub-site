import { type ReactNode, Suspense } from "react";
import { requireWorkspaceTestingOnlyAccess } from "@/shared/utils/testing-only";

type TestingOnlyLayoutProps = {
  children: ReactNode;
};

export default function TestingOnlyLayout({
  children,
}: TestingOnlyLayoutProps) {
  requireWorkspaceTestingOnlyAccess();

  return <Suspense fallback={null}>{children}</Suspense>;
}
