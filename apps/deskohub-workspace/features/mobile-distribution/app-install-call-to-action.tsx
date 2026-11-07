"use client";

import Interpolate from "@doist/react-interpolate";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink as Link } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { androidAppIntentUrl } from "./install-android-app";
import { type AppInstallDecision, decideAppInstall } from "./install-decision";
import {
  browserInstallEnvironment,
  type InstallEnvironment,
} from "./install-environment";

const subscribeToInstallEnvironment = (onChange: () => void) =>
  browserInstallEnvironment()?.subscribe(onChange) ?? (() => undefined);
const getInstallEnvironment = () => browserInstallEnvironment()?.getSnapshot();
const getServerInstallEnvironment = (): InstallEnvironment | undefined =>
  undefined;
const promptWebAppInstall = () => {
  void browserInstallEnvironment()?.promptInstall();
};

/**
 * The site-wide install offer. It renders nothing on the server and during
 * hydration, then the one offer that fits the visitor's browser, and nothing
 * until the Android app lookup has answered.
 */
export function AppInstallCallToAction({
  locale,
}: {
  readonly locale: Locale;
}) {
  const pathname = usePathname();
  const environment = useSyncExternalStore(
    subscribeToInstallEnvironment,
    getInstallEnvironment,
    getServerInstallEnvironment
  );

  if (environment?.androidAppInstalled === undefined) return null;

  return (
    <AppInstallOffer
      decision={decideAppInstall({
        ...environment,
        androidAppInstalled: environment.androidAppInstalled,
        onAndroidDownloadPage: pathname === `/${locale}/android`,
      })}
      locale={locale}
      onInstallWebApp={promptWebAppInstall}
    />
  );
}

/** The control for one install decision, on the footer's dark background. */
export function AppInstallOffer({
  decision,
  locale,
  onInstallWebApp,
}: {
  readonly decision: AppInstallDecision;
  readonly locale: Locale;
  readonly onInstallWebApp: () => void;
}) {
  if (decision === "none") return null;

  return (
    <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sunset-yellow">
        {m.appInstallLabel({}, { locale })}
      </p>
      {
        {
          "open-android-app": (
            <Button asChild>
              <a href={androidAppIntentUrl}>
                {m.appInstallOpenAndroidApp({}, { locale })}
              </a>
            </Button>
          ),
          "download-android": (
            <Button asChild>
              <Link href={`/${locale}/android`}>
                {m.appInstallDownloadAndroid({}, { locale })}
              </Link>
            </Button>
          ),
          "ios-add-to-home-screen": (
            <p className="max-w-xl text-sm leading-6 text-white/78">
              <Interpolate
                string={m.appInstallIosInstructions({}, { locale })}
                mapping={{
                  app: (content) => (
                    <a
                      href="/app/"
                      className="underline underline-offset-4 transition-colors hover:text-sunset-yellow"
                    >
                      {content}
                    </a>
                  ),
                }}
              />
            </p>
          ),
          "install-web-app": (
            <Button type="button" onClick={onInstallWebApp}>
              {m.appInstallWebApp({}, { locale })}
            </Button>
          ),
        }[decision]
      }
    </div>
  );
}
