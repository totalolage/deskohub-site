import { notFound } from "next/navigation";
import { isWorkspaceLocale } from "@/features/i18n";
import { LandingPage } from "@/features/landing-page/components/landing-page";

type LocalizedWorkspaceHomePageProps = {
  params: Promise<{ locale: string }>;
};

export default async function LocalizedWorkspaceHomePage({
  params,
}: LocalizedWorkspaceHomePageProps) {
  const { locale } = await params;
  if (!isWorkspaceLocale(locale)) notFound();

  return <LandingPage locale={locale} />;
}
