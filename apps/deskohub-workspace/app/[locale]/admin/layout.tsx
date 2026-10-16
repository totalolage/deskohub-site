import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/features/administration/admin-shell";

export const metadata: Metadata = {
  title: "Administration · Deskohub Workspace",
  robots: {
    index: false,
    follow: false,
  },
};

export const instant = true;

export default function AdminLayout({
  breadcrumb,
  children,
  modal,
}: {
  readonly breadcrumb: ReactNode;
  readonly children: ReactNode;
  readonly modal: ReactNode;
}) {
  return (
    <>
      <AdminShell breadcrumb={breadcrumb}>{children}</AdminShell>
      {modal}
    </>
  );
}
