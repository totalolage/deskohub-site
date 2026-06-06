import "../globals.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";
import { env } from "@/env";
import RootLayout from "../rootLayout";

export const metadata: Metadata = {
  metadataBase: env.NEXT_PUBLIC_DOMAIN,
};

export default async function DebugLayout({
  children,
}: Readonly<PropsWithChildren>) {
  if (env.NEXT_PUBLIC_VERCEL_ENV === "production") return notFound();
  return <RootLayout>{children}</RootLayout>;
}
