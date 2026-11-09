import { createLocaleActionMiddleware } from "@deskohub/i18n/action";
import { baseLocale } from "@/features/i18n";
import { resolveActionLocale } from "@/features/i18n/server/action-locale";
import { requestLocaleScope } from "@/features/i18n/server/request-locale-scope";

export const localeMiddleware = createLocaleActionMiddleware({
  resolveLocale: resolveActionLocale,
  fallbackLocale: baseLocale,
  scope: requestLocaleScope,
});
