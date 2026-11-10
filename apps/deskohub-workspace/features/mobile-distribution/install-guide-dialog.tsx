"use client";

import type { Locale } from "@/features/i18n";
import type { InstallGuide } from "./install-guide";

/**
 * The illustrated add-to-Home-Screen guide.
 *
 * Contract for #1200, filled in by the guide stream: keep the name and props.
 */
export function InstallGuideDialog(_props: {
  readonly guide: InstallGuide;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly locale: Locale;
}) {
  return null;
}
