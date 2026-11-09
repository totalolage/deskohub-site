import { createParaglideLocaleBridge } from "@deskohub/i18n/effect";
import {
  createRequestLocaleScope,
  scopeAmbientLocaleToRequest,
} from "@deskohub/i18n/request-locale";
import { env } from "@/env";
import { LocaleValue } from "@/features/localization/locale-value";
import {
  baseLocale,
  type Locale,
  overwriteGetLocale,
  overwriteServerAsyncLocalStorage,
  overwriteSetLocale,
} from "../paraglide/runtime";

export const requestLocaleScope = createRequestLocaleScope<Locale>({
  origin: env.NEXT_PUBLIC_DOMAIN,
  overwriteServerAsyncLocalStorage,
});

// Server components call `setLocale()` and then read messages without an
// explicit locale, so keep that ambient locale inside each request.
scopeAmbientLocaleToRequest(requestLocaleScope, {
  baseLocale,
  overwriteGetLocale,
  overwriteSetLocale,
});

export const { runWithLocale: runAppWithLocale } = createParaglideLocaleBridge({
  localeTag: LocaleValue,
  scope: requestLocaleScope,
});
