import { Effect } from "effect";
import type { ReactNode } from "react";
import { setLocale } from "@/features/i18n";
import {
  LocaleValue,
  parseLocaleProps,
} from "@/features/localization/effect-locale";
import { runAppWithLocale } from "../i18n/utils/setup-server";

export const LocalizedNextComponent = {
  build:
    <Props>(
      component: (props: Props) => Effect.Effect<ReactNode, never, LocaleValue>
    ) =>
    (props: Props) => {
      const next = component(props);

      return Effect.runPromise(
        Effect.gen(function* () {
          const { locale } = yield* parseLocaleProps(props);

          setLocale(locale, { reload: false });
          return yield* runAppWithLocale(next).pipe(
            Effect.provideService(LocaleValue, locale)
          );
        }).pipe(
          Effect.tapError(Effect.logError),
          Effect.annotateLogs({
            operation: "LocalizedNextComponent.build",
          })
        )
      );
    },
};

export type LocalizedNextComponent<Props = void> = (
  props: Props
) => Effect.Effect<ReactNode, never, LocaleValue>;
