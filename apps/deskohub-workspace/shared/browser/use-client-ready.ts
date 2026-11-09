"use client";

import { useSyncExternalStore } from "react";

const subscribeToClientReady = () => () => undefined;
const getClientReadySnapshot = () => true;
const getServerClientReadySnapshot = () => false;

/**
 * Whether this render runs in the browser after hydration. It is `false`
 * during server rendering and hydration, so browser-only state can't cause a
 * hydration mismatch.
 */
export const useClientReady = () =>
  useSyncExternalStore(
    subscribeToClientReady,
    getClientReadySnapshot,
    getServerClientReadySnapshot
  );
