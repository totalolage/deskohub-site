import Link from "next/link";
import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

type WorkspaceEmailPreviewLayoutProps = {
  readonly children: ReactNode;
};

const previewLinks = [
  {
    href: "contact-business",
    label: "Contact business notification",
  },
  {
    href: "contact-confirmation",
    label: "Contact confirmation",
  },
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
}: WorkspaceEmailPreviewLayoutProps) {
  const locale = await getRequestLocale();

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 font-black text-3xl text-navy-blue tracking-tight">
          {m.emailPreviewTitle({}, { locale })}
        </h1>
        <nav
          aria-label={m.emailPreviewNavigationLabel({}, { locale })}
          className="mb-4 flex flex-wrap gap-2"
        >
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
        {children}
      </div>
    </main>
  );
}
