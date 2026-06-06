"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";

export function LocalizedLink({ href, ...props }: ComponentProps<typeof Link>) {
  const locale = useLocale();
  const localizedHref =
    typeof href === "string" ? getLocalizedHref(href, locale) : href;

  return <Link href={localizedHref} {...props} />;
}
