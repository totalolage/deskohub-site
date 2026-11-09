import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLocale, type Locale } from "@/features/i18n";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import { EmailPreviewFrame } from "../_components/email-preview-frame";
import { createContactEmailPreviews } from "../_lib/create-contact-email-previews";

export const metadata: Metadata = {
  title: "Workspace contact confirmation email preview",
  robots: { index: false, follow: false },
};

type ContactConfirmationEmailPreviewPageProps = {
  readonly params: Promise<{ locale: string }>;
};

export default async function ContactConfirmationEmailPreviewPage({
  params,
}: ContactConfirmationEmailPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <Suspense fallback={null}>
      <ContactConfirmationEmailPreviewContent locale={locale} />
    </Suspense>
  );
}

async function ContactConfirmationEmailPreviewContent({
  locale,
}: {
  readonly locale: Locale;
}) {
  await connection();
  const { confirmation } = await createContactEmailPreviews(locale).pipe(
    runStandaloneWorkspaceEffect("workspaceContactEmail.previewConfirmation")
  );

  return (
    <EmailPreviewFrame
      description="This page renders the current customer contact confirmation with mock data and no provider send."
      html={confirmation}
      title="Workspace contact confirmation email preview"
    />
  );
}
