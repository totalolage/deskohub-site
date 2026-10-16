"use client";

import { m } from "@/features/administration/i18n";
import { AdministrationRouteFallback } from "@/features/administration/route-fallback";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";

export default function AdministrationErrorPage({
  retry,
}: {
  readonly retry: () => void;
}) {
  const locale = useRouteLocale();

  return (
    <AdministrationRouteFallback
      title={m.shellErrorTitle({}, { locale })}
      description={m.shellErrorDescription({}, { locale })}
      action={
        <Button type="button" onClick={retry}>
          {m.shellErrorRetry({}, { locale })}
        </Button>
      }
    />
  );
}
