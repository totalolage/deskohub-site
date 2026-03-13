import { createNextRoute, RequestValue } from "@deskohub/i18n/api";
import { extractLocaleFromRequest } from "@/features/i18n";
import { LocaleValue } from "@/features/localization/effect-locale";

export { RequestValue };

export const NextRoute = createNextRoute({
  localeTag: LocaleValue,
  extractLocaleFromRequest,
});
