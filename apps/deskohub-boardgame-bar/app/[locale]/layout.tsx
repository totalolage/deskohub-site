import "../globals.css";

import { Effect } from "effect";
import { getLocale, locales } from "@/features/i18n";
import { LocalizedNextComponent } from "@/features/localization/localized-next-component";
import RootLayout from "../rootLayout";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// LocalizedLayout provides middleware that allows getLocale to resolve locale
export default LocalizedNextComponent.build(
  Effect.fn("LocalizedLayout")(
    function* ({ children }) {
      yield* Effect.logDebug("Building");
      return <RootLayout locale={getLocale()}>{children}</RootLayout>;
    },
    (effect) =>
      effect.pipe(
        Effect.annotateLogs({
          operation: "LocalizedLayout",
        })
      )
  )
);
