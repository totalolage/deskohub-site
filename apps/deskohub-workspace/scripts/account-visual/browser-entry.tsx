import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { resolveAccountVisualScreen } from "./account-route";
import { DefaultAccountAdapter } from "./default-adapter";
import { markUnavailableActions } from "./renderer-availability";
import { useNavigationState } from "./stubs/next-navigation";
import {
  type AccountVisualAdapter,
  type AccountVisualAdapterMetadata,
  type AccountVisualAdapterProps,
  type AccountVisualLocale,
  defaultAccountVisualAdapterMetadata,
} from "./types";

export { DefaultAccountAdapter } from "./default-adapter";

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
  return resolveAccountVisualScreen({
    pathname: window.location.pathname,
    search: window.location.search,
  });
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
