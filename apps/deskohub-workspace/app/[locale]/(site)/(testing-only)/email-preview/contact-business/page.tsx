import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLocale, type Locale } from "@/features/i18n";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createContactEmailPreviews } from "../_lib/create-contact-email-previews";

export const metadata: Metadata = {
  title: "Workspace contact business email preview",
  robots: { index: false, follow: false },
};

type ContactBusinessEmailPreviewPageProps = {
  readonly params: Promise<{ locale: string }>;
};

export default async function ContactBusinessEmailPreviewPage({
  params,
}: ContactBusinessEmailPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <Suspense fallback={null}>
      <ContactBusinessEmailPreviewContent locale={locale} />
    </Suspense>
  );
}

async function ContactBusinessEmailPreviewContent({
  locale,
}: {
  readonly locale: Locale;
}) {
  await connection();
  const { business } = await createContactEmailPreviews(locale).pipe(
    runStandaloneWorkspaceEffect("workspaceContactEmail.previewBusiness")
  );

  return (
    <EmailPreviewFrame
      description="This page renders the current business contact notification with mock data and no provider send."
      html={business}
      title="Workspace contact business email preview"
    />
  );
}
