import { LanguageSwitcher, m, type WorkspaceLocale } from "@/features/i18n";
import HorizontalLogo from "@/features/shared/logo/horizontal";
import { cn } from "@/shared/utils";
import { Container } from "./container";
import { MobileMenu } from "./mobile-menu";

type SiteHeaderProps = {
  locale: WorkspaceLocale;
  languageSwitcherPath: string;
  links: Array<{ label: string; href: string }>;
  contactLabel: string;
};

export function SiteHeader({
  locale,
  languageSwitcherPath,
  links,
  contactLabel,
}: SiteHeaderProps) {
  const languageLabels = {
    "en-US": m.languageEnglish({}, { locale }),
    "cs-CZ": m.languageCzech({}, { locale }),
  } satisfies Record<WorkspaceLocale, string>;

  return (
    <header className="sticky top-0 z-20 border-b border-navy-blue/10 bg-white/95 backdrop-blur">
      <Container className="flex min-h-20 items-center justify-between gap-4">
        <a href="/">
          <HorizontalLogo
            styling={{ color: "light", variant: "color" }}
            className="justify-start"
          />
        </a>

        <nav aria-label="primary" className="hidden items-center gap-6 md:flex">
          {links.map((item, index) => (
            <a
              key={item.label}
              href={item.href}
              className={cn(
                "py-4 text-navy-blue/80 transition-colors hover:text-burned-orange",
                index === links.length - 1 &&
                  "rounded-full bg-burned-orange px-4 py-1.5 font-semibold text-white hover:text-white hover:bg-burned-orange/90"
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
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
