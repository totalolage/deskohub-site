import { createParaglideLocaleBridge } from "@deskohub/i18n/effect";
import { env } from "@/env";
import { LocaleValue } from "@/features/localization/locale-value";
import {
  overwriteServerAsyncLocalStorage,
  setLocale,
} from "../paraglide/runtime";

export const { runWithLocale: runAppWithLocale } = createParaglideLocaleBridge({
  localeTag: LocaleValue,
  origin: env.NEXT_PUBLIC_DOMAIN,
  setLocale,
  overwriteServerAsyncLocalStorage,
});
