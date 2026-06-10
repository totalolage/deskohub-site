import Link from "next/link";
import type { ReactNode } from "react";
import { isLocale } from "@/features/i18n";

type WorkspaceEmailPreviewLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
};

const previewLinks = [
  {
    href: "customer-reservation",
    label: "Customer reservation",
  },
  {
    href: "reservation-notification",
    label: "Reservation notification",
  },
] as const;

export default async function WorkspaceEmailPreviewLayout({
  children,
  params,
}: WorkspaceEmailPreviewLayoutProps) {
  const { locale } = await params;

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        {isLocale(locale) && (
          <nav className="mb-4 flex flex-wrap gap-2">
            {previewLinks.map((link) => (
              <Link
                className="rounded-full border border-navy-blue/15 bg-white/70 px-4 py-2 font-semibold text-navy-blue text-sm shadow-sm shadow-navy-blue/5 transition hover:bg-white"
                href={`/${locale}/email-preview/${link.href}`}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </div>
    </main>
  );
}
