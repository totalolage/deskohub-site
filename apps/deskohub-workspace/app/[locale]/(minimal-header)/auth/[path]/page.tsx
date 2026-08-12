import { AuthView } from "@neondatabase/auth-ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

const authPaths = ["sign-in", "sign-out"] as const;

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
      <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f7f5ee] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
        <div className="relative mx-auto flex max-w-lg justify-center">
          <AuthView
            path={path}
            redirectTo={redirectTo}
            className="border-[#cbc8bf] bg-[#fffefa]/96 shadow-[0_32px_100px_-48px_rgba(0,2,79,0.55)]"
            cardHeader={
              path === "sign-in" ? (
                <AuthCardHeader locale={locale} />
              ) : undefined
            }
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

function AuthCardHeader({ locale }: { readonly locale: Locale }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
        {m.accountAuthEyebrow({}, { locale })}
      </p>
      <h1 className="text-3xl text-navy-blue">
        {m.accountAuthTitle({}, { locale })}
      </h1>
      <p className="text-sm leading-6 text-navy-blue/68">
        {m.accountAuthDescription({}, { locale })}
      </p>
    </div>
  );
}
