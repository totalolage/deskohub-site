import { useParams } from "next/navigation";
import type { RouteParams } from "@/app/[lang]/route";
import { baseLocale, type Locale } from "@/i18n";

export function useLocale(): Locale {
  const { lang } = useParams<Partial<RouteParams>>();
  return lang ?? baseLocale;
}
