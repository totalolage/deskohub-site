import { createRequestLocaleScope } from "@deskohub/i18n/request-locale";
import {
  type Locale,
  overwriteServerAsyncLocalStorage,
} from "../paraglide/runtime.js";

export const requestLocaleScope = createRequestLocaleScope<Locale>({
  overwriteServerAsyncLocalStorage,
});
