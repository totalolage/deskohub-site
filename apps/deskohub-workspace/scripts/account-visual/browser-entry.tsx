import { createRoot } from "react-dom/client";
import { AccountPage } from "@/features/account/components/account-page";
import "../../app/globals.css";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { accountVisualFixture } from "./default-adapter";
import { markUnavailableActions } from "./renderer-availability";
import { useNavigationState } from "./stubs/next-navigation";
import {
  type AccountVisualAdapter,
  type AccountVisualAdapterMetadata,
  type AccountVisualAdapterProps,
  type AccountVisualLocale,
  defaultAccountVisualAdapterMetadata,
  isAccountVisualScreen,
} from "./types";

function ActionAvailabilityBoundary({
  children,
}: {
  readonly children: ReactNode;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    markUnavailableActions();
    const observer = new MutationObserver(markUnavailableActions);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["disabled"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scopeRef} data-account-visual-action-scope>
      {children}
    </div>
  );
}

const screenFromLocation = (): AccountVisualAdapterProps["screen"] => {
  const candidate = new URLSearchParams(window.location.search).get("screen");
  return isAccountVisualScreen(candidate) ? candidate : "profile";
};

function Renderer({
  Adapter,
  locale,
  metadata,
}: {
  readonly Adapter: AccountVisualAdapter;
  readonly locale: AccountVisualLocale;
  readonly metadata: AccountVisualAdapterMetadata;
}) {
  useNavigationState();
  const screen = screenFromLocation();

  return (
    <ActionAvailabilityBoundary>
      <div
        data-account-visual-mode="component-only"
        data-account-visual-screen={screen}
        data-account-visual-adapter-owner={metadata.owner}
        data-account-visual-adapter-fixture={metadata.fixture}
      >
        <Adapter screen={screen} locale={locale} />
      </div>
    </ActionAvailabilityBoundary>
  );
}

export function mountAccountVisual(
  adapter: AccountVisualAdapter = DefaultAccountAdapter,
  metadata: AccountVisualAdapterMetadata = defaultAccountVisualAdapterMetadata,
  locale: AccountVisualLocale = "en-US"
) {
  const rootElement = document.getElementById("account-visual-root");
  if (!rootElement) throw new Error("Account visual root is missing");
  createRoot(rootElement).render(
    <Renderer Adapter={adapter} locale={locale} metadata={metadata} />
  );
}

export function DefaultAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return <AccountPage locale={locale} state={accountVisualFixture} />;
}
