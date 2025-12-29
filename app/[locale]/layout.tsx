import { Next } from "@mcrovero/effect-nextjs";
import { Effect } from "effect";
import { baseLocale, getLocale, type Locale, locales } from "@/features/i18n";
import RootLayout from "../rootLayout";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

class LocaleService extends Effect.Service<LocaleService>()("LocaleService", {
  succeed: {
    locale: Effect.try(getLocale).pipe(
      Effect.orElse(() => Effect.succeed<Locale>(baseLocale))
    ),
  },
  accessors: true,
}) {}

// Layout with parallel routes support
const LocalizedLayout = Effect.fn("LocalizedLayout")(function* (
  props: LayoutProps<"/[locale]">
) {
  const locale = yield* LocaleService.locale;

  return <RootLayout {...props} locale={locale} />;
});

export default Next.make("LocalizedLayout", LocaleService.Default).build(
  LocalizedLayout
);
