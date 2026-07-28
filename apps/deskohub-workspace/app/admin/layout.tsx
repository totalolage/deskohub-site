import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
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
  title: "Discount administration · Deskohub Workspace",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" className={sculpin.variable}>
      <body>{children}</body>
    </html>
  );
}
