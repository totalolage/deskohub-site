import { AuthView } from "@neondatabase/auth-ui";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

const authPaths = ["sign-in", "sign-out"] as const;

const hankenGrotesk = localFont({
  src: "../../../../../../deskohub-workspace-mobile/assets/fonts/HankenGrotesk-Variable.ttf",
  display: "swap",
});

export function generateStaticParams() {
  return authPaths.map((path) => ({ path }));
}

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountAuthMetadataTitle({}, { locale }),
    description: m.accountAuthMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

type AuthPageProps = {
  readonly params: Promise<{ readonly path: string }>;
  readonly searchParams: Promise<{ readonly redirectTo?: string }>;
};

export default async function AuthPage({
  params,
  searchParams,
}: AuthPageProps) {
  const { path } = await params;
  if (!authPaths.some((authPath) => authPath === path)) notFound();
  const requestedRedirect = (await searchParams).redirectTo;

  return runWithRequestLocale((locale) => {
    const redirectTo = getSafeAuthRedirect(requestedRedirect, locale);
    return (
      <main
        className={`${hankenGrotesk.className} min-h-screen bg-[#F8F9FA] px-4 pb-12 pt-[calc(var(--site-header-height)+2rem)] text-[#191C1D] sm:px-6 sm:pb-16`}
      >
        <div className="mx-auto flex min-h-[calc(100dvh-var(--site-header-height)-4rem)] w-full max-w-lg items-center justify-center">
          <AuthView
            path={path}
            redirectTo={redirectTo}
            className="w-full max-w-[24.375rem] gap-0 rounded-lg border-[#E0C0B0] bg-white py-0 text-[#191C1D] shadow-none [--neon-border:#E0C0B0] [--neon-card:#FFFFFF] [--neon-card-foreground:#191C1D] [--neon-input:#E0C0B0] [--neon-muted:#F3F4F5] [--neon-muted-foreground:#584236] [--neon-primary-foreground:#FFFFFF] [--neon-primary:#9C4400] [--neon-ring:#9C4400]"
            classNames={{
              header:
                "justify-items-center gap-2 px-6 pb-0 pt-8 text-center sm:px-8",
              title:
                "!text-[2rem] !font-medium !leading-[1.15] tracking-[-0.02em] text-[#191C1D]",
              description: "max-w-[19rem] !text-sm !leading-5 text-[#584236]",
              content: "!gap-0 px-6 pb-8 pt-6 sm:px-8",
              form: {
                base: "!gap-5",
                label: "text-sm font-semibold text-[#191C1D]",
                input:
                  "!h-12 !rounded-sm !border-[#E0C0B0] !bg-white !px-4 !py-2 !text-base !text-[#191C1D] !shadow-none placeholder:!text-[#584236]/70 focus-visible:!border-[#9C4400] focus-visible:!ring-[#9C4400]/20",
                button:
                  "!h-12 !rounded-sm !text-base !font-semibold !shadow-none",
                primaryButton:
                  "!bg-[#9C4400] !text-white hover:!bg-[#7B3500] focus-visible:!border-[#9C4400] focus-visible:!ring-[#9C4400]/25",
                error: "text-sm text-[#BA1A1A]",
              },
            }}
          />
        </div>
      </main>
    );
  });
}

const getSafeAuthRedirect = (value: string | undefined, locale: Locale) => {
  if (!value) return `/${locale}/account`;
  if (value === "/") return value;
  try {
    const url = new URL(value, "https://workspace.invalid");
    const scheme = url.searchParams.get("scheme") ?? "";
    const challenge = url.searchParams.get("challenge") ?? "";
    if (
      url.origin === "https://workspace.invalid" &&
      url.pathname === "/api/v1/mobile-auth/handoff" &&
      /^[A-Za-z0-9_-]{43}$/.test(challenge) &&
      (scheme === "deskohub-workspace" ||
        /^deskohub-workspace-preview-p\d+-s[0-9a-f]{8}$/.test(scheme)) &&
      [...url.searchParams.keys()].every((key) =>
        ["challenge", "scheme", "x-vercel-protection-bypass"].includes(key)
      )
    ) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Fall through to the ordinary account destination.
  }
  return `/${locale}/account`;
};
