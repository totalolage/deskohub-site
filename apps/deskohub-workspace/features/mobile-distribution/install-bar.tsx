"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useVisitorConsentAnswered } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import Logo from "@/shared/components/logo/logo";
import { Button } from "@/shared/components/ui/button";
import {
  recordInstallBarClose,
  recordInstallBarPageView,
} from "./install-bar-dismissal";
import { decideInstallBarOffer } from "./install-bar-offer";
import { detectInstallGuide, type InstallGuide } from "./install-guide";
import { InstallGuideDialog } from "./install-guide-dialog";
import {
  promptWebAppInstall,
  useInstallEnvironment,
} from "./use-install-environment";

/** Bottom space the bar takes while it shows, for pages to keep clear. */
const installBarSpaceProperty = "--install-bar-space";

/** Keeps `--install-bar-space` on the document at the bar's height. */
const reserveInstallBarSpace = (element: HTMLElement) => {
  const { style } = document.documentElement;
  const observer = new ResizeObserver(() =>
    style.setProperty(installBarSpaceProperty, `${element.offsetHeight}px`)
  );
  observer.observe(element);
  return () => {
    observer.disconnect();
    style.removeProperty(installBarSpaceProperty);
  };
};

/**
 * Bars shown inside a dialog, such as the reservation status opened over the
 * account. The page's floating bar steps back while one is open, since the
 * dialog hides it.
 */
const dialogBars = new Set<symbol>();
const dialogBarListeners = new Set<() => void>();
const notifyDialogBars = () => {
  for (const listener of dialogBarListeners) listener();
};
const subscribeToDialogBars = (onChange: () => void) => {
  dialogBarListeners.add(onChange);
  return () => dialogBarListeners.delete(onChange);
};
const hasDialogBar = () => dialogBars.size > 0;
const useDialogBarRegistration = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    const bar = Symbol("install-bar");
    dialogBars.add(bar);
    notifyDialogBars();
    return () => {
      dialogBars.delete(bar);
      notifyDialogBars();
    };
  }, [active]);
};

/** Where focus goes when the bar closes: the page's main content. */
const focusMainContent = () => {
  document.getElementById("main-content")?.focus({ preventScroll: true });
};

/**
 * Where the bar sits: floating above the page's bottom edge, or at the bottom
 * of a dialog's scrolling content.
 */
export type InstallBarPlacement = "page" | "dialog";

/**
 * The "Install the Deskohub app" bar for signed-in pages on phones and
 * tablets. It renders nothing on the server and during hydration, waits
 * for the cookie banner to be answered, and follows the visitor's close
 * schedule (`install-bar-dismissal.ts`). Install shows the browser's own
 * prompt where there is one, else the add-to-Home-Screen guide.
 */
export function InstallBar({
  locale,
  placement,
}: {
  readonly locale: Locale;
  readonly placement: InstallBarPlacement;
}) {
  const environment = useInstallEnvironment();
  const consentAnswered = useVisitorConsentAnswered();
  const pathname = usePathname();
  const offer = environment ? decideInstallBarOffer(environment) : "none";
  // Each page view where the bar applies counts toward the visit, so the
  // record follows client navigations as well as loads.
  const offeredPage = offer === "none" ? undefined : pathname;
  const [dismissed, setDismissed] = useState<boolean>();
  const [guide, setGuide] = useState<InstallGuide>();
  const [guideOpen, setGuideOpen] = useState(false);
  const installButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogBarOpen = useSyncExternalStore(
    subscribeToDialogBars,
    hasDialogBar,
    () => false
  );
  const shown =
    environment !== undefined &&
    offer !== "none" &&
    consentAnswered &&
    dismissed === false;
  useDialogBarRegistration(shown && placement === "dialog");

  useEffect(() => {
    if (offeredPage === undefined) return;
    setDismissed(recordInstallBarPageView());
  }, [offeredPage]);

  if (!environment || !shown || (placement === "page" && dialogBarOpen)) {
    return null;
  }

  const { platform } = environment;
  const install = () => {
    if (offer === "prompt") {
      promptWebAppInstall();
      return;
    }
    // Focus first: the guide hands focus back to whatever had it, and iOS
    // Safari doesn't focus a tapped button.
    installButton.current?.focus();
    setGuide(
      detectInstallGuide({
        platform,
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
      })
    );
    setGuideOpen(true);
  };

  const close = () => {
    recordInstallBarClose();
    setDismissed(true);
    // Inside a dialog its focus trap keeps focus there.
    if (placement === "page") focusMainContent();
  };

  return (
    <>
      <div
        className={
          {
            page: "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2.5 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
            dialog: "pointer-events-none sticky bottom-0 z-10 px-2.5 pt-2 pb-3",
          }[placement]
        }
        ref={placement === "page" ? reserveInstallBarSpace : undefined}
      >
        <section
          aria-labelledby={titleId}
          className="pointer-events-auto mx-auto flex max-w-md items-center gap-2.5 rounded-[18px] bg-white py-3 pr-2.5 pl-3 shadow-[0_0_0_1px_#E4DFD5,0_12px_28px_-10px_rgba(0,2,79,0.45)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4 motion-safe:duration-300"
        >
          <Logo
            alt=""
            className="h-[41px] w-9 flex-none"
            height={41}
            styling={{ color: "light", variant: "color" }}
            width={36}
          />
          <p
            className="min-w-0 flex-1 font-semibold text-[15px] text-navy-blue leading-5"
            id={titleId}
          >
            {m.installBarTitle({}, { locale })}
          </p>
          <Button className="flex-none" onClick={install} ref={installButton}>
            {m.installBarInstall({}, { locale })}
          </Button>
          <Button
            aria-label={m.installBarClose({}, { locale })}
            className="flex-none"
            onClick={close}
            size="icon-sm"
            tone="muted"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </section>
      </div>
      {guide && (
        <InstallGuideDialog
          guide={guide}
          locale={locale}
          onOpenChange={setGuideOpen}
          open={guideOpen}
        />
      )}
    </>
  );
}
