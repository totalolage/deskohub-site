"use client";

import { useSyncExternalStore } from "react";
import {
  browserInstallEnvironment,
  type InstallEnvironment,
} from "./install-environment";

const subscribeToInstallEnvironment = (onChange: () => void) =>
  browserInstallEnvironment()?.subscribe(onChange) ?? (() => undefined);
const getInstallEnvironment = () => browserInstallEnvironment()?.getSnapshot();
const getServerInstallEnvironment = (): InstallEnvironment | undefined =>
  undefined;

/**
 * The window's install environment, kept current. `undefined` on the server
 * and during hydration, so install offers render nothing until it is known.
 */
export const useInstallEnvironment = (): InstallEnvironment | undefined =>
  useSyncExternalStore(
    subscribeToInstallEnvironment,
    getInstallEnvironment,
    getServerInstallEnvironment
  );

/** Shows the browser's captured install prompt, if it has one. */
export const promptWebAppInstall = (): void => {
  void browserInstallEnvironment()?.promptInstall();
};
