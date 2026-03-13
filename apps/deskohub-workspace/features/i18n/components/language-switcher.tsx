import Link from "next/link";
import {
  type WorkspaceLocale,
  withLocalePrefix,
  workspaceLocales,
} from "../routing";

type LanguageSwitcherProps = {
  currentLocale: WorkspaceLocale;
  pathname: string;
  labels: Record<WorkspaceLocale, string>;
};

export function LanguageSwitcher({
  currentLocale,
  pathname,
  labels,
}: LanguageSwitcherProps) {
  return (
    <nav aria-label="language switcher" className="workspace-pill">
      {workspaceLocales.map((locale, index) => {
        const href = withLocalePrefix(pathname, locale);
        const isCurrent = locale === currentLocale;

        return (
          <span key={locale}>
            {index > 0 ? " | " : ""}
            {isCurrent ? (
              <strong>{labels[locale]}</strong>
            ) : (
              <Link href={href}>{labels[locale]}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
