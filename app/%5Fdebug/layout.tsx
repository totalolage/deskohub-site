import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";
import { isDev } from "@/shared/utils/environment";
import RootLayout from "../rootLayout";

export async function generateMetadata(): Promise<Metadata> {
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.NODE_ENV !== "production"
      ? `http://localhost:${process.env.PORT || 3000}`
      : undefined);

  return {
    metadataBase: origin ? new URL(origin) : undefined,
  };
}

export default async function LocaleLayout({
  children,
}: Readonly<PropsWithChildren>) {
  if (!isDev()) return notFound();
  return <RootLayout>{children}</RootLayout>;
}
