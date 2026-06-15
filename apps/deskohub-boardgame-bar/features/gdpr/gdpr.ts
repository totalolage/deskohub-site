import { Effect } from "effect";
import { LocaleValue } from "../localization/effect-locale";
import { gdprTextsByLocale } from "./texts";

export const GPDRText = Effect.gen(function* () {
  const locale = yield* LocaleValue;
  return gdprTextsByLocale[locale];
});
