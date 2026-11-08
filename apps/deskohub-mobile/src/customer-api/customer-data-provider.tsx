import { RegistryProvider } from "@effect/atom-react";
import type { Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { type ReactNode, useState } from "react";
import type { AccountSession } from "./account-scoped-storage";
import { liveCustomerDataLayer } from "./customer-data-live";
import {
  type CustomerDataServices,
  customerDataLayer,
} from "./customer-data-runtime";
import { SampleDataBanner } from "./sample-data-banner";
import {
  nextSampleAccountKind,
  resolveSampleDataMode,
  type SampleAccountKind,
} from "./sample-data-mode";

const sampleDataMode = resolveSampleDataMode({
  isDevelopmentBuild: __DEV__,
  flag: process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA,
  kind: process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_KIND,
});

// Metro inlines `__DEV__` and EXPO_PUBLIC_ values and drops this branch from
// release bundles, so the fake Workspace and its fixtures never ship there; a
// static import would bundle them.
const sampleLayerFor:
  | ((kind: SampleAccountKind) => Layer.Layer<CustomerDataServices>)
  | undefined =
  __DEV__ && process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_DATA === "1"
    ? (
        require("./testing/sample-data-layer") as typeof import("./testing/sample-data-layer")
      ).sampleCustomerDataLayer
    : undefined;

/**
 * Gives the signed-in screens one data registry per account: switching
 * accounts (or sample states) mounts a fresh registry, so no cached data,
 * read budget or in-flight request crosses over. Signing in again as the same
 * account (reauthentication) keeps the registry.
 */
export function CustomerDataProvider({
  accountId,
  sessionStartedAt,
  children,
}: AccountSession & { readonly children: ReactNode }) {
  const [sampleKind, setSampleKind] = useState<SampleAccountKind | undefined>(
    sampleDataMode.enabled ? sampleDataMode.kind : undefined
  );
  return (
    <AccountRegistry
      key={`${accountId}/${sampleKind ?? "live"}`}
      session={{ accountId, sessionStartedAt }}
      sampleKind={sampleKind}
    >
      {sampleKind === undefined ? (
        children
      ) : (
        <SampleDataBanner
          kind={sampleKind}
          onNextKind={() => setSampleKind(nextSampleAccountKind(sampleKind))}
        >
          {children}
        </SampleDataBanner>
      )}
    </AccountRegistry>
  );
}

/** One account's registry, seeded once with the session it opened under. */
function AccountRegistry({
  session,
  sampleKind,
  children,
}: {
  readonly session: AccountSession;
  readonly sampleKind: SampleAccountKind | undefined;
  readonly children: ReactNode;
}) {
  const [initialValues] = useState(() => [
    Atom.initialValue(
      customerDataLayer,
      sampleKind !== undefined && sampleLayerFor !== undefined
        ? sampleLayerFor(sampleKind)
        : liveCustomerDataLayer(session)
    ),
  ]);
  return (
    <RegistryProvider initialValues={initialValues}>
      {children}
    </RegistryProvider>
  );
}
