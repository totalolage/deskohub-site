import { RouteParams } from "@/app/[lang]/route";
import { useParams } from "next/navigation";
import { baseLocale, Locale } from "@/i18n";

export function useLocale(): Locale {
  const { lang } = useParams<Partial<RouteParams>>();
  return lang ?? baseLocale;
}
