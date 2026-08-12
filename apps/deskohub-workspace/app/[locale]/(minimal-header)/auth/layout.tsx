import type { ReactNode } from "react";
import { AuthProvider } from "@/features/account/components/auth-provider";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export const instant = false;

export default async function AuthLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = await getRequestLocale();
  return <AuthProvider locale={locale}>{children}</AuthProvider>;
}
