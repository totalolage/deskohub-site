"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  type AdministrationHref,
  localizeAdministrationHref,
} from "./administration-href";

/**
 * Links an administration path from `administrationHref` to its page in the
 * current route locale.
 */
export function AdministrationLink({
  href,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href"> & {
  readonly href: AdministrationHref;
}) {
  const locale = useRouteLocale();
  return (
    <NextLink
      {...props}
      href={localizeAdministrationHref(href, locale)}
      prefetch={false}
    />
  );
}

/** A linked summary of a related record on an administration detail page. */
export function AdministrationRecordLink(
  props: Omit<ComponentProps<typeof AdministrationLink>, "className">
) {
  return (
    <AdministrationLink
      {...props}
      className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
    />
  );
}
