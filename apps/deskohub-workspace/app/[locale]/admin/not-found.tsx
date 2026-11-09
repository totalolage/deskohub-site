import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { AdministrationRouteFallback } from "@/features/administration/route-fallback";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";

export default async function AdministrationNotFoundPage() {
  const locale = await getRequestLocale();

  return (
    <AdministrationRouteFallback
      eyebrow="404"
      title={m.shellNotFoundTitle({}, { locale })}
      description={m.shellNotFoundDescription({}, { locale })}
      action={
        <Button asChild>
          <AdministrationLink href={administrationHref("/[locale]/admin")}>
            {m.shellNotFoundOverviewLink({}, { locale })}
          </AdministrationLink>
        </Button>
      }
    />
  );
}
