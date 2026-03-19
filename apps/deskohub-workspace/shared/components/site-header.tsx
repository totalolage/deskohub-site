import Link from "next/link";
import { LanguageSwitcher, type WorkspaceLocale } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { HorizontalLogo, Logo } from "@/shared/components/logo";
import { MobileMenu } from "@/shared/components/mobile-menu";
import { cn } from "@/shared/utils";

type SiteHeaderProps = {
  locale: WorkspaceLocale;
  languageSwitcherPath: string;
  languageLabels: Record<WorkspaceLocale, string>;
  links: Array<{ label: string; href: string }>;
  contactLabel: string;
};

export function SiteHeader({
  locale,
  languageSwitcherPath,
  languageLabels,
  links,
  contactLabel,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-navy-blue/10 bg-white/95 backdrop-blur">
      <Container className="flex min-h-20 items-center justify-between gap-4 max-w-7xl">
        <Link href={languageSwitcherPath} className="shrink-0">
          <HorizontalLogo
            styling={{ color: "light", variant: "color" }}
            className="justify-start xl:flex hidden"
          />
          <Logo
            styling={{ color: "light", variant: "color" }}
            height={64}
            className="xl:hidden block"
          />
        </Link>

        <nav aria-label="primary" className="hidden items-center gap-6 lg:flex">
          {links.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "py-4 text-navy-blue/80 transition-colors hover:text-burned-orange text-center",
                index === links.length - 1 &&
                  "rounded-full bg-burned-orange px-4 py-1.5 font-semibold text-white hover:text-white hover:bg-burned-orange/90"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block">
          <LanguageSwitcher
            currentLocale={locale}
            pathname={languageSwitcherPath}
            labels={languageLabels}
          />
        </div>

        <MobileMenu
          currentLocale={locale}
          languageSwitcherPath={languageSwitcherPath}
          languageLabels={languageLabels}
          links={links}
          contactLabel={contactLabel}
        />
      </Container>
    </header>
  );
}
