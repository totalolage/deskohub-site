import type { ComponentProps } from "react";
import {
  // biome-ignore lint/style/noRestrictedImports: the app's Text wraps it
  Text as NativeText,
  // biome-ignore lint/style/noRestrictedImports: the app's TextInput wraps it
  TextInput as NativeTextInput,
} from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { useProvidedAppLocale } from "../i18n/locale-context";
import { localeTextStyle, textFontFamily } from "./text-style";

type TextProps = ComponentProps<typeof NativeText> & {
  /** The language the text is in when it isn't the app's, such as a language's own name. */
  readonly locale?: AppLocale;
};

/**
 * React Native's Text, set in the font for the script of the app's locale
 * (or of `locale`): see `localeTextStyle`. Style the app's text through it;
 * React Native's own is banned by lint.
 */
export function Text({ locale, style, ...props }: TextProps) {
  const appLocale = useProvidedAppLocale();
  return (
    <NativeText
      {...props}
      style={localeTextStyle(style, locale ?? appLocale)}
    />
  );
}

/**
 * React Native's TextInput, set in the font for the script of the app's
 * locale (see `localeTextStyle`). A change of font remounts the input:
 * Android keeps a mounted input's family when the style drops it.
 */
export function TextInput({
  style,
  ...props
}: ComponentProps<typeof NativeTextInput>) {
  const locale = useProvidedAppLocale();
  return (
    <NativeTextInput
      {...props}
      key={
        locale === undefined ? "default" : (textFontFamily(locale) ?? "system")
      }
      style={localeTextStyle(style, locale)}
    />
  );
}
