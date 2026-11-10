"use client";

import Interpolate from "@doist/react-interpolate";
import { Portal } from "@radix-ui/react-dialog";
import { Check, Copy } from "lucide-react";
import { type CSSProperties, useState, useSyncExternalStore } from "react";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils";
import {
  type InstallGuide,
  type InstallGuideArrow,
  installGuideArrow,
  type ScreenOrientation,
} from "./install-guide";
import {
  InstallGuideIllustration,
  type InstallGuidePicture,
} from "./install-guide-illustrations";

/**
 * The illustrated add-to-Home-Screen guide. Where the browser's toolbar is
 * known, an arrow outside the card points at the control for the first step,
 * and the card moves to the opposite edge so it doesn't cover it.
 */
export function InstallGuideDialog({
  guide,
  open,
  onOpenChange,
  locale,
}: {
  readonly guide: InstallGuide;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly locale: Locale;
}) {
  const orientation = useScreenOrientation();
  const arrow = installGuideArrow(guide, orientation);
  const inAppBrowser = guide.kind === "in-app-browser";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0",
          arrow &&
            {
              "bottom-right": "top-4 max-h-[calc(100dvh-7rem)] translate-y-0",
              "bottom-center": "top-4 max-h-[calc(100dvh-7rem)] translate-y-0",
              "top-right":
                "top-auto bottom-4 max-h-[calc(100dvh-7rem)] translate-y-0",
            }[arrow]
        )}
        locale={locale}
        onOpenAutoFocus={(event) => {
          // Start at the first step: focusing the first button would scroll
          // a tall guide to its end on a small phone.
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
      >
        <div className="overflow-y-auto overscroll-contain p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg leading-6">
              {m.installGuideTitle({}, { locale })}
            </DialogTitle>
            <DialogDescription>
              {inAppBrowser
                ? {
                    ios: m.installGuideInAppIosDescription({}, { locale }),
                    android: m.installGuideInAppAndroidDescription(
                      {},
                      { locale }
                    ),
                  }[guide.platform]
                : m.installGuideDescription({}, { locale })}
            </DialogDescription>
          </DialogHeader>
          <ol className="mt-4 grid gap-3">
            {guideSteps(guide, orientation, locale).map((step, index) => (
              <li
                className="grid grid-cols-[4.5rem_1fr] items-center gap-3"
                key={step.picture}
              >
                <div className="relative">
                  <InstallGuideIllustration picture={step.picture} />
                  <span
                    aria-hidden
                    className="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-navy-blue text-xs font-semibold text-white"
                  >
                    {index + 1}
                  </span>
                </div>
                <p className="text-sm leading-5 text-navy-blue">
                  <Interpolate mapping={{ b: <strong /> }} string={step.text} />
                </p>
              </li>
            ))}
          </ol>
          {guide.kind === "other-ios-browser" && (
            <OpenElsewhere
              hint={m.installGuideOtherBrowserHint({}, { locale })}
              locale={locale}
            />
          )}
          {guide.kind === "in-app-browser" && (
            <OpenElsewhere
              hint={
                {
                  ios: m.installGuideCopyLinkIosHint({}, { locale }),
                  android: m.installGuideCopyLinkAndroidHint({}, { locale }),
                }[guide.platform]
              }
              locale={locale}
            />
          )}
          {guide.kind === "unidentified" && (
            <p className="mt-4 text-sm leading-5 text-navy-blue/65">
              {m.installGuideGenericHint({}, { locale })}
            </p>
          )}
          <div className="mt-5 flex justify-end">
            <DialogClose asChild>
              <Button variant="secondary">
                {m.installGuideDone({}, { locale })}
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
      {arrow && <GuideArrow target={arrow} />}
    </Dialog>
  );
}

type GuideStep = {
  readonly picture: InstallGuidePicture;
  readonly text: string;
};

/**
 * The steps for a guide. Where the toolbar's position in landscape isn't
 * known, the first step names the control without saying where it is.
 */
const guideSteps = (
  guide: InstallGuide,
  orientation: ScreenOrientation,
  locale: Locale
): readonly GuideStep[] => {
  const addToHomeScreen: GuideStep = {
    picture: "share-sheet",
    text: m.installGuideStepAddToHomeScreen({}, { locale }),
  };
  const add: GuideStep = {
    picture: "confirm-add",
    text: m.installGuideStepAdd({}, { locale }),
  };
  const openAsWebApp: GuideStep = {
    picture: "web-app-switch",
    text: m.installGuideStepOpenAsWebApp({}, { locale }),
  };
  const findIcon: GuideStep = {
    picture: "home-screen",
    text: m.installGuideStepFindIcon({}, { locale }),
  };

  switch (guide.kind) {
    case "safari": {
      const confirm = guide.generation === "liquid-glass" ? openAsWebApp : add;
      if (guide.device === "ipad") {
        return [
          {
            picture: "toolbar-top",
            text: m.installGuideStepShareTopRight({}, { locale }),
          },
          addToHomeScreen,
          confirm,
          findIcon,
        ];
      }
      if (guide.generation === "liquid-glass") {
        return [
          {
            picture: "toolbar-compact",
            text: {
              portrait: m.installGuideStepSafariMore({}, { locale }),
              landscape: m.installGuideStepSafariMoreLandscape({}, { locale }),
            }[orientation],
          },
          {
            picture: "menu-share",
            text: m.installGuideStepMenuShare({}, { locale }),
          },
          addToHomeScreen,
          confirm,
          findIcon,
        ];
      }
      return [
        {
          portrait: {
            picture: "toolbar-bottom",
            text: m.installGuideStepShareBottom({}, { locale }),
          } as const,
          landscape: {
            picture: "menu-share",
            text: m.installGuideStepMenuShare({}, { locale }),
          } as const,
        }[orientation],
        addToHomeScreen,
        confirm,
        findIcon,
      ];
    }
    case "chrome-ios":
      return [
        {
          picture: "toolbar-top",
          text: m.installGuideStepShareAddressBar({}, { locale }),
        },
        {
          picture: "share-sheet",
          text: m.installGuideStepChromeAddToHomeScreen({}, { locale }),
        },
        add,
        findIcon,
      ];
    case "other-ios-browser":
      return [
        {
          picture: "menu-share",
          text: m.installGuideStepOtherShare({}, { locale }),
        },
        addToHomeScreen,
        add,
        findIcon,
      ];
    case "in-app-browser":
      return [
        {
          picture: "app-menu",
          text: m.installGuideStepInAppMenu({}, { locale }),
        },
        {
          picture: "menu-open-browser",
          text: {
            ios: m.installGuideStepInAppOpenSafari({}, { locale }),
            android: m.installGuideStepInAppOpenBrowser({}, { locale }),
          }[guide.platform],
        },
        {
          picture: "home-screen",
          text: m.installGuideStepInAppContinue({}, { locale }),
        },
      ];
    case "android-browser":
      return [
        {
          picture: "toolbar-menu",
          text: m.installGuideStepAndroidMenu({}, { locale }),
        },
        {
          picture: "menu-add",
          text: m.installGuideStepAndroidAdd({}, { locale }),
        },
        {
          picture: "confirm-add",
          text: m.installGuideStepAndroidConfirm({}, { locale }),
        },
        findIcon,
      ];
    case "unidentified":
      return [
        {
          picture: "menu-share",
          text: m.installGuideStepGenericMenu({}, { locale }),
        },
        {
          picture: "share-sheet",
          text: m.installGuideStepGenericAdd({}, { locale }),
        },
        findIcon,
      ];
  }
};

/**
 * For browsers that can't add to the Home Screen, or might not: how to move
 * to one that can, and the page link to take along.
 */
function OpenElsewhere({
  hint,
  locale,
}: {
  readonly hint: string;
  readonly locale: Locale;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [link, setLink] = useState("");

  const copyLink = async () => {
    const href = window.location.href;
    setLink(href);
    try {
      await navigator.clipboard.writeText(href);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <div className="mt-4 grid gap-2 rounded-xl bg-navy-blue/[0.04] p-3">
      <p className="text-sm leading-5 text-navy-blue/75">{hint}</p>
      <Button
        className="justify-self-start"
        onClick={copyLink}
        size="sm"
        tone="outline"
        variant="ghost"
      >
        {copy === "copied" ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {m.installGuideCopyLink({}, { locale })}
      </Button>
      <p aria-live="polite" className="text-sm leading-5 text-navy-blue/75">
        {copy === "copied" && m.installGuideLinkCopied({}, { locale })}
        {copy === "failed" && m.installGuideLinkCopyFailed({}, { locale })}
      </p>
      {copy === "failed" && (
        <input
          aria-label={m.installGuideCopyLink({}, { locale })}
          className="w-full rounded-md border border-navy-blue/15 bg-white px-2 py-1 text-sm text-navy-blue"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={link}
        />
      )}
    </div>
  );
}

/**
 * Points out of the dialog at the browser control past the viewport edge.
 * Portalled outside the dialog card because the card is transformed, which
 * would pin a fixed child to the card instead of the viewport. The dialog's
 * own portal renders only while open and never on the server.
 */
function GuideArrow({ target }: { readonly target: InstallGuideArrow }) {
  return (
    <Portal>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed z-[60] size-16 text-chilean-fire duration-300 animate-in fade-in-0",
          {
            "bottom-right": "bottom-1 right-2",
            "bottom-center": "bottom-1 left-1/2 -translate-x-1/2",
            "top-right": "top-1 right-10",
          }[target]
        )}
      >
        <svg
          aria-hidden
          className="install-guide-arrow size-full"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={4}
          style={
            {
              "--nudge-x": target === "bottom-center" ? "0px" : "4px",
              "--nudge-y": target === "top-right" ? "-6px" : "6px",
            } as CSSProperties
          }
          viewBox="0 0 64 64"
        >
          <style>
            {
              "@keyframes install-guide-nudge{50%{transform:translate(var(--nudge-x),var(--nudge-y))}}@media (prefers-reduced-motion:no-preference){.install-guide-arrow{animation:install-guide-nudge 1.4s ease-in-out infinite}}"
            }
          </style>
          {
            {
              "bottom-right": (
                <path d="M14 8c18 4 32 18 36 44M38 46l12 8 6-14" />
              ),
              "bottom-center": <path d="M32 6v50M20 44l12 12 12-12" />,
              "top-right": <path d="M14 56c18-4 32-18 36-44M38 18l12-8 6 14" />,
            }[target]
          }
        </svg>
      </div>
    </Portal>
  );
}

const orientationQuery = "(orientation: landscape)";

/** The screen orientation, updated as the visitor turns the device. */
const useScreenOrientation = (): ScreenOrientation =>
  useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(orientationQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () =>
      window.matchMedia(orientationQuery).matches ? "landscape" : "portrait",
    () => "portrait"
  );
