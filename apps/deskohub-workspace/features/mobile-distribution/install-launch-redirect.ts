"use client";

import { useEffect } from "react";
import { browserInstallEnvironment } from "./install-environment";

/** Where the installed web app lives; its manifest's start URL and scope. */
export const webAppPath = "/app/";

export type InstallLaunchSignals = {
  readonly standalone: boolean;
  readonly historyLength: number;
  readonly referrer: string;
  readonly pathname: string;
};

/**
 * Whether this page load is the installed web app opening on the page it was
 * added from instead of its start URL. iOS may keep the page a visitor added
 * to the Home Screen when it lies outside the manifest's scope; such a launch
 * runs standalone with a fresh history and no referrer.
 */
export const isMisplacedInstallLaunch = ({
  standalone,
  historyLength,
  referrer,
  pathname,
}: InstallLaunchSignals): boolean =>
  standalone &&
  historyLength === 1 &&
  referrer === "" &&
  !pathname.startsWith(webAppPath);

/** Sends a misplaced Home Screen launch on to the installed web app. */
export const useInstallLaunchRedirect = (): void => {
  useEffect(() => {
    const misplaced = isMisplacedInstallLaunch({
      standalone:
        browserInstallEnvironment()?.getSnapshot().standalone ?? false,
      historyLength: history.length,
      referrer: document.referrer,
      pathname: location.pathname,
    });
    if (misplaced) location.replace(webAppPath);
  }, []);
};
