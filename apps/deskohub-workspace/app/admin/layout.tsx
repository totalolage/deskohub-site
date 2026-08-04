import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import { AdminShell } from "@/features/administration/admin-shell";
import "../globals.css";

const sculpin = localFont({
  src: [
    {
      path: "../../assets/fonts/Sculpin/regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  preload: false,
  display: "swap",
  variable: "--font-sculpin",
});

export const metadata: Metadata = {
  title: "Administration · Deskohub Workspace",
  robots: {
    index: false,
    follow: false,
  },
};

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
    <html lang="en" className={sculpin.variable} data-scroll-behavior="smooth">
      <body>
        <AdminShell breadcrumb={breadcrumb}>{children}</AdminShell>
        {modal}
      </body>
    </html>
  );
}
