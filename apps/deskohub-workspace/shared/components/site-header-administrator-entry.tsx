"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { type ReactNode, Suspense, use } from "react";
import { GuardedLink as Link } from "@/shared/components/guarded-link";
import type { SiteHeaderAdministratorEntry } from "@/shared/components/site-header-config";
import { Button } from "@/shared/components/ui/button";

type AdministratorEntryProps = {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly onNavigate?: () => void;
};

function WhenAdministrator({
  entry,
  children,
}: {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly children: ReactNode;
}) {
  return use(entry.visible) && children;
}

/** Renders only once the server confirms an administrator; nothing before. */
function AdministratorOnly(props: {
  readonly entry: SiteHeaderAdministratorEntry;
  readonly children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <WhenAdministrator {...props} />
    </Suspense>
  );
}

/**
 * The filled Admin button beside the account control. While the full
 * navigation shares the bar below 1440px, it shrinks to its icon.
 */
export function AdministratorEntryButton({
  entry,
  onNavigate,
}: AdministratorEntryProps) {
  return (
    <AdministratorOnly entry={entry}>
      <Button
        asChild
        variant="primary"
        tone="chilean-fire"
        size="sm"
        caps
        className="hidden shrink-0 md:inline-flex xl:max-[90rem]:hidden"
      >
        <Link href={entry.href} onClick={onNavigate}>
          <ShieldCheck className="size-4" aria-hidden />
          {entry.label}
        </Link>
      </Button>
      <Button
        asChild
        variant="primary"
        tone="chilean-fire"
        size="icon"
        className="hidden shrink-0 xl:max-[90rem]:inline-flex"
      >
        <Link
          href={entry.href}
          aria-label={entry.label}
          title={entry.label}
          onClick={onNavigate}
        >
          <ShieldCheck className="size-4" aria-hidden />
        </Link>
      </Button>
    </AdministratorOnly>
  );
}

/** The full-width Admin button at the top of the mobile menu. */
export function AdministratorEntryMenuButton({
  entry,
  onNavigate,
}: AdministratorEntryProps) {
  return (
    <AdministratorOnly entry={entry}>
      <Button
        asChild
        variant="primary"
        tone="chilean-fire"
        size="xl"
        caps
        fullWidth
      >
        <Link href={entry.href} onClick={onNavigate}>
          <ShieldCheck className="size-5" aria-hidden />
          {entry.label}
          <ArrowRight className="ml-auto size-5" aria-hidden />
        </Link>
      </Button>
    </AdministratorOnly>
  );
}

/**
 * The strip docked under the header bar. `data-site-header-admin-ribbon`
 * adds its height to `--site-header-height` (see `app/globals.css`).
 */
export function AdministratorRibbon({
  entry,
  onNavigate,
}: AdministratorEntryProps) {
  return (
    <AdministratorOnly entry={entry}>
      <div
        data-site-header-admin-ribbon
        className="h-(--site-header-admin-ribbon-height) border-b border-navy-blue/20 bg-sunset-yellow text-navy-blue"
      >
        <div className="mx-auto flex h-full w-full max-w-8xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
          <span className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            <span className="truncate sm:hidden">{entry.label}</span>
            <span className="hidden truncate sm:inline">
              {entry.ribbonLabel}
            </span>
          </span>
          <Button
            asChild
            variant="primary"
            tone="navy-blue"
            size="sm"
            caps
            className="shrink-0"
          >
            <Link href={entry.href} onClick={onNavigate}>
              {entry.ribbonActionLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </AdministratorOnly>
  );
}
