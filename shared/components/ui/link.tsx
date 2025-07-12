import NextLink, { type LinkProps } from "next/link";
import { useLocale } from "@/i18n/utils/use-locale";
import { ComponentProps } from "react";

export function Link(props: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  return <NextLink {...props} key={locale} />;
}
