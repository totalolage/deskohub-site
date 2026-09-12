import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { Schema } from "effect";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";
import { getAccountScreenCopy } from "../../features/account/components/account-screen-copy";
import { m } from "../../features/i18n";
import {
  accountMetricRegionGeometry,
  accountMetricRegionsByScreen,
  calculateRegionMetrics,
  calculateRgbMetrics,
  comparisonPaddingColor,
  makeAbsoluteRgbDifference,
  makeFiftyFiftyOverlay,
  makeTopLeftComparisonCanvas,
  type RgbaImage,
  type RgbMetrics,
  type TopLeftPlacement,
} from "./metrics";
import {
  type AccountVisualAdapterMetadata,
  type AccountVisualComparisonMetadata,
  type AccountVisualLocale,
  type AccountVisualScreen,
  accountVisualHistoricalBaselineComparabilityReason,
  accountVisualIterationComparabilityRule,
  accountVisualRendererMethodVersion,
  accountVisualScreens,
  isAccountVisualLocale,
} from "./types";

const repoRoot = resolve(import.meta.dir, "../../../..");
const appRoot = resolve(import.meta.dir, "../..");
const defaultOutputRoot = "/tmp/opencode/pr239-account-redesign/visual";
const referencePrefix = "e318512b-b78b-4780-8d86-7dcd43cc3d1f-";
const referenceSuffixes = {
  profile: "fab0fa57-710e-4a5c-9807-a8ada402931b.png",
  billing: "66145089-33ba-4150-92ac-242a4e6f2973.png",
  legal: "0eaa9de2-637f-413f-bdca-98e9dd02650b.png",
  danger: "392b223d-725e-4718-8ea6-6850792317e8.png",
  reservations: "49ca0eec-85be-41bb-a8c6-7cfac690311f.png",
} as const satisfies Record<AccountVisualScreen, string>;
const menuReferenceSuffix = "a519a69f-b101-48ec-ba71-e9d4f1218110.png";
const actualGlobalsPath = join(appRoot, "app/globals.css");
const actualAccountPagePath = join(
  appRoot,
  "features/account/components/account-page.tsx"
);
const fontPaths = {
  regular: join(appRoot, "assets/fonts/Sculpin/regular.woff2"),
  italic: join(appRoot, "assets/fonts/Sculpin/italic.woff2"),
} as const;
const rendererEntryPath = join(import.meta.dir, "browser-entry.tsx");
const defaultAdapterPath = join(import.meta.dir, "default-adapter.tsx");
const populatedAdapterPath = join(import.meta.dir, "populated-adapter.tsx");
const rendererCssPath = join(import.meta.dir, "renderer.css");
const postCssConfigPath = join(appRoot, "postcss.config.mjs");
const fixedClockIso = "2026-11-10T10:00:00.000Z";
const fixedClockMilliseconds = Date.parse(fixedClockIso);
const timeZone = "Europe/Prague";
const referenceLocale: AccountVisualLocale = "en-US";
const defaultRendererPort = 3111;
const desktopDeviceScaleFactor = 2;
const desktopCssWidth = 1280;
const desktopPhysicalWidth = desktopCssWidth * desktopDeviceScaleFactor;
const tabletDeviceScaleFactor = 1;
const tabletCssWidth = 768;
const mobileCssWidths = [375, 320] as const;
const mobileCssHeight = 900;
const actionControlIds = [
  "account-profile-submit",
  "account-sign-out",
  "delete-account-confirm",
  "delete-account-reauth-send",
] as const;
const defaultFixtureReport = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Example",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const;

const nativeSyntheticInteractionDrafts = {
  firstName: "Ada Native",
  phone: "+420 777 000 111",
  billing: {
    companyName: "Native Validation Workspace s.r.o.",
    companyId: "98765432",
    vatId: "CZ98765432",
    addressLine1: "Synthetic Street 42",
    addressLine2: "Suite 5",
    city: "Prague",
    zip: "110 00",
    country: "CZ",
  },
} as const satisfies NativeSyntheticInteractionDrafts;

const nativeInvalidObservationKey =
  "__accountVisualNativeInvalidObservations" as const;

export const desktopCssHeightForReference = (
  referencePhysicalHeight: number,
  deviceScaleFactor = desktopDeviceScaleFactor
) => Math.max(1, Math.round(referencePhysicalHeight / deviceScaleFactor));

type DesktopCaptureSettings = {
  readonly mode: "standard" | "tablet";
  readonly cssWidth: number;
  readonly deviceScaleFactor: number;
  readonly physicalWidth: number;
};

const getDesktopCaptureSettings = (tablet: boolean): DesktopCaptureSettings =>
  tablet
    ? {
        mode: "tablet",
        cssWidth: tabletCssWidth,
        deviceScaleFactor: tabletDeviceScaleFactor,
        physicalWidth: tabletCssWidth * tabletDeviceScaleFactor,
      }
    : {
        mode: "standard",
        cssWidth: desktopCssWidth,
        deviceScaleFactor: desktopDeviceScaleFactor,
        physicalWidth: desktopPhysicalWidth,
      };

const sharp = createRequire(join(repoRoot, "packages/osm/package.json"))(
  "sharp"
) as SharpModule;

type SharpRawInfo = {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
};

type SharpRawResult = {
  readonly data: Buffer;
  readonly info: SharpRawInfo;
};

type SharpPipeline = {
  ensureAlpha: () => SharpPipeline;
  metadata: () => Promise<{
    readonly format?: string;
    readonly width?: number;
    readonly height?: number;
    readonly channels?: number;
  }>;
  png: () => SharpPipeline;
  raw: () => SharpPipeline;
  toBuffer: (options?: {
    readonly resolveWithObject?: boolean;
  }) => Promise<SharpRawResult | Buffer>;
};

type SharpInput =
  | string
  | Uint8Array
  | {
      readonly data: Buffer;
      readonly raw: {
        readonly width: number;
        readonly height: number;
        readonly channels: 4;
      };
    };

type SharpModule = (
  input: SharpInput,
  options?: {
    readonly raw?: {
      readonly width: number;
      readonly height: number;
      readonly channels: 4;
    };
  }
) => SharpPipeline;

type CliOptions = {
  readonly adapterPath?: string;
  readonly help: boolean;
  readonly label: string;
  readonly locale: AccountVisualLocale;
  readonly outputRoot: string;
  readonly port: number;
  readonly referencesDir: string;
  readonly screen?: AccountVisualScreen;
  readonly tablet: boolean;
};

type ReferenceAsset = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: string | null;
  readonly width: number;
  readonly height: number;
  readonly channels: number | null;
  readonly image: RgbaImage;
};

type SourceFile = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

type BrowserProblem = {
  readonly kind: "page-error" | "console-error" | "blocked-external-request";
  readonly message: string;
};

type ScreenSelection = {
  readonly requestedScreen: AccountVisualScreen;
  readonly status: "selected" | "adapter-defined" | "failed";
  readonly method:
    | "desktop-nav-button"
    | "mobile-nav-button"
    | "adapter-defined"
    | "none";
  readonly sectionLabel: string | null;
  readonly selectedValue: string | null;
  readonly selectedAriaCurrent: string | null;
  readonly targetSelector: string | null;
  readonly targetVisible: boolean | null;
  readonly targetText: string | null;
  readonly detail: string;
};

type MobileSectionNavigation = {
  readonly status: "passed" | "adapter-defined" | "failed";
  readonly method: "mobile-nav-button" | "adapter-defined" | "none";
  readonly requestedScreen: AccountVisualScreen;
  readonly alternateScreen: AccountVisualScreen | null;
  readonly selectedBefore: string | null;
  readonly selectedAlternate: string | null;
  readonly selectedAfter: string | null;
  readonly failures: readonly string[];
};

type DraftPersistenceReport = {
  readonly status: "passed" | "adapter-defined" | "failed";
  readonly method: "fresh-real-page-mobile-menu" | "adapter-defined" | "none";
  readonly scope: "private-account-sections" | "adapter-defined";
  readonly note: string;
  readonly submitted: false;
  readonly firstName: string | null;
  readonly companyName: string | null;
  readonly failures: readonly string[];
};

type NativeInvalidObservation = {
  readonly targetId: string;
  readonly targetName: string;
  readonly targetTag: string;
  readonly targetVisible: boolean;
  readonly targetValidityValid: boolean;
};

type NativeControlValidity = {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly validityValid: boolean;
};

const nativeInvalidObservationSchema = Schema.Struct({
  targetId: Schema.String,
  targetName: Schema.String,
  targetTag: Schema.String,
  targetVisible: Schema.Boolean,
  targetValidityValid: Schema.Boolean,
});
const nativeInvalidObservationsSchema = Schema.Array(
  nativeInvalidObservationSchema
);
const nativeActionInvocationCountSchema = Schema.Union([
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  Schema.Null,
]);

type NativeValidationControl = {
  readonly mounted: boolean;
  readonly visible: boolean;
  readonly value: string | null;
  readonly required: boolean | null;
  readonly validityValid: boolean | null;
};

type NativeValidationPanels = {
  readonly profile: boolean;
  readonly billing: boolean;
  readonly selectors: {
    readonly profile: "[data-slot='profile-screen']";
    readonly billing: "#account-profile-billing-kind -> ancestor section";
  };
};

type NativeSyntheticBillingDrafts = {
  readonly companyName: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly zip: string;
  readonly country: string;
};

type NativeSyntheticInteractionDrafts = {
  readonly firstName: string;
  readonly phone: string;
  readonly billing: NativeSyntheticBillingDrafts;
};

type NativeValidationSubmission = {
  readonly method: "HTMLFormElement.requestSubmit() via page.evaluate";
  readonly blockedByNativeValidation: boolean;
  readonly invalidEventSource: "requestSubmit";
  readonly formValidityValid: boolean;
  readonly eligibleControlValidity: readonly NativeControlValidity[];
  readonly requestSubmitInvalidEvents: readonly NativeInvalidObservation[];
  readonly visiblePanels: NativeValidationPanels;
  readonly firstName: NativeValidationControl;
  readonly companyName: NativeValidationControl;
  readonly phone: NativeValidationControl;
  readonly identityControlsValid: boolean;
};

type NativeValidationReport = {
  readonly status: "passed" | "failed";
  readonly method: "fresh-browser-context-native-request-submit";
  readonly adapter: string;
  readonly fixture: string;
  readonly context: "fresh-context-after-original-capture";
  readonly initialScreenshotsUntouched: true;
  readonly prohibitedOperations: {
    readonly dispatchedInvalidEvent: false;
    readonly unhiddenDom: false;
    readonly enabledBackendActionControls: false;
  };
  readonly navigation: {
    readonly initialProfile: ScreenSelection;
    readonly billing: ScreenSelection;
    readonly backToProfile: ScreenSelection;
  } | null;
  readonly syntheticInteractionDrafts: NativeSyntheticInteractionDrafts;
  readonly firstSubmission: NativeValidationSubmission | null;
  readonly secondSubmission: NativeValidationSubmission | null;
  readonly draftsAfterSecondSubmission: {
    readonly firstName: string | null;
    readonly phone: string | null;
    readonly billing: NativeSyntheticBillingDrafts;
    readonly preserved: boolean;
  } | null;
  readonly actionInvocationCount: {
    readonly initial: number | null;
    readonly beforeFirstSubmission: number | null;
    readonly afterFirstSubmission: number | null;
    readonly beforeSecondSubmission: number | null;
    readonly afterSecondSubmission: number | null;
  };
  readonly backendActionControls: readonly UnavailableActionStatus[];
  readonly expectedBrowserDiagnostics: readonly BrowserProblem[];
  readonly browserProblems: readonly BrowserProblem[];
  readonly pageErrors: readonly string[];
  readonly failures: readonly string[];
};

type PublicLegalNavigationReturn = {
  readonly section: "profile" | "billing";
  readonly pathname: string;
  readonly search: string;
  readonly selected: boolean;
  readonly targetVisible: boolean;
  readonly metadataScreen: string | null;
};

type PublicLegalNavigationReport = {
  readonly status: "passed" | "failed";
  readonly simulation: "visual-fixture-only";
  readonly authentication: "not-proved";
  readonly legalPathname: string | null;
  readonly cookiePreferencesVisible: boolean;
  readonly archiveDisabled: boolean;
  readonly consentChanges: {
    readonly analyticsEnabled: boolean;
    readonly analyticsDisabled: boolean;
    readonly acceptAll: boolean;
    readonly rejectAll: boolean;
    readonly persistedAfterRouteReturn: boolean;
  };
  readonly returns: readonly PublicLegalNavigationReturn[];
  readonly failures: readonly string[];
};

const productionSectionTargets = {
  reservations: "#account-reservations-current-title",
  profile: "[data-slot='profile-screen']",
  billing: "#account-profile-billing-kind",
  legal: "a[href$='/privacy-policy']",
  danger: "#delete-account-trigger",
} as const satisfies Record<AccountVisualScreen, string>;

const publicLegalCookieCategories = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
] as const;

type PublicLegalConsentState = Record<
  (typeof publicLegalCookieCategories)[number],
  boolean
>;

const waitForPublicLegalConsentState = async (
  page: Page,
  expected: PublicLegalConsentState
): Promise<boolean> => {
  try {
    await page.waitForFunction(
      (expectedState) =>
        Object.entries(expectedState).every(([category, expectedChecked]) => {
          const control = document.getElementById(
            `cookie-category-${category}`
          );
          return (
            control instanceof HTMLButtonElement &&
            control.getAttribute("aria-checked") === String(expectedChecked) &&
            control.disabled === (category === "necessary")
          );
        }),
      expected,
      { timeout: 5_000 }
    );
    return true;
  } catch {
    return false;
  }
};

const waitForPublicLegalControlDisabled = async (
  control: Locator,
  expectedDisabled: boolean
): Promise<boolean> => {
  try {
    await expect
      .poll(() => control.isDisabled(), { timeout: 5_000 })
      .toBe(expectedDisabled);
    return true;
  } catch {
    return false;
  }
};

const verifiedLoginEmailExplanationTexts = [
  "This email has been successfully verified.",
  "Tento e-mail byl úspěšně ověřen.",
] as const;

const verifiedLoginEmailStatusTexts = [
  "Verified",
  "Verified login email",
  "Email verified",
  "Ověřený přihlašovací e-mail",
  "Ověřený e-mail",
  "E-mail ověřen",
  ...verifiedLoginEmailExplanationTexts,
] as const;

type MainCapture = {
  readonly png: Buffer;
  readonly cssDimensions: {
    readonly width: number;
    readonly height: number;
  };
  readonly boundingRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly kind: "main" | "document-fallback";
};

type UnavailableActionStatus = {
  readonly id: (typeof actionControlIds)[number];
  readonly status: "not-available";
  readonly present: boolean;
  readonly disabled: boolean | null;
  readonly label: "Unavailable in component renderer";
  readonly dataUnavailable: boolean | null;
  readonly actionDataUnavailable: boolean | null;
  readonly nativeTitle: string | null;
  readonly ariaDescription: string | null;
  readonly reason:
    | "component-renderer backend unavailable"
    | "metadata-incomplete"
    | "not-rendered";
};

type MobileFunctionalReport = {
  readonly profileInput: {
    readonly status: "passed" | "not-available" | "failed";
    readonly editedValue?: string;
    readonly nativeValidationAfterClear?: boolean;
  };
  readonly deletionConfirmation: {
    readonly status: "passed" | "not-available" | "failed";
    readonly opened: boolean;
    readonly finalActionDisabled: boolean | null;
    readonly cancelled: boolean;
  };
  readonly navigation: {
    readonly status: "passed" | "not-available" | "failed";
    readonly method: "router-refresh" | "anchor" | "none";
    readonly detail: string;
  };
  readonly failures: readonly string[];
};

type ComputedStyleRect = {
  readonly coordinateSpace: "css-pixels" | "physical-pixels";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
};

type CssRect = Omit<ComputedStyleRect, "coordinateSpace">;

type TextRangeEvidence = {
  readonly text: string;
  readonly selector: string;
  readonly rects: readonly CssRect[];
  readonly withinBoundary: boolean;
  readonly withinViewportHorizontally: boolean;
  readonly offscreenVertically: boolean;
  readonly partiallyVisibleVertically: boolean;
  readonly withinMain: boolean;
  readonly clippedByBoundary: boolean;
  readonly clippedByViewportHorizontally: boolean;
  readonly clippedByMain: boolean;
};

type HeaderReadabilityEvidence = {
  readonly status: "passed" | "failed" | "not-applicable";
  readonly reason: string;
  readonly selector: string | null;
  readonly text: string | null;
  readonly cssRect: CssRect | null;
  readonly computedStyle: {
    readonly fontSize: string | null;
    readonly lineHeight: string | null;
  };
  readonly availableLayoutWidth: {
    readonly viewport: number;
    readonly main: number | null;
    readonly header: number | null;
    readonly effective: number | null;
  };
  readonly minimumHeadingWidth: number | null;
  readonly headingWidth: number | null;
  readonly lineCount: number | null;
  readonly lineHeightPx: number | null;
  readonly textHeight: number | null;
  readonly wrapped: boolean | null;
  readonly singleWordGlyphWrapping: boolean | null;
  readonly wordGlyphWrapping: boolean | null;
  readonly textRangeRects: readonly CssRect[];
  readonly failures: readonly string[];
};

type EmailTextEvidence = {
  readonly text: string;
  readonly selector: string;
  readonly rects: readonly CssRect[];
  readonly withinField: boolean;
  readonly withinViewportHorizontally: boolean;
  readonly offscreenVertically: boolean;
  readonly partiallyVisibleVertically: boolean;
  readonly clippedByField: boolean;
  readonly clippedByViewportHorizontally: boolean;
  readonly readable: boolean;
};

type EmailContainmentEvidence = {
  readonly status: "passed" | "failed" | "not-applicable";
  readonly profileSelector: "[data-slot='profile-screen']";
  readonly fieldSelector: string | null;
  readonly fieldRect: CssRect | null;
  readonly viewport: {
    readonly cssWidth: number;
    readonly cssHeight: number;
  };
  readonly email: EmailTextEvidence | null;
  readonly statusText: EmailTextEvidence | null;
  readonly reason: string;
  readonly failures: readonly string[];
};

type InitialDomProbe = {
  readonly capturedBeforeMutation: true;
  readonly captureTiming: string;
  readonly locale: AccountVisualLocale;
  readonly viewport: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly deviceScaleFactor: number;
  };
  readonly mainRect: CssRect | null;
  readonly headerRect: CssRect | null;
  readonly headerReadability: HeaderReadabilityEvidence;
  readonly textRanges: {
    readonly header: readonly TextRangeEvidence[];
    readonly main: readonly TextRangeEvidence[];
  };
  readonly emailContainment: EmailContainmentEvidence;
  readonly failures: readonly string[];
};

type SelectedEmailProbe = {
  readonly capturedAfterSelection: true;
  readonly captureTiming: string;
  readonly requestedScreen: AccountVisualScreen;
  readonly expectedSelectedProfile: boolean;
  readonly selectionStatus: ScreenSelection["status"];
  readonly selectedTargetVisible: boolean | null;
  readonly emailContainment: EmailContainmentEvidence;
  readonly failures: readonly string[];
};

type ComputedStyleElement = {
  readonly selector: string;
  readonly tag: string;
  readonly dataSlot: string | null;
  readonly text: string | null;
  readonly visible: boolean;
  readonly boundingRect: {
    readonly css: ComputedStyleRect;
    readonly physical: ComputedStyleRect;
    readonly deviceScaleFactor: number;
  };
  readonly computedStyle: {
    readonly backgroundColor: string;
    readonly backgroundImage: string;
    readonly color: string;
    readonly borderRadius: string;
    readonly display: string;
    readonly fontFamily: string;
    readonly fontSize: string;
    readonly fontWeight: string;
    readonly lineHeight: string;
  };
};

type ComputedStyleTable = {
  readonly table: ComputedStyleElement;
  readonly label: string;
  readonly headers: readonly ComputedStyleElement[];
  readonly rows: readonly {
    readonly row: ComputedStyleElement;
    readonly labels: readonly ComputedStyleElement[];
  }[];
  readonly duplicateRowLabels: readonly string[];
};

type ComputedStyleEvidence = {
  readonly capturedBeforeMutation: true;
  readonly captureTiming: string;
  readonly viewport: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly deviceScaleFactor: number;
  };
  readonly main: ComputedStyleElement | null;
  readonly mainBackground: {
    readonly backgroundColor: string | null;
    readonly backgroundImage: string | null;
  };
  readonly backgroundBearingShell: readonly ComputedStyleElement[];
  readonly headings: readonly ComputedStyleElement[];
  readonly desktopNavigation: {
    readonly selectedButton: ComputedStyleElement | null;
    readonly selectedButtonStyles: {
      readonly color: string;
      readonly backgroundColor: string;
      readonly borderRadius: string;
    } | null;
    readonly sidebar: ComputedStyleElement | null;
  };
  readonly visibleTables: readonly ComputedStyleTable[];
  readonly pastTable: ComputedStyleTable | null;
};

type DesktopEvidence = {
  readonly viewport: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly physicalWidth: number;
    readonly physicalHeight: number;
    readonly deviceScaleFactor: number;
  };
  readonly mainBoundingRect: MainCapture["boundingRect"];
  readonly mainCssDimensions: MainCapture["cssDimensions"];
  readonly mainPhysicalDimensions: {
    readonly width: number;
    readonly height: number;
  };
  readonly captureKind: MainCapture["kind"];
  readonly selection: ScreenSelection;
  readonly routeComponent: string | null;
  readonly initialDomProbe: InitialDomProbe;
  readonly emailProbe: SelectedEmailProbe;
  readonly computedStyles: ComputedStyleEvidence;
  readonly files: {
    readonly main: string;
    readonly comparison: string;
    readonly heatmap: string;
    readonly overlay: string;
  };
  readonly hashes: Record<
    "main" | "comparison" | "heatmap" | "overlay",
    string
  >;
  readonly comparisonPlacement: TopLeftPlacement;
  readonly comparison: {
    readonly coordinateSpace: "reference-physical-pixels";
    readonly referencePhysicalPixels: {
      readonly width: number;
      readonly height: number;
    };
    readonly actualCssPixels: MainCapture["cssDimensions"];
    readonly actualPhysicalPixels: {
      readonly width: number;
      readonly height: number;
    };
    readonly placement: TopLeftPlacement;
  };
  readonly metrics: RgbMetrics;
  readonly regions: {
    readonly header: RgbMetrics;
    readonly sidebar: RgbMetrics;
    readonly content: RgbMetrics;
  };
  readonly adapterMetadata: AccountVisualAdapterMetadata;
  readonly actionAvailability: readonly UnavailableActionStatus[];
  readonly browserProblems: readonly BrowserProblem[];
  readonly functionalFailures: readonly string[];
};

type MobileEvidence = {
  readonly viewport: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly deviceScaleFactor: number;
  };
  readonly selection: ScreenSelection;
  readonly initialDomProbe: InitialDomProbe;
  readonly emailProbe: SelectedEmailProbe;
  readonly focusSelection: ScreenSelection;
  readonly sectionNavigation: MobileSectionNavigation;
  readonly draftPersistence: DraftPersistenceReport;
  readonly publicLegalNavigation: PublicLegalNavigationReport | null;
  readonly computedStyles: ComputedStyleEvidence;
  readonly files: { readonly screenshot: string; readonly focus: string };
  readonly hashes: Record<"screenshot" | "focus", string>;
  readonly horizontalOverflow: {
    readonly viewportWidth: number;
    readonly documentScrollWidth: number;
    readonly bodyScrollWidth: number;
    readonly documentOverflow: boolean;
    readonly bodyOverflow: boolean;
    readonly mainClientWidth: number | null;
    readonly mainScrollWidth: number | null;
    readonly offenders: readonly {
      readonly tag: string;
      readonly id: string;
      readonly className: string;
      readonly rect: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly scrollWidth: number;
      readonly clientWidth: number;
      readonly overflowX: string;
    }[];
  };
  readonly focus: {
    readonly reachable: boolean;
    readonly capture: "same-page-native";
    readonly sequence: readonly {
      readonly tag: string;
      readonly id: string;
      readonly role: string | null;
      readonly label: string;
    }[];
    readonly reportedTarget: {
      readonly tag: string;
      readonly id: string;
      readonly role: string | null;
      readonly label: string;
    } | null;
    readonly activeElement: {
      readonly tag: string;
      readonly id: string;
      readonly role: string | null;
      readonly label: string;
    } | null;
    readonly matchesReportedTarget: boolean;
  };
  readonly actionAvailability: readonly UnavailableActionStatus[];
  readonly functional: MobileFunctionalReport;
  readonly browserProblems: readonly BrowserProblem[];
};

type ScreenReport = {
  readonly screen: AccountVisualScreen;
  readonly reference: {
    readonly filename: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly format: string | null;
    readonly nativeWidth: number;
    readonly nativeHeight: number;
    readonly channels: number | null;
  };
  readonly coverage: {
    readonly status:
      | "rendered"
      | "missing"
      | "selection-failed"
      | "adapter-defined";
    readonly source: "production-account-shell" | "adapter-defined";
    readonly selection: ScreenSelection["status"];
    readonly component: string | null;
    readonly note: string;
  };
  readonly desktop: DesktopEvidence;
  readonly mobile: Record<
    `${(typeof mobileCssWidths)[number]}`,
    MobileEvidence
  >;
};

export const HELP_TEXT = `account-visual renderer

Usage: bun apps/deskohub-workspace/scripts/account-visual/run.ts --label baseline|after|NAME [--screen profile|billing|legal|danger|reservations] [--adapter PATH] [--locale en-US|cs-CZ] [--tablet] [--references DIR] [--output DIR]

API:
  --label selects an immutable output label. If it already exists, -2, -3, and later suffixes are used.
  --screen limits capture to one of the five prescribed screens. Without it, all five are captured.
  --adapter loads a caller-owned default-exported React component receiving { screen, locale } and a named accountVisualAdapterMetadata export with owner and fixture strings. The adapter owns integrated shell and screen composition.
  --locale selects en-US or cs-CZ for the adapter and rendered AccountPage/PublicAccountLegal components. It defaults to en-US.
  --tablet selects a 768 CSS px, DPR 1 desktop/tablet capture instead of the standard 1280 CSS px, DPR 2 capture.
  --references selects the directory containing the supplied reference PNGs.
  --output selects a directory under /tmp/opencode/pr239-account-redesign/visual.
  WORKSPACE_ACCOUNT_VISUAL_PORT selects the exclusive localhost renderer port (default 3111); it must be a decimal integer from 1 through 65535.

  Methodology:
  The browser bundle imports the production AccountPage/PublicAccountLegal components and globals.css. Tailwind PostCSS processes globals.css before Bun emits the standalone browser bundle.
  Backend action, auth, and client-environment boundaries are build-time aliases. Actions return unavailable errors and never success; the renderer disables and labels their controls.
  Each standard screen uses a fresh Chromium context at 1280 CSS px wide, DPR 2, and Math.round(reference physical height / 2) CSS px high. With --tablet, the desktop context is 768 CSS px wide, DPR 1, and Math.round(reference physical height / 1) CSS px high. Odd reference heights therefore round to the nearest integer CSS pixel, with .5 rounding up. Mobile probes use fresh contexts at 375x900 and 320x900, DPR 1.
  The desktop interpretation is chosen, not original capture metadata: 1280 CSS px at DPR 2 produces a 2560 physical-pixel comparison width. A reference sidebar of about 560 physical px maps to about 280 CSS px and an input of about 84 physical px maps to about 42 CSS px, supporting that choice. Reference PNG pixels remain native with no resize. The comparison canvas keeps native reference pixels and top-left crops or pads the actual physical capture; reports distinguish actual CSS dimensions from actual physical pixels. RGB metrics use mean absolute channel error and a max-channel mismatch threshold greater than 16.

  Limitations:
  This is component-only evidence. Full-route site chrome is unavailable here: SiteHeader, PageNavigationBoundary, and PublicSiteFooter are not mounted, and UnsavedChangesProvider is absent so its default confirm=true context is used. Parent integration must prove those boundaries separately.
  Caller-owned adapters compose the integrated account shell and screen content. The built-in route captures AccountPage for simulated private account locations and PublicAccountLegal for the simulated public legal location when the observed route wrapper provides that evidence; no fake screens are created. This simulator does not prove production route or authentication behavior.
  The built-in route initializes the actual local vanilla-cookieconsent library with createConsentConfig(locale) and autoShow=false; the consent banner and analytics runtime are omitted from component-only captures, and screenshots are taken before consent interaction with the default state unmutated.
  Mobile focus PNGs are native screenshots from the same page that received keyboard focus. Carets are hidden and screenshot animations are disabled, but browser focus rasterization can still vary between runs; repeatability is reported, never normalized by painting pixels.
  One renderer process owns the selected localhost port and runs screens sequentially. Screen agents supply adapters; the caller runs after integration and must not run renderer processes concurrently. An occupied port fails without stopping another process.
  The populated adapter also runs one post-capture native-validation probe in a fresh browser context. It uses real requestSubmit() constraint validation, records passive invalid events, and never dispatches invalid events or enables unavailable backend actions.
  Unavailable backend controls retain their actual labels and native disabled styles. The component renderer adds only disabled state, a native title, and data metadata; it does not paint an in-flow annotation or overlay.
  Renderer method version: ${accountVisualRendererMethodVersion}. Historical baseline comparability is false because the prior baseline used a layout-changing unavailable annotation (${accountVisualHistoricalBaselineComparabilityReason}). Iteration comparisons are eligible only when renderer method version, fixture, and locale match. Reference metrics remain direct native PNG comparisons and are not masked.
  Initial DOM probes run before screen selection, screenshots, interaction, focus, or style mutation. They measure the main header h1 and Range text boxes; only inactive section-button text inside a visible, viewport-contained mobile section navigation whose computed overflowX is exactly auto or scroll may be clipped, while the active section button and all other content remain audited. Mobile navigation selection requires the active section button to be fully visible after each navigation. A selected-screen email probe runs after the requested screen is selected but before screenshot, interaction, focus, or style mutation; hidden non-selected profile DOM is not measured. Horizontal overflow and field clipping fail, while ordinary vertical offscreen or partial visibility is recorded without failing.
  No authenticated end-to-end, database, provider, environment, or external-network claim is made. The visual simulator is not proof of production route or authentication behavior. Missing controls and baseline functional failures are reported rather than simulated as successes.
`;

const isAccountVisualScreenValue = (
  value: string
): value is AccountVisualScreen =>
  (accountVisualScreens as readonly string[]).includes(value);

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let adapterPath: string | undefined;
  let help = false;
  let label: string | undefined;
  let locale: AccountVisualLocale = "en-US";
  let outputRoot = defaultOutputRoot;
  let referencesDir = "/home/dev/.t3/userdata/attachments";
  let screen: AccountVisualScreen | undefined;
  let tablet = false;
  const port = parseRendererPort(process.env.WORKSPACE_ACCOUNT_VISUAL_PORT);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--label") {
      label = argv[++index];
      continue;
    }
    if (argument === "--screen") {
      const value = argv[++index];
      if (!value || !isAccountVisualScreenValue(value)) {
        throw new Error(
          "--screen must be profile, billing, legal, danger, or reservations"
        );
      }
      screen = value;
      continue;
    }
    if (argument === "--locale") {
      const value = argv[++index];
      if (!isAccountVisualLocale(value)) {
        throw new Error("--locale must be en-US or cs-CZ");
      }
      locale = value;
      continue;
    }
    if (argument === "--tablet") {
      tablet = true;
      continue;
    }
    if (argument === "--adapter") {
      adapterPath = argv[++index];
      continue;
    }
    if (argument === "--references") {
      referencesDir = argv[++index] ?? "";
      continue;
    }
    if (argument === "--output") {
      outputRoot = argv[++index] ?? "";
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (help) {
    return {
      adapterPath,
      help,
      label: label ?? "baseline",
      locale,
      outputRoot,
      port,
      referencesDir,
      screen,
      tablet,
    };
  }
  if (!label) throw new Error("--label is required; use --help for usage");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error(
      "--label must contain only letters, numbers, dots, underscores, or hyphens"
    );
  }

  return {
    adapterPath,
    help,
    label,
    locale,
    outputRoot,
    port,
    referencesDir,
    screen,
    tablet,
  };
}

export const parseRendererPort = (value: string | undefined): number => {
  if (value === undefined) return defaultRendererPort;
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `WORKSPACE_ACCOUNT_VISUAL_PORT must be a decimal integer from 1 through 65535; received ${JSON.stringify(value)}`
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `WORKSPACE_ACCOUNT_VISUAL_PORT must be a decimal integer from 1 through 65535; received ${JSON.stringify(value)}`
    );
  }
  return port;
};

const isWithin = (parent: string, child: string) => {
  const childRelative = relative(parent, child);
  return (
    childRelative === "" ||
    (!childRelative.startsWith("..") && !isAbsolute(childRelative))
  );
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const displayPath = (filePath: string) => {
  const relativePath = relative(repoRoot, filePath);
  return relativePath === "" || relativePath.startsWith("..")
    ? filePath
    : relativePath;
};

const fileExists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const collectOwnedSourceFiles = async (): Promise<readonly SourceFile[]> => {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((first, second) =>
      first.name.localeCompare(second.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  await visit(import.meta.dir);
  return Promise.all(
    paths.sort().map(async (path): Promise<SourceFile> => {
      const bytes = await readFile(path);
      return {
        path: displayPath(path),
        sha256: sha256(bytes),
        bytes: bytes.length,
      };
    })
  );
};

const appModuleExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

const resolveModulePath = async (basePath: string, specifier: string) => {
  const candidates = [
    basePath,
    ...appModuleExtensions.map((extension) => `${basePath}${extension}`),
    ...appModuleExtensions.map((extension) =>
      join(basePath, `index${extension}`)
    ),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  throw new Error(`Could not resolve module: ${specifier}`);
};

const resolveAppModule = async (specifier: string) =>
  resolveModulePath(join(appRoot, specifier), `@/${specifier}`);

const resolveRelativeModule = async (specifier: string, resolveDir: string) => {
  try {
    return {
      path: await resolveModulePath(resolve(resolveDir, specifier), specifier),
    };
  } catch {
    return undefined;
  }
};

const decodePng = async (source: string | Uint8Array): Promise<RgbaImage> => {
  const result = await sharp(source).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  if (!("data" in result) || result.info.channels !== 4) {
    throw new Error("Sharp did not return a four-channel image");
  }
  return {
    width: result.info.width,
    height: result.info.height,
    data: new Uint8Array(result.data),
  };
};

const encodePng = async (image: RgbaImage): Promise<Buffer> => {
  const result = await sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
  if ("data" in result)
    throw new Error("Sharp returned raw data while encoding PNG");
  return result;
};

const loadReferenceAsset = async (
  referencesDir: string,
  screen: AccountVisualScreen
): Promise<ReferenceAsset> => {
  const filename = `${referencePrefix}${referenceSuffixes[screen]}`;
  const path = join(referencesDir, filename);
  const bytes = await readFile(path);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Reference image has no dimensions: ${filename}`);
  }
  return {
    path,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    format: metadata.format ?? null,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels ?? null,
    image: await decodePng(bytes),
  };
};

const loadMenuMetadata = async (referencesDir: string) => {
  const filename = `${referencePrefix}${menuReferenceSuffix}`;
  const path = join(referencesDir, filename);
  const bytes = await readFile(path);
  const metadata = await sharp(bytes).metadata();
  return {
    filename,
    path,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    format: metadata.format ?? null,
    nativeWidth: metadata.width ?? null,
    nativeHeight: metadata.height ?? null,
    channels: metadata.channels ?? null,
  } as const;
};

const frozenClockScript = `(() => {
  const RealDate = Date;
  const fixedNow = ${fixedClockMilliseconds};
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedNow] : args));
    }
    static now() {
      return fixedNow;
    }
  }
  Object.defineProperty(globalThis, "Date", {
    configurable: true,
    value: FrozenDate,
    writable: true,
  });
})();`;

const accountActionsStubPath = join(
  import.meta.dir,
  "stubs/account-actions.ts"
);
const authClientStubPath = join(import.meta.dir, "stubs/auth-client.ts");
const analyticsIdentityStubPath = join(
  import.meta.dir,
  "stubs/analytics-identity.ts"
);
const nextLinkStubPath = join(import.meta.dir, "stubs/next-link.tsx");
const nextNavigationStubPath = join(
  import.meta.dir,
  "stubs/next-navigation.ts"
);
const serverOnlyStubPath = join(
  import.meta.dir,
  "stubs/server-only-fail-closed.ts"
);
const componentRendererEnvNamespace = "account-visual-component-renderer-env";

const createBuildPlugin = (): Bun.BunPlugin => ({
  name: "account-visual-tailwind-postcss",
  setup(build) {
    const exactAliases = new Map([
      ["@/features/account/actions", accountActionsStubPath],
      ["@/features/legal/actions", accountActionsStubPath],
      ["@/features/account/analytics-identity", analyticsIdentityStubPath],
      ["@/features/account/auth.client", authClientStubPath],
      ["next/link", nextLinkStubPath],
      ["next/navigation", nextNavigationStubPath],
      ["server-only", serverOnlyStubPath],
    ]);
    build.onResolve({ filter: /^@\/env$/ }, () => ({
      namespace: componentRendererEnvNamespace,
      path: "env",
    }));
    build.onLoad(
      { filter: /^env$/, namespace: componentRendererEnvNamespace },
      () => ({
        contents: `export const env = { NEXT_PUBLIC_POSTHOG_HOST: undefined, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined } as const;`,
        loader: "ts",
      })
    );
    build.onResolve({ filter: /^@\// }, async (args) => ({
      path:
        exactAliases.get(args.path) ??
        (await resolveAppModule(args.path.slice(2))),
    }));
    build.onResolve({ filter: /^\.\.?\// }, (args) =>
      resolveRelativeModule(args.path, args.resolveDir)
    );
    build.onResolve(
      { filter: /^(next\/link|next\/navigation|server-only)$/ },
      (args) => {
        const replacement = exactAliases.get(args.path);
        return replacement ? { path: replacement } : undefined;
      }
    );
    build.onLoad({ filter: /\/app\/globals\.css$/ }, async (args) => {
      if (resolve(args.path) !== actualGlobalsPath) return undefined;
      const config = await loadPostCssConfig({}, appRoot);
      const source = await readFile(actualGlobalsPath, "utf8");
      const transformed = await postcss(config.plugins).process(source, {
        from: actualGlobalsPath,
      });
      return {
        contents: transformed.css,
        loader: "css",
        resolveDir: appRoot,
      };
    });
  },
});

const resolveAdapterPath = async (adapterPath: string | undefined) => {
  if (!adapterPath) return defaultAdapterPath;
  const resolvedPath = resolve(process.cwd(), adapterPath);
  if (!(await fileExists(resolvedPath))) {
    throw new Error(`Adapter file does not exist: ${resolvedPath}`);
  }
  return resolvedPath;
};

const createBuildEntry = (adapterPath: string, locale: AccountVisualLocale) => `
import Adapter, { accountVisualAdapterMetadata } from ${JSON.stringify(adapterPath)};
import { mountAccountVisual } from ${JSON.stringify(rendererEntryPath)};

mountAccountVisual(Adapter, accountVisualAdapterMetadata, ${JSON.stringify(locale)});
`;

const buildEntryPathForRun = (runDirectory: string) =>
  join(runDirectory, ".account-visual-build-entry.tsx");

type BuildResult = {
  readonly success: boolean;
  readonly outputs: readonly { readonly path: string }[];
  readonly metafile?: BuildMetafile;
  readonly logs?: readonly { readonly message: string }[];
};

type BuildMetafile = {
  readonly inputs?: Readonly<Record<string, { readonly bytes?: number }>>;
};

const buildBundle = async (
  runDirectory: string,
  adapterPath: string,
  locale: AccountVisualLocale
) => {
  const buildDirectory = join(runDirectory, "build");
  await mkdir(buildDirectory, { recursive: true });
  const buildEntryPath = buildEntryPathForRun(runDirectory);
  await writeFile(
    buildEntryPath,
    createBuildEntry(adapterPath, locale),
    "utf8"
  );
  let result: BuildResult;
  try {
    result = (await Bun.build({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      entrypoints: [buildEntryPath],
      format: "esm",
      metafile: true,
      minify: false,
      outdir: buildDirectory,
      plugins: [createBuildPlugin()],
      sourcemap: "none",
      target: "browser",
    })) as BuildResult;
  } catch (error) {
    throw new Error(
      `Account visual browser bundle threw: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`
    );
  }
  if (!result.success) {
    const details = result.logs?.map((log) => log.message).join("\n");
    throw new Error(
      ["Account visual browser bundle failed to build", details]
        .filter(Boolean)
        .join("\n")
    );
  }

  const outputPaths = result.outputs.map((output) =>
    isAbsolute(output.path) ? output.path : resolve(buildDirectory, output.path)
  );
  const javascriptPath = outputPaths.find((path) => extname(path) === ".js");
  const cssPath = outputPaths.find((path) => extname(path) === ".css");
  if (!javascriptPath || !cssPath) {
    throw new Error(
      "Account visual bundle did not emit both JavaScript and CSS"
    );
  }

  const metadataInputs: BuildMetafile = result.metafile ?? {};
  const inputNames = Object.keys(metadataInputs.inputs ?? {});
  const inputPaths = new Set<string>([
    buildEntryPath,
    rendererEntryPath,
    defaultAdapterPath,
    actualAccountPagePath,
    actualGlobalsPath,
    rendererCssPath,
  ]);
  for (const inputName of inputNames) {
    const inputPath = isAbsolute(inputName)
      ? inputName
      : resolve(repoRoot, inputName);
    if (await fileExists(inputPath)) inputPaths.add(inputPath);
  }
  const bundleInputs: SourceFile[] = [];
  for (const inputPath of [...inputPaths].sort()) {
    const bytes = await readFile(inputPath);
    bundleInputs.push({
      path: displayPath(inputPath),
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    });
  }
  const outputs = [];
  for (const outputPath of outputPaths.sort()) {
    const bytes = await readFile(outputPath);
    outputs.push({
      path: basename(outputPath),
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    });
  }
  const ownedSources = await collectOwnedSourceFiles();
  return {
    buildDirectory,
    cssPath,
    javascriptPath,
    manifest: {
      schemaVersion: 1,
      bunVersion: Bun.version,
      entrypoint: displayPath(rendererEntryPath),
      adapter: displayPath(adapterPath),
      locale,
      postCssConfig: displayPath(postCssConfigPath),
      ownedSources,
      bundleInputs,
      outputs,
    },
  } as const;
};

const makeHtml = (
  javascriptName: string,
  cssName: string,
  rendererCssName: string,
  locale: AccountVisualLocale
) => `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/${cssName}">
    <link rel="stylesheet" href="/${rendererCssName}">
  </head>
  <body>
    <div id="account-visual-root"></div>
    <script type="module" src="/${javascriptName}"></script>
  </body>
</html>
`;

const makeStaticServer = async (
  javascriptPath: string,
  cssPath: string,
  rendererCss: Uint8Array,
  regularFont: Uint8Array,
  italicFont: Uint8Array,
  locale: AccountVisualLocale,
  port: number
) => {
  const javascriptName = basename(javascriptPath);
  const cssName = basename(cssPath);
  const rendererCssName = basename(rendererCssPath);
  const javascript = await readFile(javascriptPath);
  const css = await readFile(cssPath);
  const assets = new Map<
    string,
    { readonly body: Uint8Array; readonly type: string }
  >([
    [
      `/${javascriptName}`,
      { body: javascript, type: "text/javascript; charset=utf-8" },
    ],
    [`/${cssName}`, { body: css, type: "text/css; charset=utf-8" }],
    [
      `/${rendererCssName}`,
      { body: rendererCss, type: "text/css; charset=utf-8" },
    ],
    [
      "/__account-visual-fonts/sculpin-regular.woff2",
      { body: regularFont, type: "font/woff2" },
    ],
    [
      "/__account-visual-fonts/sculpin-italic.woff2",
      { body: italicFont, type: "font/woff2" },
    ],
  ]);
  const html = makeHtml(javascriptName, cssName, rendererCssName, locale);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      fetch(request) {
        if (request.method !== "GET") {
          return new Response(null, { status: 405 });
        }
        const url = new URL(request.url);
        if (url.pathname === "/" || url.pathname === "/index.html") {
          return new Response(html, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        const asset = assets.get(url.pathname);
        if (!asset) return new Response(null, { status: 404 });
        return new Response(Buffer.from(asset.body), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": asset.type,
          },
        });
      },
      hostname: "localhost",
      port,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Account visual renderer requires exclusive localhost:${port}; the port is occupied or unavailable. No existing process was stopped. ${details}`
    );
  }
  return {
    baseUrl: `http://localhost:${port}`,
    server,
  } as const;
};

const createContext = async (
  browser: Browser,
  baseUrl: string,
  problems: BrowserProblem[],
  viewport: { readonly width: number; readonly height: number },
  deviceScaleFactor: number,
  locale: AccountVisualLocale
) => {
  const context = await browser.newContext({
    deviceScaleFactor,
    locale,
    reducedMotion: "reduce",
    timezoneId: timeZone,
    viewport,
  });
  await context.addInitScript({ content: frozenClockScript });
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseUrl) {
      problems.push({
        kind: "blocked-external-request",
        message: requestUrl.origin,
      });
      await route.abort();
      return;
    }
    await route.continue();
  });
  return context;
};

const loadRendererPage = async (
  context: BrowserContext,
  baseUrl: string,
  screen: AccountVisualScreen,
  problems: BrowserProblem[]
) => {
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    problems.push({ kind: "page-error", message: error.message });
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push({ kind: "console-error", message: message.text() });
    }
  });
  try {
    await page.goto(`${baseUrl}/?screen=${screen}`, {
      waitUntil: "load",
      timeout: 15_000,
    });
  } catch (error) {
    problems.push({
      kind: "page-error",
      message:
        error instanceof Error ? error.message : "Renderer navigation failed",
    });
    return page;
  }
  try {
    await page.locator("#account-visual-root").waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await page.evaluate(async () => {
      await document.fonts.load('400 16px "Sculpin"');
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
  } catch (error) {
    problems.push({
      kind: "page-error",
      message:
        error instanceof Error ? error.message : "Renderer boot wait failed",
    });
  }
  return page;
};

type AccountSectionNavigationButton = {
  readonly label: string;
};

const readAccountSectionNavigationButton = async (
  page: Page,
  screen: AccountVisualScreen
): Promise<AccountSectionNavigationButton | null> =>
  page
    .locator("[data-account-mobile-navigation] button[data-account-section]")
    .evaluateAll(
      (elements, expected) => {
        const buttons = elements as HTMLButtonElement[];
        const values = new Set(
          buttons.map((button) => button.dataset.accountSection)
        );
        if (!expected.screens.every((value) => values.has(value))) return null;
        const button = buttons.find(
          ({ dataset }) => dataset.accountSection === expected.screen
        );
        return button ? { label: button.textContent?.trim() ?? "" } : null;
      },
      { screen, screens: [...accountVisualScreens] }
    );

const isMobileSectionButtonFullyVisible = async (button: Locator) =>
  button.evaluate((element) => {
    const mobileNavigation = element.closest(
      "[data-account-mobile-navigation]"
    );
    if (!(mobileNavigation instanceof HTMLElement)) return false;
    const navigationRect = mobileNavigation.getBoundingClientRect();
    const buttonRect = element.getBoundingClientRect();
    return (
      navigationRect.width > 0 &&
      navigationRect.height > 0 &&
      buttonRect.width > 0 &&
      buttonRect.height > 0 &&
      buttonRect.left >= navigationRect.left - 1 &&
      buttonRect.right <= navigationRect.right + 1 &&
      buttonRect.top >= navigationRect.top - 1 &&
      buttonRect.bottom <= navigationRect.bottom + 1
    );
  });

const readVisibleTarget = async (
  page: Page,
  screen: AccountVisualScreen
): Promise<{ readonly visible: boolean; readonly text: string | null }> => {
  const target = page.locator(productionSectionTargets[screen]).first();
  if ((await target.count()) === 0) return { visible: false, text: null };
  try {
    await target.waitFor({ state: "visible", timeout: 5_000 });
    const text = await target.evaluate((element) => {
      if (element instanceof HTMLSelectElement) {
        return element.selectedOptions[0]?.textContent?.trim() ?? "";
      }
      return element.textContent?.trim().replace(/\s+/g, " ") ?? "";
    });
    return { visible: true, text };
  } catch {
    return { visible: false, text: null };
  }
};

const readRouteAttribute = async (
  page: Page,
  attribute: "data-account-visual-route" | "data-account-visual-route-component"
): Promise<string | null> => {
  const route = page.locator(`[${attribute}]`).first();
  if ((await route.count()) === 0) return null;
  return await route.getAttribute(attribute);
};

const readRouteComponent = (page: Page) =>
  readRouteAttribute(page, "data-account-visual-route-component");

const readRendererScreen = async (page: Page): Promise<string | null> => {
  const renderer = page.locator("[data-account-visual-screen]").first();
  if ((await renderer.count()) === 0) return null;
  return await renderer.getAttribute("data-account-visual-screen");
};

const selectProductionScreen = async (
  page: Page,
  screen: AccountVisualScreen,
  mode: "desktop" | "mobile",
  isCallerAdapter: boolean
): Promise<ScreenSelection> => {
  const sectionButton = await readAccountSectionNavigationButton(page, screen);
  if (!sectionButton) {
    return {
      requestedScreen: screen,
      status: isCallerAdapter ? "adapter-defined" : "failed",
      method: isCallerAdapter ? "adapter-defined" : "none",
      sectionLabel: null,
      selectedValue: null,
      selectedAriaCurrent: null,
      targetSelector: null,
      targetVisible: null,
      targetText: null,
      detail: isCallerAdapter
        ? "The supplied adapter did not render the production AccountShell; screen composition remains adapter-defined and no production selection is claimed."
        : "The production AccountShell section navigation buttons were not rendered.",
    };
  }

  const targetSelector = productionSectionTargets[screen];
  try {
    if (mode === "desktop") {
      const buttons = await page
        .getByRole("button")
        .filter({ hasText: sectionButton.label })
        .all();
      let visibleButton: Locator | undefined;
      for (const button of buttons) {
        if (await button.isVisible()) {
          visibleButton = button;
          break;
        }
      }
      if (!visibleButton) {
        throw new Error(
          `No visible production desktop section button matched mobile navigation label ${JSON.stringify(sectionButton.label)}`
        );
      }
      await visibleButton.click();
      const selectedButtons = await page
        .locator("button[aria-current='page']")
        .filter({ hasText: sectionButton.label })
        .all();
      let selectedButton: Locator | undefined;
      for (const button of selectedButtons) {
        if (await button.isVisible()) {
          selectedButton = button;
          break;
        }
      }
      if (!selectedButton) {
        throw new Error(
          `No visible production desktop selected section button matched mobile navigation label ${JSON.stringify(sectionButton.label)}`
        );
      }
      const selectedAriaCurrent =
        await selectedButton.getAttribute("aria-current");
      const target = await readVisibleTarget(page, screen);
      if (selectedAriaCurrent !== "page" || !target.visible) {
        throw new Error(
          `Production desktop selection did not expose aria-current=page and a visible ${screen} target`
        );
      }
      return {
        requestedScreen: screen,
        status: "selected",
        method: "desktop-nav-button",
        sectionLabel: sectionButton.label,
        selectedValue: screen,
        selectedAriaCurrent,
        targetSelector,
        targetVisible: target.visible,
        targetText: target.text,
        detail: `Selected ${screen} through the visible desktop navigation button labelled ${JSON.stringify(sectionButton.label)}.`,
      };
    }

    const sectionNavigationButton = page.locator(
      `[data-account-mobile-navigation] button[data-account-section="${screen}"]`
    );
    await sectionNavigationButton.waitFor({ state: "visible", timeout: 5_000 });
    await sectionNavigationButton.click();
    const selectedButton = page.locator(
      `[data-account-mobile-navigation] button[data-account-section="${screen}"][aria-current="page"]`
    );
    await selectedButton.waitFor({ state: "visible", timeout: 5_000 });
    const selectedValue = await selectedButton.getAttribute(
      "data-account-section"
    );
    const selectedAriaCurrent =
      await selectedButton.getAttribute("aria-current");
    const selectedButtonFullyVisible =
      await isMobileSectionButtonFullyVisible(selectedButton);
    const target = await readVisibleTarget(page, screen);
    if (
      selectedValue !== screen ||
      selectedAriaCurrent !== "page" ||
      !selectedButtonFullyVisible ||
      !target.visible
    ) {
      throw new Error(
        `Production mobile selection did not expose data-account-section=${screen}, aria-current=page, a fully visible active button, and a visible target`
      );
    }
    return {
      requestedScreen: screen,
      status: "selected",
      method: "mobile-nav-button",
      sectionLabel: sectionButton.label,
      selectedValue,
      selectedAriaCurrent,
      targetSelector,
      targetVisible: target.visible,
      targetText: target.text,
      detail: `Selected ${screen} through the visible mobile navigation button labelled ${JSON.stringify(sectionButton.label)}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      requestedScreen: screen,
      status: "failed",
      method: mode === "desktop" ? "desktop-nav-button" : "mobile-nav-button",
      sectionLabel: sectionButton.label,
      selectedValue: null,
      selectedAriaCurrent: null,
      targetSelector,
      targetVisible: false,
      targetText: null,
      detail,
    };
  }
};

const runMobileSectionNavigation = async (
  page: Page,
  screen: AccountVisualScreen,
  isCallerAdapter: boolean
): Promise<MobileSectionNavigation> => {
  const sectionButton = await readAccountSectionNavigationButton(page, screen);
  const alternateScreen = accountVisualScreens.find(
    (candidate) => candidate !== screen
  );
  if (!sectionButton || !alternateScreen) {
    return {
      status: isCallerAdapter ? "adapter-defined" : "failed",
      method: isCallerAdapter ? "adapter-defined" : "none",
      requestedScreen: screen,
      alternateScreen: null,
      selectedBefore: null,
      selectedAlternate: null,
      selectedAfter: null,
      failures: isCallerAdapter
        ? []
        : ["Production mobile section navigation buttons were not rendered"],
    };
  }

  const mobileNavigation = page.locator("[data-account-mobile-navigation]");
  const readSelectedSection = async (): Promise<string | null> => {
    const selectedButtons = await mobileNavigation
      .locator("button[aria-current='page']")
      .all();
    for (const button of selectedButtons) {
      if (await button.isVisible()) {
        return await button.getAttribute("data-account-section");
      }
    }
    return null;
  };
  const selectSection = async (nextScreen: AccountVisualScreen) => {
    const button = mobileNavigation.locator(
      `button[data-account-section="${nextScreen}"]`
    );
    await button.waitFor({ state: "visible", timeout: 5_000 });
    await button.click();
    const selectedButton = mobileNavigation.locator(
      `button[data-account-section="${nextScreen}"][aria-current="page"]`
    );
    await selectedButton.waitFor({ state: "visible", timeout: 5_000 });
    if (!(await isMobileSectionButtonFullyVisible(selectedButton))) {
      throw new Error(
        `Mobile section ${nextScreen} was not fully visible after navigation`
      );
    }
    return await selectedButton.getAttribute("data-account-section");
  };
  try {
    await mobileNavigation.waitFor({ state: "visible", timeout: 5_000 });
    const selectedBefore = await readSelectedSection();
    const selectedAlternate = await selectSection(alternateScreen);
    const alternateTarget = await readVisibleTarget(page, alternateScreen);
    const selectedAfter = await selectSection(screen);
    const requestedTarget = await readVisibleTarget(page, screen);
    const failures = [
      ...(selectedBefore !== screen
        ? [`Mobile selection started at ${selectedBefore}, not ${screen}`]
        : []),
      ...(selectedAlternate !== alternateScreen
        ? [
            `Mobile selection did not navigate to alternate section ${alternateScreen}`,
          ]
        : []),
      ...(!alternateTarget.visible
        ? [`Mobile alternate section ${alternateScreen} was not visible`]
        : []),
      ...(selectedAfter !== screen
        ? [`Mobile selection did not return to ${screen}`]
        : []),
      ...(!requestedTarget.visible
        ? [`Mobile requested section ${screen} was not visible after return`]
        : []),
    ];
    return {
      status: failures.length === 0 ? "passed" : "failed",
      method: "mobile-nav-button",
      requestedScreen: screen,
      alternateScreen,
      selectedBefore,
      selectedAlternate,
      selectedAfter,
      failures,
    };
  } catch (error) {
    return {
      status: "failed",
      method: "mobile-nav-button",
      requestedScreen: screen,
      alternateScreen,
      selectedBefore: null,
      selectedAlternate: null,
      selectedAfter: null,
      failures: [
        error instanceof Error
          ? error.message
          : "Mobile section navigation threw",
      ],
    };
  }
};

const runDraftPersistenceCheck = async ({
  baseUrl,
  context,
  isCallerAdapter,
  requestedScreen,
}: {
  readonly baseUrl: string;
  readonly context: BrowserContext;
  readonly isCallerAdapter: boolean;
  readonly requestedScreen: AccountVisualScreen;
}): Promise<DraftPersistenceReport> => {
  const problems: BrowserProblem[] = [];
  const page = await loadRendererPage(context, baseUrl, "profile", problems);
  const failures: string[] = [];
  const intermediateScreen: AccountVisualScreen = isCallerAdapter
    ? "legal"
    : "danger";
  const scope = isCallerAdapter
    ? "adapter-defined"
    : "private-account-sections";
  const note = isCallerAdapter
    ? "Draft persistence follows caller-owned adapter composition; no production private-section or public-route persistence claim is made."
    : "Draft persistence is checked only across private account sections; drafts across the public legal route are not claimed.";
  let firstName: string | null = null;
  let companyName: string | null = null;
  try {
    const profileSelection = await selectProductionScreen(
      page,
      "profile",
      "mobile",
      isCallerAdapter
    );
    if (profileSelection.status === "adapter-defined") {
      return {
        status: "adapter-defined",
        method: "adapter-defined",
        scope,
        note,
        submitted: false,
        firstName: null,
        companyName: null,
        failures: [],
      };
    }
    if (profileSelection.status === "failed") {
      failures.push(profileSelection.detail);
    } else {
      const firstNameInput = page.locator("#account-profile-first-name");
      if (!(await firstNameInput.isVisible())) {
        failures.push("Profile first-name input was not visible");
      } else {
        await firstNameInput.fill("Ada Draft");
      }

      const billingSelection = await selectProductionScreen(
        page,
        "billing",
        "mobile",
        isCallerAdapter
      );
      if (billingSelection.status !== "selected") {
        failures.push(billingSelection.detail);
      } else {
        const billingKind = page.locator("#account-profile-billing-kind");
        await billingKind.selectOption("business");
        const companyInput = page.locator(
          "#account-profile-billing-company-name"
        );
        await companyInput.waitFor({ state: "visible", timeout: 5_000 });
        await companyInput.fill("Example Draft s.r.o.");

        const intermediateSelection = await selectProductionScreen(
          page,
          intermediateScreen,
          "mobile",
          isCallerAdapter
        );
        if (intermediateSelection.status !== "selected") {
          failures.push(intermediateSelection.detail);
        }

        const profileAfterIntermediate = await selectProductionScreen(
          page,
          "profile",
          "mobile",
          isCallerAdapter
        );
        if (profileAfterIntermediate.status !== "selected") {
          failures.push(profileAfterIntermediate.detail);
        } else {
          firstName = await firstNameInput.inputValue();
          if (firstName !== "Ada Draft") {
            failures.push(
              `Profile draft changed after ${intermediateScreen} navigation: ${JSON.stringify(firstName)}`
            );
          }
        }

        const billingAfterIntermediate = await selectProductionScreen(
          page,
          "billing",
          "mobile",
          isCallerAdapter
        );
        if (billingAfterIntermediate.status !== "selected") {
          failures.push(billingAfterIntermediate.detail);
        } else {
          companyName = await page
            .locator("#account-profile-billing-company-name")
            .inputValue();
          if (companyName !== "Example Draft s.r.o.") {
            failures.push(
              `Business billing draft changed after ${intermediateScreen} navigation: ${JSON.stringify(companyName)}`
            );
          }
        }

        const restoredSelection = await selectProductionScreen(
          page,
          requestedScreen,
          "mobile",
          isCallerAdapter
        );
        if (restoredSelection.status !== "selected") {
          failures.push(
            `Draft persistence check did not restore ${requestedScreen}: ${restoredSelection.detail}`
          );
        }
      }
    }
    failures.push(
      ...problems.map(({ kind, message }) => `${kind}: ${message}`)
    );
    return {
      status: failures.length === 0 ? "passed" : "failed",
      method: "fresh-real-page-mobile-menu",
      scope,
      note,
      submitted: false,
      firstName,
      companyName,
      failures,
    };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return {
      status: "failed",
      method: "fresh-real-page-mobile-menu",
      scope,
      note,
      submitted: false,
      firstName,
      companyName,
      failures,
    };
  } finally {
    await page.close();
  }
};

const runPublicLegalNavigationCheck = async ({
  baseUrl,
  context,
  locale,
}: {
  readonly baseUrl: string;
  readonly context: BrowserContext;
  readonly locale: AccountVisualLocale;
}): Promise<PublicLegalNavigationReport> => {
  const failures: string[] = [];
  const browserProblems: BrowserProblem[] = [];
  const returns: PublicLegalNavigationReturn[] = [];
  const publicLegalPathname = `/${locale}/account/legal`;
  let page: Page | undefined;
  let legalPathname: string | null = null;
  let cookiePreferencesVisible = false;
  let archiveDisabled = false;
  const consentChanges = {
    analyticsEnabled: false,
    analyticsDisabled: false,
    acceptAll: false,
    rejectAll: false,
    persistedAfterRouteReturn: false,
  };

  const addBrowserProblems = () => {
    failures.push(
      ...browserProblems.map(({ kind, message }) => `${kind}: ${message}`)
    );
  };

  const assertConsentState = async (
    expected: PublicLegalConsentState,
    phase: string
  ) => {
    if (!page) {
      failures.push(`${phase}: consent page is missing`);
      return false;
    }
    const matched = await waitForPublicLegalConsentState(page, expected);
    if (!matched) {
      failures.push(
        `${phase}: expected cookie controls to expose aria-checked=${JSON.stringify(expected)} with necessary disabled and optional controls enabled within 5 seconds`
      );
    }
    return matched;
  };

  const clickConsentControl = async (control: Locator, phase: string) => {
    try {
      await control.click({ timeout: 5_000 });
      return true;
    } catch (error) {
      failures.push(
        `${phase}: native consent control click failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  };

  const assertPublicLegalLocation = async (phase: string) => {
    if (!page) throw new Error("Public legal navigation page is missing");

    const url = new URL(page.url());
    if (url.pathname !== publicLegalPathname) {
      failures.push(
        `${phase}: expected pathname ${publicLegalPathname}, received ${url.pathname}`
      );
    }
    if (url.search !== "") {
      failures.push(
        `${phase}: expected an empty search, received ${url.search}`
      );
    }

    const route = await readRouteAttribute(page, "data-account-visual-route");
    if (route !== "public-legal") {
      failures.push(
        `${phase}: expected data-account-visual-route=public-legal, received ${JSON.stringify(route)}`
      );
    }
    const routeComponent = await readRouteComponent(page);
    if (routeComponent !== "PublicAccountLegal") {
      failures.push(
        `${phase}: expected data-account-visual-route-component=PublicAccountLegal, received ${JSON.stringify(routeComponent)}`
      );
    }
    return url;
  };

  try {
    page = await loadRendererPage(context, baseUrl, "legal", browserProblems);
    const legalSelection = await selectProductionScreen(
      page,
      "legal",
      "mobile",
      false
    );
    if (legalSelection.status !== "selected") {
      failures.push(
        `Public legal navigation selection failed: ${legalSelection.detail}`
      );
    }
    const legalUrl = await assertPublicLegalLocation(
      "Initial public legal route"
    );
    legalPathname = legalUrl.pathname;

    let allCookiePreferencesVisible = true;
    for (const category of publicLegalCookieCategories) {
      const control = page.locator(`#cookie-category-${category}`).first();
      let visible = true;
      try {
        await control.waitFor({ state: "visible", timeout: 5_000 });
      } catch {
        visible = false;
      }
      if (!visible) {
        allCookiePreferencesVisible = false;
        failures.push(
          `Initial public legal route: cookie control #cookie-category-${category} was not visible`
        );
        continue;
      }

      const expectedDisabled = category === "necessary";
      if (
        !(await waitForPublicLegalControlDisabled(control, expectedDisabled))
      ) {
        const disabled = await control.isDisabled();
        failures.push(
          `Initial public legal route: cookie control #cookie-category-${category} expected disabled=${expectedDisabled}, received disabled=${disabled}`
        );
      }
    }
    cookiePreferencesVisible = allCookiePreferencesVisible;

    const archiveAction = getAccountScreenCopy(locale).legal.archiveAction;
    const archiveButton = page
      .getByRole("button", { name: archiveAction, exact: true })
      .first();
    let archiveVisible = true;
    try {
      await archiveButton.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      archiveVisible = false;
    }
    if (!archiveVisible) {
      failures.push(
        `Initial public legal route: archive button with localized copy ${JSON.stringify(archiveAction)} was not visible`
      );
    } else {
      archiveDisabled = await waitForPublicLegalControlDisabled(
        archiveButton,
        true
      );
      if (!archiveDisabled) {
        failures.push(
          "Initial public legal route: localized archive button was not disabled"
        );
      }
    }

    const initialConsentState: PublicLegalConsentState = {
      necessary: true,
      analytics: false,
      marketing: false,
      preferences: false,
    };
    const allConsentState: PublicLegalConsentState = {
      necessary: true,
      analytics: true,
      marketing: true,
      preferences: true,
    };

    await assertConsentState(
      initialConsentState,
      "Initial public legal consent state"
    );

    const analyticsControl = page.locator("#cookie-category-analytics").first();
    if (
      await clickConsentControl(
        analyticsControl,
        "Analytics consent enable interaction"
      )
    ) {
      consentChanges.analyticsEnabled = await assertConsentState(
        {
          necessary: true,
          analytics: true,
          marketing: false,
          preferences: false,
        },
        "Analytics consent enabled"
      );
    }

    if (
      await clickConsentControl(
        analyticsControl,
        "Analytics consent disable interaction"
      )
    ) {
      consentChanges.analyticsDisabled = await assertConsentState(
        initialConsentState,
        "Analytics consent disabled"
      );
    }

    const acceptAllButton = page
      .getByRole("button", {
        name: m.cookieSettingsAcceptAll({}, { locale }),
        exact: true,
      })
      .first();
    if (
      await clickConsentControl(
        acceptAllButton,
        "Accept-all consent interaction"
      )
    ) {
      consentChanges.acceptAll = await assertConsentState(
        allConsentState,
        "Accept-all consent state"
      );
    }

    const rejectAllButton = page
      .getByRole("button", {
        name: m.cookieSettingsRejectAll({}, { locale }),
        exact: true,
      })
      .first();
    if (
      await clickConsentControl(
        rejectAllButton,
        "Reject-all consent interaction"
      )
    ) {
      consentChanges.rejectAll = await assertConsentState(
        initialConsentState,
        "Reject-all consent state"
      );
    }

    for (const section of ["profile", "billing"] as const) {
      const selection = await selectProductionScreen(
        page,
        section,
        "mobile",
        false
      );
      const url = new URL(page.url());
      const target = await readVisibleTarget(page, section);
      const route = await readRouteAttribute(page, "data-account-visual-route");
      const routeComponent = await readRouteComponent(page);
      const metadataScreen = await readRendererScreen(page);
      const selected =
        selection.status === "selected" &&
        selection.selectedValue === section &&
        selection.selectedAriaCurrent === "page";
      const expectedSearch = `?section=${section}`;

      if (selection.status !== "selected") {
        failures.push(
          `Return from public legal to ${section} failed: ${selection.detail}`
        );
      }
      if (url.pathname !== `/${locale}/account`) {
        failures.push(
          `Return from public legal to ${section}: expected pathname /${locale}/account, received ${url.pathname}`
        );
      }
      if (url.search !== expectedSearch) {
        failures.push(
          `Return from public legal to ${section}: expected search ${expectedSearch}, received ${url.search}`
        );
      }
      if (!selected) {
        failures.push(
          `Return from public legal to ${section}: the section button was not selected with aria-current=page`
        );
      }
      if (!target.visible) {
        failures.push(
          `Return from public legal to ${section}: the real ${section} target was not visible`
        );
      }
      if (route !== "private-account") {
        failures.push(
          `Return from public legal to ${section}: expected data-account-visual-route=private-account, received ${JSON.stringify(route)}`
        );
      }
      if (routeComponent !== "AccountPage") {
        failures.push(
          `Return from public legal to ${section}: expected data-account-visual-route-component=AccountPage, received ${JSON.stringify(routeComponent)}`
        );
      }
      if (metadataScreen !== section) {
        failures.push(
          `Return from public legal to ${section}: expected data-account-visual-screen=${section}, received ${JSON.stringify(metadataScreen)}`
        );
      }

      returns.push({
        section,
        pathname: url.pathname,
        search: url.search,
        selected,
        targetVisible: target.visible,
        metadataScreen,
      });

      const legalReturn = await selectProductionScreen(
        page,
        "legal",
        "mobile",
        false
      );
      if (legalReturn.status !== "selected") {
        failures.push(
          `Return to public legal after ${section} failed: ${legalReturn.detail}`
        );
        break;
      }
      await assertPublicLegalLocation(`Public legal route after ${section}`);
      if (section === "profile") {
        consentChanges.persistedAfterRouteReturn = await assertConsentState(
          initialConsentState,
          "Public legal consent state after profile route return"
        );
      }
    }

    addBrowserProblems();
    return {
      status: failures.length === 0 ? "passed" : "failed",
      simulation: "visual-fixture-only",
      authentication: "not-proved",
      legalPathname,
      cookiePreferencesVisible,
      archiveDisabled,
      consentChanges,
      returns,
      failures,
    };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    addBrowserProblems();
    return {
      status: "failed",
      simulation: "visual-fixture-only",
      authentication: "not-proved",
      legalPathname,
      cookiePreferencesVisible,
      archiveDisabled,
      consentChanges,
      returns,
      failures,
    };
  } finally {
    await page?.close();
  }
};

const readAdapterMetadata = async (
  page: Page
): Promise<AccountVisualAdapterMetadata> =>
  page.locator("[data-account-visual-adapter-owner]").evaluate((element) => {
    const owner = element.getAttribute("data-account-visual-adapter-owner");
    const fixture = element.getAttribute("data-account-visual-adapter-fixture");
    if (!owner || !fixture) {
      throw new Error(
        "Adapter did not expose non-empty owner and fixture metadata"
      );
    }
    return { owner, fixture };
  });

export const readInitialDomProbe = async (
  page: Page,
  {
    deviceScaleFactor,
    locale,
    mode,
    emailProbe,
  }: {
    readonly deviceScaleFactor: number;
    readonly locale: AccountVisualLocale;
    readonly mode: "desktop" | "mobile";
    readonly emailProbe?: {
      readonly expectedSelectedProfile: boolean;
      readonly requestedScreen: AccountVisualScreen;
      readonly selectionStatus: ScreenSelection["status"];
      readonly selectedTargetVisible: boolean | null;
    };
  }
): Promise<InitialDomProbe> =>
  page.evaluate(
    ({
      deviceScaleFactor,
      locale,
      mode,
      emailProbe,
      statusTexts,
      iconStatusTexts,
    }) => {
      type ProbeRect = {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly right: number;
        readonly bottom: number;
      };

      const normalizeText = (value: string) =>
        value.trim().replace(/\s+/g, " ");
      const main = document.querySelector("main");
      const header = main?.querySelector("header") ?? null;
      const heading = header?.querySelector("h1") ?? null;
      const viewport = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };

      const makeRect = (rect: DOMRect): ProbeRect => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      });
      const rectFor = (element: Element | null) =>
        element ? makeRect(element.getBoundingClientRect()) : null;
      const contains = (inner: ProbeRect, outer: ProbeRect) =>
        inner.x >= outer.x - 1 &&
        inner.y >= outer.y - 1 &&
        inner.right <= outer.right + 1 &&
        inner.bottom <= outer.bottom + 1;
      const containsHorizontally = (inner: ProbeRect, outer: ProbeRect) =>
        inner.x >= outer.x - 1 && inner.right <= outer.right + 1;
      const intersectsVertically = (rect: ProbeRect) =>
        rect.bottom >= viewport.y - 1 && rect.y <= viewport.bottom + 1;
      const isWithinVerticalViewport = (rect: ProbeRect) =>
        rect.y >= viewport.y - 1 && rect.bottom <= viewport.bottom + 1;

      const selectorFor = (element: Element) => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current) {
          const tag = current.tagName.toLowerCase();
          let part = tag;
          if (current.id) {
            part += `#${CSS.escape(current.id)}`;
          } else if (current.hasAttribute("data-slot")) {
            part += `[data-slot="${CSS.escape(current.getAttribute("data-slot") ?? "")}"]`;
          } else if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === current?.tagName
            );
            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
          }
          parts.unshift(part);
          current = current.parentElement;
        }
        return parts.join(" > ");
      };

      const isGenuineScreenReaderOnly = (element: Element) => {
        const screenReaderOnly = element.closest(".sr-only");
        if (!screenReaderOnly) return false;
        const style = getComputedStyle(screenReaderOnly);
        const rect = screenReaderOnly.getBoundingClientRect();
        const positioned =
          style.position === "absolute" || style.position === "fixed";
        const atMostOnePixel = (value: string) => {
          const pixels = Number.parseFloat(value);
          return Number.isFinite(pixels) && pixels <= 1;
        };
        const onePixelBox =
          positioned &&
          atMostOnePixel(style.width) &&
          atMostOnePixel(style.height) &&
          rect.width <= 1.5 &&
          rect.height <= 1.5;
        const computedClipping =
          (style.clip !== "auto" && style.clip !== "none") ||
          style.clipPath !== "none";
        const standardClipStyles =
          positioned &&
          onePixelBox &&
          style.overflow === "hidden" &&
          style.whiteSpace === "nowrap";
        return onePixelBox && (computedClipping || standardClipStyles);
      };

      const isUsableTextNode = (node: Node) => {
        const element = node.parentElement;
        if (!element) return false;
        if (element.closest("script, style, noscript, [aria-hidden='true']"))
          return false;
        if (isGenuineScreenReaderOnly(element)) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const rectsForRange = (range: Range): ProbeRect[] =>
        Array.from(range.getClientRects(), makeRect).filter(
          (rect) => rect.width > 0 && rect.height > 0
        );

      const rangeRectsForNode = (node: Node): ProbeRect[] => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return rectsForRange(range);
      };

      const rangeRectsForTextOffsets = (
        node: Text,
        start: number,
        end: number
      ): ProbeRect[] => {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return rectsForRange(range);
      };

      const collectTextRanges = (
        container: Element | null,
        boundary: ProbeRect | null,
        excludedContainers: readonly (Element | null)[] = []
      ) => {
        if (!container || !boundary) return [];
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT
        );
        const ranges: Array<{
          readonly node: Text;
          readonly text: string;
          readonly rects: readonly ProbeRect[];
        }> = [];
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text) {
            const textNode = node;
            const excluded = excludedContainers.some((excludedContainer) =>
              excludedContainer?.contains(textNode.parentElement)
            );
            if (
              !excluded &&
              isUsableTextNode(textNode) &&
              normalizeText(textNode.textContent ?? "")
            ) {
              const rects = rangeRectsForNode(textNode);
              if (rects.length > 0) {
                ranges.push({
                  node: textNode,
                  text: normalizeText(textNode.textContent ?? ""),
                  rects,
                });
              }
            }
          }
          node = walker.nextNode();
        }
        return ranges.map(({ node, text, rects }) => ({
          text,
          selector: selectorFor(node.parentElement!),
          rects,
          withinBoundary: rects.every((rect) => contains(rect, boundary)),
          withinViewportHorizontally: rects.every((rect) =>
            containsHorizontally(rect, viewport)
          ),
          offscreenVertically: rects.every(
            (rect) => !intersectsVertically(rect)
          ),
          partiallyVisibleVertically:
            rects.some((rect) => intersectsVertically(rect)) &&
            !rects.every((rect) => isWithinVerticalViewport(rect)),
          withinMain: main
            ? rects.every((rect) =>
                contains(rect, makeRect(main.getBoundingClientRect()))
              )
            : false,
          clippedByBoundary: !rects.every((rect) => contains(rect, boundary)),
          clippedByViewportHorizontally: !rects.every((rect) =>
            containsHorizontally(rect, viewport)
          ),
          clippedByMain: main
            ? !rects.every((rect) =>
                contains(rect, makeRect(main.getBoundingClientRect()))
              )
            : true,
        }));
      };

      const collectWordRangeRects = (container: Element | null) => {
        if (!container) return [];
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT
        );
        const wordRanges: ProbeRect[][] = [];
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text && isUsableTextNode(node)) {
            const text = node.textContent ?? "";
            const wordPattern = /\S+/g;
            let match = wordPattern.exec(text);
            while (match) {
              const start = match.index;
              const rects = rangeRectsForTextOffsets(
                node,
                start,
                start + match[0].length
              );
              if (rects.length > 0) wordRanges.push(rects);
              match = wordPattern.exec(text);
            }
          }
          node = walker.nextNode();
        }
        return wordRanges;
      };

      const hasMultipleLineTops = (rects: readonly ProbeRect[]) => {
        const lineTopTolerance = 1;
        const lineTops = rects.map((rect) => rect.y).sort((a, b) => a - b);
        let lastLineTop: number | undefined;
        for (const lineTop of lineTops) {
          if (
            lastLineTop !== undefined &&
            lineTop - lastLineTop > lineTopTolerance
          ) {
            return true;
          }
          lastLineTop ??= lineTop;
        }
        return false;
      };

      const mainRect = rectFor(main);
      const headerRect = rectFor(header);
      const headingRect = rectFor(heading);
      const mobileNavigation =
        main?.querySelector("[data-account-mobile-navigation]") ?? null;
      const mobileNavigationAllowsIntentionalClipping =
        mobileNavigation instanceof HTMLElement
          ? (() => {
              const style = getComputedStyle(mobileNavigation);
              const navigationRect = makeRect(
                mobileNavigation.getBoundingClientRect()
              );
              return (
                style.display !== "none" &&
                style.visibility === "visible" &&
                navigationRect.width > 0 &&
                navigationRect.height > 0 &&
                contains(navigationRect, viewport) &&
                (style.overflowX === "auto" || style.overflowX === "scroll")
              );
            })()
          : false;
      const inactiveMobileSectionButtons =
        mobileNavigationAllowsIntentionalClipping && mobileNavigation
          ? Array.from(
              mobileNavigation.querySelectorAll("button[data-account-section]")
            ).filter((button) => button.getAttribute("aria-current") !== "page")
          : [];
      const headerTextRanges = collectTextRanges(header, headerRect, [heading]);
      const mainTextRanges = collectTextRanges(main, mainRect, [
        header,
        ...inactiveMobileSectionButtons,
      ]);
      const allTextRanges = [...headerTextRanges, ...mainTextRanges];
      const textRangeFailures = allTextRanges.flatMap((range) => [
        ...(range.withinBoundary
          ? []
          : [`${range.selector} text range is outside its container bounds`]),
        ...(range.withinViewportHorizontally
          ? []
          : [
              `${range.selector} text range horizontally overflows the viewport`,
            ]),
      ]);

      let headerReadability: {
        status: "passed" | "failed" | "not-applicable";
        reason: string;
        selector: string | null;
        text: string | null;
        cssRect: ProbeRect | null;
        computedStyle: {
          fontSize: string | null;
          lineHeight: string | null;
        };
        availableLayoutWidth: {
          viewport: number;
          main: number | null;
          header: number | null;
          effective: number | null;
        };
        minimumHeadingWidth: number | null;
        headingWidth: number | null;
        lineCount: number | null;
        lineHeightPx: number | null;
        textHeight: number | null;
        wrapped: boolean | null;
        singleWordGlyphWrapping: boolean | null;
        wordGlyphWrapping: boolean | null;
        textRangeRects: readonly ProbeRect[];
        failures: readonly string[];
      };

      if (
        !main ||
        !header ||
        !heading ||
        !mainRect ||
        !headerRect ||
        !headingRect
      ) {
        headerReadability = {
          status: "not-applicable",
          reason: "main header h1 was not rendered; readability is not claimed",
          selector: null,
          text: null,
          cssRect: null,
          computedStyle: { fontSize: null, lineHeight: null },
          availableLayoutWidth: {
            viewport: window.innerWidth,
            main: mainRect?.width ?? null,
            header: headerRect?.width ?? null,
            effective: null,
          },
          minimumHeadingWidth: null,
          headingWidth: null,
          lineCount: null,
          lineHeightPx: null,
          textHeight: null,
          wrapped: null,
          singleWordGlyphWrapping: null,
          wordGlyphWrapping: null,
          textRangeRects: [],
          failures: [],
        };
      } else {
        const style = getComputedStyle(heading);
        const headingText = normalizeText(heading.textContent ?? "");
        const headingRanges = collectTextRanges(heading, headingRect);
        const headingRangeRects = headingRanges.flatMap(({ rects }) => rects);
        const headingRangeFailures = headingRanges.flatMap((range) => [
          ...(range.withinBoundary
            ? []
            : [`${range.selector} heading text range is outside h1 bounds`]),
          ...(range.withinViewportHorizontally
            ? []
            : [
                `${range.selector} heading text range horizontally overflows the viewport`,
              ]),
        ]);
        const headingWordGlyphWrapping =
          collectWordRangeRects(heading).some(hasMultipleLineTops);
        const lineTops = [...new Set(headingRangeRects.map((rect) => rect.y))];
        const lineCount = lineTops.length;
        const textTop = Math.min(
          ...headingRangeRects.map((rect) => rect.y),
          headingRect.y
        );
        const textBottom = Math.max(
          ...headingRangeRects.map((rect) => rect.bottom),
          headingRect.bottom
        );
        const longestUnbrokenWordWidth = (() => {
          const words = headingText.split(/\s+/).filter(Boolean);
          if (words.length === 0) return 0;

          const measurement = heading.cloneNode(false) as HTMLElement;
          measurement.removeAttribute("id");
          measurement.setAttribute("aria-hidden", "true");
          for (const property of [
            "font",
            "font-family",
            "font-size",
            "font-weight",
            "font-style",
            "font-stretch",
            "font-variant",
            "font-kerning",
            "font-feature-settings",
            "font-variation-settings",
            "font-optical-sizing",
            "font-synthesis",
            "font-size-adjust",
            "line-height",
            "letter-spacing",
            "word-spacing",
            "text-transform",
            "text-indent",
            "direction",
            "unicode-bidi",
            "writing-mode",
            "text-orientation",
          ]) {
            const value = style.getPropertyValue(property);
            if (value) measurement.style.setProperty(property, value);
          }
          measurement.style.setProperty("position", "absolute");
          measurement.style.setProperty("display", "inline-block");
          measurement.style.setProperty("width", "max-content", "important");
          measurement.style.setProperty(
            "min-width",
            "max-content",
            "important"
          );
          measurement.style.setProperty("max-width", "none", "important");
          measurement.style.setProperty("height", "auto", "important");
          measurement.style.setProperty("flex", "none", "important");
          measurement.style.setProperty("white-space", "nowrap", "important");
          measurement.style.setProperty("visibility", "hidden");
          measurement.style.setProperty("pointer-events", "none");
          measurement.style.setProperty("left", "0");
          measurement.style.setProperty("top", "0");
          measurement.textContent = "";

          const measurementParent = heading.parentElement ?? document.body;
          measurementParent.append(measurement);
          try {
            return words.reduce((longest, word) => {
              measurement.textContent = word;
              const width = measurement.getBoundingClientRect().width;
              return Number.isFinite(width)
                ? Math.max(longest, width)
                : longest;
            }, 0);
          } finally {
            measurement.remove();
          }
        })();
        const minimumHeadingWidth = Math.min(
          longestUnbrokenWordWidth,
          Math.max(0, window.innerWidth - 32)
        );
        const singleWordGlyphWrapping =
          !/\s/.test(headingText) && headingWordGlyphWrapping;
        const minimumHeadingWidthDeficit =
          minimumHeadingWidth - headingRect.width;
        const failures = [
          ...headingRangeFailures,
          ...(minimumHeadingWidthDeficit > 1 / 64
            ? [
                `main header h1 width ${headingRect.width}px is below minimum ${minimumHeadingWidth}px`,
              ]
            : []),
          ...(headingWordGlyphWrapping
            ? [
                singleWordGlyphWrapping
                  ? "main header h1 wrapped a single word across glyph lines"
                  : "main header h1 wrapped a word across glyph lines",
              ]
            : []),
          ...(headingRangeRects.length === 0
            ? ["main header h1 has no visible text range"]
            : []),
        ];
        const availableWidths = [
          window.innerWidth,
          mainRect.width,
          headerRect.width,
        ];
        headerReadability = {
          status: failures.length === 0 ? "passed" : "failed",
          reason:
            failures.length === 0
              ? "heading meets minimum width and visible text-range containment invariants"
              : "heading readability invariant failed",
          selector: selectorFor(heading),
          text: headingText || null,
          cssRect: headingRect,
          computedStyle: {
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
          },
          availableLayoutWidth: {
            viewport: window.innerWidth,
            main: mainRect.width,
            header: headerRect.width,
            effective: Math.min(...availableWidths),
          },
          minimumHeadingWidth,
          headingWidth: headingRect.width,
          lineCount,
          lineHeightPx: Number.parseFloat(style.lineHeight) || null,
          textHeight: textBottom - textTop,
          wrapped: lineCount > 1,
          singleWordGlyphWrapping,
          wordGlyphWrapping: headingWordGlyphWrapping,
          textRangeRects: headingRangeRects,
          failures,
        };
      }

      const profileSelector = "[data-slot='profile-screen']" as const;
      const shouldProbeSelectedProfile =
        emailProbe?.expectedSelectedProfile === true &&
        emailProbe.selectionStatus === "selected" &&
        emailProbe.selectedTargetVisible === true;
      const profile = shouldProbeSelectedProfile
        ? document.querySelector(profileSelector)
        : null;
      const emailPattern = /^[^@\s]+@example\.test$/i;
      const normalizedStatusTexts = new Set(
        statusTexts.map((text) => normalizeText(text).toLowerCase())
      );
      const isVerifiedStatus = (text: string) =>
        normalizedStatusTexts.has(normalizeText(text).toLowerCase());
      const findEmailNode = (container: Element | null) => {
        if (!container) return null;
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT
        );
        let node = walker.nextNode();
        while (node) {
          const text = normalizeText(node.textContent ?? "");
          if (node instanceof Text && emailPattern.test(text)) return node;
          node = walker.nextNode();
        }
        return null;
      };
      const emailNode = findEmailNode(profile);
      const isAfterEmail = (element: Element) =>
        emailNode?.parentElement
          ? Boolean(
              emailNode.parentElement.compareDocumentPosition(element) &
                Node.DOCUMENT_POSITION_FOLLOWING
            )
          : false;
      const normalizedIconStatusTexts = new Set(
        iconStatusTexts.map((text) => normalizeText(text))
      );
      const emailWrapper = emailNode?.parentElement?.parentElement ?? null;
      const isVerifiedIconButton = (element: Element) =>
        element instanceof HTMLButtonElement &&
        element.parentElement === emailWrapper &&
        isAfterEmail(element) &&
        normalizedIconStatusTexts.has(
          normalizeText(element.getAttribute("aria-label") ?? "")
        );
      const statusElementFor = (container: Element, email: string) =>
        [container, ...container.querySelectorAll("*")]
          .filter((element) => {
            const text = normalizeText(element.textContent ?? "");
            const isTextBadge =
              element !== emailNode?.parentElement &&
              !text.includes(email) &&
              isVerifiedStatus(text) &&
              isAfterEmail(element);
            return isTextBadge || isVerifiedIconButton(element);
          })
          .sort((first, second) => {
            const firstDepth = first.querySelectorAll("*").length;
            const secondDepth = second.querySelectorAll("*").length;
            return firstDepth - secondDepth;
          })[0] ?? null;
      const rangeEvidence = (
        node: Node,
        field: ProbeRect,
        text: string,
        element: Element,
        rects: readonly ProbeRect[] = rangeRectsForNode(node)
      ): EmailTextEvidence => {
        const withinField =
          rects.length > 0 && rects.every((rect) => contains(rect, field));
        const withinViewportHorizontally =
          rects.length > 0 &&
          rects.every((rect) => containsHorizontally(rect, viewport));
        const style = getComputedStyle(element);
        return {
          text,
          selector: selectorFor(element),
          rects,
          withinField,
          withinViewportHorizontally,
          offscreenVertically: rects.every(
            (rect) => !intersectsVertically(rect)
          ),
          partiallyVisibleVertically:
            rects.some((rect) => intersectsVertically(rect)) &&
            !rects.every((rect) => isWithinVerticalViewport(rect)),
          clippedByField: !withinField,
          clippedByViewportHorizontally: !withinViewportHorizontally,
          readable:
            rects.length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            withinField &&
            withinViewportHorizontally,
        };
      };

      const viewportSize = {
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
      };
      const emptyEmailContainment = (
        status: "failed" | "not-applicable",
        reason: string,
        failures: readonly string[] = [],
        field: Element | null = null,
        email: EmailTextEvidence | null = null
      ): EmailContainmentEvidence => ({
        status,
        profileSelector,
        fieldSelector: field ? selectorFor(field) : null,
        fieldRect: field ? rectFor(field) : null,
        viewport: viewportSize,
        email,
        statusText: null,
        reason,
        failures,
      });

      let emailContainment: EmailContainmentEvidence;
      if (!emailProbe) {
        emailContainment = emptyEmailContainment(
          "not-applicable",
          "email probe is deferred until the requested screen is selected; no profile DOM was measured"
        );
      } else if (!emailProbe.expectedSelectedProfile) {
        emailContainment = emptyEmailContainment(
          "not-applicable",
          `email probe is not applicable for requested ${emailProbe.requestedScreen}; hidden non-selected profile DOM was not measured`
        );
      } else if (
        emailProbe.selectionStatus !== "selected" ||
        emailProbe.selectedTargetVisible !== true
      ) {
        emailContainment = emptyEmailContainment(
          "failed",
          "selected profile email probe is missing expected selected-profile coverage",
          [
            "selected profile email probe missing expected coverage: requested profile was not selected and visible before interaction/capture",
          ]
        );
      } else if (!profile) {
        emailContainment = emptyEmailContainment(
          "failed",
          "selected profile email probe is missing the selected profile target",
          [
            "selected profile email probe missing expected coverage: selected profile target was not rendered visibly",
          ]
        );
      } else if (!emailNode) {
        emailContainment = {
          status: "failed",
          profileSelector,
          fieldSelector: null,
          fieldRect: null,
          viewport: viewportSize,
          email: null,
          statusText: null,
          reason:
            "selected profile did not render the expected synthetic example.test login email",
          failures: [
            "selected profile email probe missing expected login email coverage",
          ],
        };
      } else {
        const email = normalizeText(emailNode.textContent ?? "");
        let field: Element | null = emailNode.parentElement;
        let emailField: Element | null = null;
        let statusElement: Element | null = null;
        while (field && profile.contains(field)) {
          emailField = field;
          statusElement = statusElementFor(field, email);
          if (statusElement) break;
          field = field.parentElement;
        }
        if (!field || !statusElement) {
          const fieldForEvidence = field ?? emailField;
          const fieldRect = fieldForEvidence ? rectFor(fieldForEvidence) : null;
          emailContainment = {
            status: "failed",
            profileSelector,
            fieldSelector: fieldForEvidence
              ? selectorFor(fieldForEvidence)
              : null,
            fieldRect,
            viewport: viewportSize,
            email:
              fieldForEvidence && fieldRect
                ? rangeEvidence(
                    emailNode,
                    fieldRect,
                    email,
                    emailNode.parentElement!
                  )
                : null,
            statusText: null,
            reason:
              "selected profile login email was found but no following localized verified status badge was identifiable in its stable field wrapper",
            failures: [
              "selected profile email probe missing expected verified login-email status coverage",
            ],
          };
        } else {
          const fieldRect = rectFor(field);
          if (!fieldRect) {
            emailContainment = {
              status: "failed",
              profileSelector,
              fieldSelector: selectorFor(field),
              fieldRect: null,
              viewport: {
                cssWidth: window.innerWidth,
                cssHeight: window.innerHeight,
              },
              email: null,
              statusText: null,
              reason: "email field wrapper has no measurable bounds",
              failures: ["email field wrapper has no measurable bounds"],
            };
          } else {
            const emailEvidence = rangeEvidence(
              emailNode,
              fieldRect,
              email,
              emailNode.parentElement!
            );
            const iconStatus = isVerifiedIconButton(statusElement);
            const statusText = iconStatus
              ? normalizeText(statusElement.getAttribute("aria-label") ?? "")
              : normalizeText(statusElement.textContent ?? "");
            const statusRect = iconStatus ? rectFor(statusElement) : null;
            let statusRects: readonly ProbeRect[] | undefined;
            if (iconStatus) {
              statusRects =
                statusRect && statusRect.width > 0 && statusRect.height > 0
                  ? [statusRect]
                  : [];
            }
            const statusEvidence = rangeEvidence(
              statusElement,
              fieldRect,
              statusText,
              statusElement,
              statusRects
            );
            const failures = [
              ...(emailEvidence.readable
                ? []
                : [
                    "login email text range is clipped by its field or horizontally overflows the viewport",
                  ]),
              ...(statusEvidence.readable
                ? []
                : [
                    "login email status text range is clipped by its field or horizontally overflows the viewport",
                  ]),
            ];
            emailContainment = {
              status: failures.length === 0 ? "passed" : "failed",
              profileSelector,
              fieldSelector: selectorFor(field),
              fieldRect,
              viewport: {
                cssWidth: window.innerWidth,
                cssHeight: window.innerHeight,
              },
              email: emailEvidence,
              statusText: statusEvidence,
              reason:
                failures.length === 0
                  ? "login email and following localized verified status badge are readable within the field and horizontally within the viewport"
                  : "login email containment invariant failed",
              failures,
            };
          }
        }
      }

      const failures = [
        ...textRangeFailures,
        ...headerReadability.failures,
        ...emailContainment.failures,
      ];
      return {
        capturedBeforeMutation: true,
        captureTiming:
          mode === "desktop"
            ? "after renderer boot; before desktop screen selection, screenshot, interaction, focus, or style mutation"
            : "after renderer boot; before mobile screen selection, screenshot, interaction, focus, or style mutation",
        locale,
        viewport: {
          cssWidth: window.innerWidth,
          cssHeight: window.innerHeight,
          deviceScaleFactor,
        },
        mainRect,
        headerRect,
        headerReadability,
        textRanges: {
          header: headerTextRanges,
          main: mainTextRanges,
        },
        emailContainment,
        failures,
      };
    },
    {
      deviceScaleFactor,
      locale,
      mode,
      emailProbe,
      statusTexts: [...verifiedLoginEmailStatusTexts],
      iconStatusTexts: [...verifiedLoginEmailExplanationTexts],
    }
  );

export const readSelectedEmailProbe = async (
  page: Page,
  {
    deviceScaleFactor,
    expectedSelectedProfile,
    locale,
    mode,
    requestedScreen,
    selectionStatus,
    selectedTargetVisible,
  }: {
    readonly deviceScaleFactor: number;
    readonly expectedSelectedProfile: boolean;
    readonly locale: AccountVisualLocale;
    readonly mode: "desktop" | "mobile";
    readonly requestedScreen: AccountVisualScreen;
    readonly selectionStatus: ScreenSelection["status"];
    readonly selectedTargetVisible: boolean | null;
  }
): Promise<SelectedEmailProbe> => {
  const probe = await readInitialDomProbe(page, {
    deviceScaleFactor,
    locale,
    mode,
    emailProbe: {
      expectedSelectedProfile,
      requestedScreen,
      selectionStatus,
      selectedTargetVisible,
    },
  });
  return {
    capturedAfterSelection: true,
    captureTiming:
      mode === "desktop"
        ? "after requested desktop screen selection; before screenshot, interaction, focus, or style mutation"
        : "after requested mobile screen selection; before screenshot, interaction, focus, or style mutation",
    requestedScreen,
    expectedSelectedProfile,
    selectionStatus,
    selectedTargetVisible,
    emailContainment: probe.emailContainment,
    failures: probe.emailContainment.failures,
  };
};

const readComputedStyleEvidence = async (
  page: Page,
  {
    mode,
    selectedScreenLabel,
    deviceScaleFactor,
  }: {
    readonly mode: "desktop" | "mobile";
    readonly selectedScreenLabel: string | null;
    readonly deviceScaleFactor: number;
  }
): Promise<ComputedStyleEvidence> =>
  page.evaluate(
    ({ deviceScaleFactor, mode, selectedScreenLabel }) => {
      const normalizeText = (value: string) =>
        value.trim().replace(/\s+/g, " ");

      const isVisible = (element: Element) => {
        const htmlElement = element as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          !htmlElement.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const selectorFor = (element: Element) => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current) {
          const tag = current.tagName.toLowerCase();
          let part = tag;
          if (current.id) {
            part += `#${CSS.escape(current.id)}`;
          } else if (current.hasAttribute("data-slot")) {
            part += `[data-slot="${CSS.escape(current.getAttribute("data-slot") ?? "")}"]`;
          } else if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === current?.tagName
            );
            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
          }
          parts.unshift(part);
          current = current.parentElement;
        }
        return parts.join(" > ");
      };

      const makeRect = (
        rect: DOMRect,
        coordinateSpace: "css-pixels" | "physical-pixels",
        scale: number
      ) => ({
        coordinateSpace,
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
        right: rect.right * scale,
        bottom: rect.bottom * scale,
      });

      const snapshot = (
        element: Element,
        includeText: boolean
      ): ComputedStyleElement => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector: selectorFor(element),
          tag: element.tagName.toLowerCase(),
          dataSlot: element.getAttribute("data-slot"),
          text: includeText
            ? normalizeText(element.textContent ?? "") || null
            : null,
          visible: isVisible(element),
          boundingRect: {
            css: makeRect(rect, "css-pixels", 1),
            physical: makeRect(rect, "physical-pixels", deviceScaleFactor),
            deviceScaleFactor,
          },
          computedStyle: {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            color: style.color,
            borderRadius: style.borderRadius,
            display: style.display,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
          },
        };
      };

      const main = document.querySelector("main");
      const mainSnapshot = main ? snapshot(main, false) : null;
      const mainBackground = main
        ? {
            backgroundColor: getComputedStyle(main).backgroundColor,
            backgroundImage: getComputedStyle(main).backgroundImage,
          }
        : { backgroundColor: null, backgroundImage: null };

      const shellCandidates: Element[] = [];
      if (main) {
        let current: Element | null = main;
        while (current) {
          shellCandidates.push(current);
          current = current.parentElement;
        }
        shellCandidates.push(...main.querySelectorAll("[data-slot]"));
      }
      const backgroundBearingShell = [...new Set(shellCandidates)]
        .filter((element) => {
          if (!isVisible(element)) return false;
          const style = getComputedStyle(element);
          return (
            (style.backgroundImage !== "none" &&
              style.backgroundImage !== "") ||
            (style.backgroundColor !== "transparent" &&
              style.backgroundColor !== "rgba(0, 0, 0, 0)")
          );
        })
        .map((element) => snapshot(element, false));

      const headings = Array.from(document.querySelectorAll("h1, h2"))
        .filter(isVisible)
        .map((element) => snapshot(element, true));

      const selectedButton =
        mode === "desktop"
          ? (Array.from(document.querySelectorAll("nav button"))
              .filter(isVisible)
              .find((button) => {
                if (!selectedScreenLabel) return true;
                const text = normalizeText(button.textContent ?? "");
                const label = normalizeText(selectedScreenLabel);
                return text === label || text.startsWith(label);
              }) ??
            Array.from(document.querySelectorAll("button[aria-current='page']"))
              .filter(isVisible)
              .find((button) => {
                if (!selectedScreenLabel) return true;
                const text = normalizeText(button.textContent ?? "");
                const label = normalizeText(selectedScreenLabel);
                return text === label || text.startsWith(label);
              }) ??
            null)
          : null;
      const sidebar =
        selectedButton?.closest("aside") ??
        selectedButton?.closest("nav") ??
        null;
      const selectedButtonSnapshot = selectedButton
        ? snapshot(selectedButton, true)
        : null;

      const tableLabel = (table: HTMLTableElement) => {
        const labelledBy = table
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        const caption = table.querySelector("caption")?.textContent ?? "";
        const heading = table
          .closest("section, article")
          ?.querySelector("h1, h2, h3")?.textContent;
        return normalizeText(labelledBy || caption || heading || "");
      };

      const visibleTables = Array.from(document.querySelectorAll("table"))
        .filter(isVisible)
        .map((table) => {
          const htmlTable = table as HTMLTableElement;
          let headerElements = Array.from(
            htmlTable.querySelectorAll("thead th, thead td")
          );
          if (headerElements.length === 0) {
            headerElements = Array.from(
              htmlTable.querySelectorAll("tr:first-child th, tr:first-child td")
            );
          }
          const rows = Array.from(htmlTable.querySelectorAll("tbody tr"))
            .filter(isVisible)
            .map((row) => {
              const labels = Array.from(row.querySelectorAll("th, td"))
                .filter(isVisible)
                .map((label) => snapshot(label, true));
              return {
                row: snapshot(row, true),
                labels,
              };
            });
          const rowLabelCounts = new Map<string, number>();
          for (const { row } of rows) {
            const label = row.text ?? "";
            rowLabelCounts.set(label, (rowLabelCounts.get(label) ?? 0) + 1);
          }
          return {
            table: snapshot(htmlTable, false),
            label: tableLabel(htmlTable),
            headers: headerElements
              .filter(isVisible)
              .map((header) => snapshot(header, true)),
            rows,
            duplicateRowLabels: [...rowLabelCounts]
              .filter(([, count]) => count > 1)
              .map(([label]) => label),
          };
        });
      const pastTable =
        visibleTables.find(({ label, table }) =>
          /\b(?:past|history|historie|minul)/i.test(
            `${label} ${table.text ?? ""}`
          )
        ) ?? null;

      return {
        capturedBeforeMutation: true,
        captureTiming:
          mode === "desktop"
            ? "after requested desktop selection; before screenshot, interaction, focus, or style mutation"
            : "after requested mobile selection; before screenshot, interaction, focus, or style mutation",
        viewport: {
          cssWidth: document.documentElement.clientWidth,
          cssHeight: window.innerHeight,
          deviceScaleFactor,
        },
        main: mainSnapshot,
        mainBackground,
        backgroundBearingShell,
        headings,
        desktopNavigation: {
          selectedButton: selectedButtonSnapshot,
          selectedButtonStyles: selectedButtonSnapshot
            ? {
                color: selectedButtonSnapshot.computedStyle.color,
                backgroundColor:
                  selectedButtonSnapshot.computedStyle.backgroundColor,
                borderRadius: selectedButtonSnapshot.computedStyle.borderRadius,
              }
            : null,
          sidebar: sidebar ? snapshot(sidebar, false) : null,
        },
        visibleTables,
        pastTable,
      };
    },
    { deviceScaleFactor, mode, selectedScreenLabel }
  );

const captureMain = async (
  page: Page,
  fallbackCssDimensions: MainCapture["cssDimensions"]
): Promise<MainCapture> => {
  const main = page.locator("main").first();
  if ((await page.locator("main").count()) === 0) {
    return {
      png: await page.screenshot({ animations: "disabled", fullPage: false }),
      cssDimensions: fallbackCssDimensions,
      boundingRect: null,
      kind: "document-fallback",
    };
  }
  const boundingBox = await main.boundingBox();
  if (!boundingBox || boundingBox.width <= 0 || boundingBox.height <= 0) {
    return {
      png: await page.screenshot({ animations: "disabled", fullPage: false }),
      cssDimensions: fallbackCssDimensions,
      boundingRect: null,
      kind: "document-fallback",
    };
  }
  return {
    png: await main.screenshot({ animations: "disabled" }),
    cssDimensions: {
      width: boundingBox.width,
      height: boundingBox.height,
    },
    boundingRect: boundingBox,
    kind: "main",
  };
};

const writeEvidenceImages = async (
  screenDirectory: string,
  reference: ReferenceAsset,
  mainPng: Buffer
) => {
  const actual = await decodePng(mainPng);
  const comparison = makeTopLeftComparisonCanvas(actual, {
    width: reference.width,
    height: reference.height,
  });
  const comparisonResult = {
    metrics: calculateRgbMetrics(reference.image, comparison.image),
    regions: calculateRegionMetrics(reference.image, comparison.image),
    difference: makeAbsoluteRgbDifference(reference.image, comparison.image),
    overlay: makeFiftyFiftyOverlay(reference.image, comparison.image),
  };
  const files = {
    main: join(screenDirectory, "main.png"),
    comparison: join(screenDirectory, "comparison.png"),
    heatmap: join(screenDirectory, "heatmap.png"),
    overlay: join(screenDirectory, "overlay.png"),
  } as const;
  const comparisonPng = await encodePng(comparison.image);
  const heatmapPng = await encodePng(comparisonResult.difference);
  const overlayPng = await encodePng(comparisonResult.overlay);
  await writeFile(files.main, mainPng);
  await writeFile(files.comparison, comparisonPng);
  await writeFile(files.heatmap, heatmapPng);
  await writeFile(files.overlay, overlayPng);
  return {
    actual,
    comparison: comparison.image,
    files,
    hashes: {
      main: sha256(mainPng),
      comparison: sha256(comparisonPng),
      heatmap: sha256(heatmapPng),
      overlay: sha256(overlayPng),
    },
    comparisonPlacement: comparison.placement,
    metrics: comparisonResult.metrics,
    regions: comparisonResult.regions,
  } as const;
};

const readActionAvailability = async (
  page: Page
): Promise<UnavailableActionStatus[]> =>
  page.evaluate(
    (ids) =>
      ids.map((id) => {
        const control = document.getElementById(id) as HTMLButtonElement | null;
        const dataUnavailable =
          control?.dataset.accountVisualUnavailable === "true";
        const actionDataUnavailable =
          control?.dataset.accountVisualActionUnavailable === "true";
        const nativeTitle = control?.getAttribute("title") ?? null;
        const ariaDescription =
          control?.getAttribute("aria-description") ?? null;
        const metadataComplete =
          control?.disabled &&
          dataUnavailable &&
          actionDataUnavailable &&
          nativeTitle === "Unavailable in component renderer";
        let reason: UnavailableActionStatus["reason"];
        if (control === null) {
          reason = "not-rendered";
        } else if (metadataComplete) {
          reason = "component-renderer backend unavailable";
        } else {
          reason = "metadata-incomplete";
        }
        return {
          id,
          status: "not-available" as const,
          present: control !== null,
          disabled: control?.disabled ?? null,
          label: "Unavailable in component renderer" as const,
          dataUnavailable: control === null ? null : dataUnavailable,
          actionDataUnavailable:
            control === null ? null : actionDataUnavailable,
          nativeTitle,
          ariaDescription,
          reason,
        };
      }),
    actionControlIds
  );

const actionFailures = (actions: readonly UnavailableActionStatus[]) =>
  actions
    .filter(
      (action) =>
        action.present &&
        (action.disabled !== true ||
          action.dataUnavailable !== true ||
          action.actionDataUnavailable !== true ||
          action.nativeTitle !== "Unavailable in component renderer")
    )
    .map(
      (action) =>
        `${action.id} did not expose the visible disabled state and native unavailable title metadata`
    );

const readHorizontalOverflow = async (page: Page) =>
  page.evaluate(() => {
    const root = document.getElementById("account-visual-root");
    const main = root?.querySelector("main");
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const documentScrollWidth = document.documentElement.scrollWidth;
    const bodyScrollWidth = document.body.scrollWidth;
    const mobileNavigation =
      root?.querySelector<HTMLElement>("[data-account-mobile-navigation]") ??
      null;
    const mobileNavigationAllowsIntentionalClipping = mobileNavigation
      ? (() => {
          const style = getComputedStyle(mobileNavigation);
          const navigationRect = mobileNavigation.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility === "visible" &&
            navigationRect.width > 0 &&
            navigationRect.height > 0 &&
            navigationRect.left >= -1 &&
            navigationRect.top >= -1 &&
            navigationRect.right <= viewportWidth + 1 &&
            navigationRect.bottom <= viewportHeight + 1 &&
            (style.overflowX === "auto" || style.overflowX === "scroll")
          );
        })()
      : false;
    const mobileSectionButtons = mobileNavigation
      ? Array.from(
          mobileNavigation.querySelectorAll<HTMLButtonElement>(
            "button[data-account-section]"
          )
        )
      : [];
    const activeMobileSectionButton = mobileSectionButtons.find(
      (button) => button.getAttribute("aria-current") === "page"
    );
    const activeMobileSectionFullyVisible = activeMobileSectionButton
      ? (() => {
          const navigationRect = mobileNavigation?.getBoundingClientRect();
          const buttonRect = activeMobileSectionButton.getBoundingClientRect();
          return (
            navigationRect !== undefined &&
            navigationRect.width > 0 &&
            navigationRect.height > 0 &&
            buttonRect.width > 0 &&
            buttonRect.height > 0 &&
            buttonRect.left >= navigationRect.left - 1 &&
            buttonRect.right <= navigationRect.right + 1 &&
            buttonRect.top >= navigationRect.top - 1 &&
            buttonRect.bottom <= navigationRect.bottom + 1
          );
        })()
      : false;
    const isInactiveMobileSectionButton = (element: HTMLElement) => {
      const sectionButton = element.closest<HTMLButtonElement>(
        "[data-account-mobile-navigation] button[data-account-section]"
      );
      return (
        mobileNavigationAllowsIntentionalClipping &&
        sectionButton !== null &&
        mobileNavigation?.contains(sectionButton) === true &&
        sectionButton.getAttribute("aria-current") !== "page"
      );
    };
    // The mobile navigation is a horizontal scroll viewport. Its own
    // scrollWidth is expected only when its section-button contents are the
    // source of the overflow and the active button remains fully contained.
    const isExpectedMobileNavigationScrollViewport = (element: HTMLElement) =>
      mobileNavigationAllowsIntentionalClipping &&
      element === mobileNavigation &&
      mobileSectionButtons.length > 0 &&
      activeMobileSectionFullyVisible &&
      [...element.children].every((child) =>
        child.matches("button[data-account-section]")
      );
    const offenders = root
      ? [...root.querySelectorAll<HTMLElement>("*")]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const extendsViewport =
              rect.left < -0.5 || rect.right > viewportWidth + 0.5;
            const hasOwnOverflow =
              element.scrollWidth > element.clientWidth + 1;
            const hasClippedOverflow =
              hasOwnOverflow && style.overflowX !== "visible";
            const isScreenReaderOnly = element.classList.contains("sr-only");
            const expectedMobileNavigationOverflow =
              isInactiveMobileSectionButton(element) ||
              (isExpectedMobileNavigationScrollViewport(element) &&
                hasClippedOverflow &&
                !extendsViewport);
            return {
              element,
              rect,
              style,
              relevant:
                !isScreenReaderOnly &&
                !expectedMobileNavigationOverflow &&
                (extendsViewport || hasClippedOverflow),
            };
          })
          .filter(({ relevant }) => relevant)
          .slice(0, 50)
          .map(({ element, rect, style }) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: element.className,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: style.overflowX,
          }))
      : [];
    return {
      viewportWidth,
      documentScrollWidth,
      bodyScrollWidth,
      documentOverflow: documentScrollWidth > viewportWidth,
      bodyOverflow: bodyScrollWidth > viewportWidth,
      mainClientWidth: main?.clientWidth ?? null,
      mainScrollWidth: main?.scrollWidth ?? null,
      offenders,
    };
  });

const readFocusedElement = async (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body)
      return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible =
      !element.hidden &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight;
    return {
      visible,
      tag: element.tagName.toLowerCase(),
      id: element.id,
      role: element.getAttribute("role"),
      label:
        element.getAttribute("aria-label") ??
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ??
        "",
    };
  });

type FocusTarget = {
  readonly tag: string;
  readonly id: string;
  readonly role: string | null;
  readonly label: string;
};

const sameFocusTarget = (
  first: FocusTarget | null,
  second: FocusTarget | null
) =>
  first !== null &&
  second !== null &&
  first.tag === second.tag &&
  first.id === second.id &&
  first.role === second.role &&
  first.label === second.label;

const runMobileFunctionalChecks = async (
  page: Page
): Promise<MobileFunctionalReport> => {
  const failures: string[] = [];
  let profileInput: MobileFunctionalReport["profileInput"] = {
    status: "not-available",
  };
  const firstName = page.locator("#account-profile-first-name");
  if ((await firstName.count()) > 0 && (await firstName.isVisible())) {
    try {
      const original = await firstName.inputValue();
      await firstName.fill("Ada local draft");
      const editedValue = await firstName.inputValue();
      await firstName.fill("");
      const nativeValidationAfterClear = await page
        .locator("#account-profile-form")
        .evaluate((element) => {
          if (!(element instanceof HTMLFormElement)) {
            throw new Error("Profile form selector did not resolve to a form");
          }
          const eligibleControls = Array.from(element.elements).filter(
            (
              control
            ): control is
              | HTMLButtonElement
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement =>
              control instanceof HTMLButtonElement ||
              control instanceof HTMLInputElement ||
              control instanceof HTMLSelectElement ||
              control instanceof HTMLTextAreaElement
          );
          return eligibleControls
            .filter((control) => control.willValidate)
            .some((control) => !control.validity.valid);
        });
      await firstName.fill(original);
      profileInput = {
        status: "passed",
        editedValue,
        nativeValidationAfterClear,
      };
      if (!nativeValidationAfterClear) {
        failures.push(
          "profile native validation did not reject an empty required first name"
        );
      }
    } catch {
      profileInput = { status: "failed" };
      failures.push("profile local input editing failed");
    }
  }

  let deletionConfirmation: MobileFunctionalReport["deletionConfirmation"] = {
    status: "not-available",
    opened: false,
    finalActionDisabled: null,
    cancelled: false,
  };
  const deleteTrigger = page.locator("#delete-account-trigger");
  if ((await deleteTrigger.count()) > 0 && (await deleteTrigger.isVisible())) {
    let opened = false;
    let finalActionDisabled: boolean | null = null;
    let cancelled = false;
    try {
      await deleteTrigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 5_000 });
      opened = true;
      const finalAction = page.locator("#delete-account-confirm");
      finalActionDisabled =
        (await finalAction.count()) > 0 ? await finalAction.isDisabled() : null;
      const cancelButton = finalAction
        .locator("xpath=..")
        .locator("button:not(#delete-account-confirm)");
      if ((await cancelButton.count()) > 0) {
        try {
          await cancelButton.first().click();
          await page.waitForFunction(
            () =>
              !document.querySelector("[role='dialog']") ||
              document
                .querySelector("[role='dialog']")
                ?.getAttribute("data-state") === "closed",
            undefined,
            { timeout: 5_000 }
          );
          cancelled = true;
        } catch {
          failures.push(
            "deletion confirmation cancel control did not close the dialog"
          );
        }
      } else {
        failures.push("deletion confirmation did not expose a cancel control");
      }
      deletionConfirmation = {
        status: cancelled && finalActionDisabled === true ? "passed" : "failed",
        opened,
        finalActionDisabled,
        cancelled,
      };
      if (finalActionDisabled !== true) {
        failures.push(
          "delete final action was not disabled in the component renderer"
        );
      }
    } catch (error) {
      deletionConfirmation = {
        status: "failed",
        opened,
        finalActionDisabled,
        cancelled,
      };
      failures.push(
        `deletion confirmation open/cancel check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const anchors = page.locator("#account-visual-root a");
  let navigation: MobileFunctionalReport["navigation"] = {
    status: "not-available",
    method: "none",
    detail: "No visible anchor is rendered by the supplied account state.",
  };
  const visibleAnchors: Locator[] = [];
  for (const anchor of await anchors.all()) {
    if (await anchor.isVisible()) visibleAnchors.push(anchor);
  }
  if (visibleAnchors.length > 0) {
    try {
      const anchor = visibleAnchors[0]!;
      const href = await anchor.getAttribute("href");
      const before = page.url();
      await anchor.click();
      const after = page.url();
      await page.waitForLoadState("load", { timeout: 5_000 });
      navigation = {
        status: href && after !== before ? "passed" : "failed",
        method: "anchor",
        detail: `${before} -> ${after}`,
      };
      if (!href || after === before)
        failures.push("renderer anchor did not update browser history");
    } catch {
      navigation = {
        status: "failed",
        method: "anchor",
        detail: "Renderer anchor navigation threw",
      };
      failures.push("renderer anchor navigation failed");
    }
  } else if (deletionConfirmation.cancelled) {
    navigation = {
      status: "passed",
      method: "router-refresh",
      detail:
        "Delete dialog cancellation exercised the renderer router refresh without navigation.",
    };
  }

  return { profileInput, deletionConfirmation, navigation, failures };
};

const runDesktopCapture = async ({
  browser,
  baseUrl,
  desktop,
  isCallerAdapter,
  locale,
  reference,
  screen,
  screenDirectory,
}: {
  readonly browser: Browser;
  readonly baseUrl: string;
  readonly desktop: DesktopCaptureSettings;
  readonly isCallerAdapter: boolean;
  readonly locale: AccountVisualLocale;
  readonly reference: ReferenceAsset;
  readonly screen: AccountVisualScreen;
  readonly screenDirectory: string;
}) => {
  const problems: BrowserProblem[] = [];
  const desktopCssHeight = desktopCssHeightForReference(
    reference.height,
    desktop.deviceScaleFactor
  );
  const context = await createContext(
    browser,
    baseUrl,
    problems,
    {
      width: desktop.cssWidth,
      height: desktopCssHeight,
    },
    desktop.deviceScaleFactor,
    locale
  );
  try {
    const page = await loadRendererPage(context, baseUrl, screen, problems);
    const initialDomProbe = await readInitialDomProbe(page, {
      deviceScaleFactor: desktop.deviceScaleFactor,
      locale,
      mode: "desktop",
    });
    const selection = await selectProductionScreen(
      page,
      screen,
      "desktop",
      isCallerAdapter
    );
    const routeComponent = await readRouteComponent(page);
    const emailProbe = await readSelectedEmailProbe(page, {
      deviceScaleFactor: desktop.deviceScaleFactor,
      expectedSelectedProfile: screen === "profile" && !isCallerAdapter,
      locale,
      mode: "desktop",
      requestedScreen: screen,
      selectionStatus: selection.status,
      selectedTargetVisible: selection.targetVisible,
    });
    const adapterMetadata = await readAdapterMetadata(page);
    const computedStyles = await readComputedStyleEvidence(page, {
      deviceScaleFactor: desktop.deviceScaleFactor,
      mode: "desktop",
      selectedScreenLabel: selection.sectionLabel,
    });
    const mainCapture = await captureMain(page, {
      width: desktop.cssWidth,
      height: desktopCssHeight,
    });
    const imageEvidence = await writeEvidenceImages(
      screenDirectory,
      reference,
      mainCapture.png
    );
    const mainPhysicalDimensions = {
      width: imageEvidence.actual.width,
      height: imageEvidence.actual.height,
    };
    const actionAvailability = await readActionAvailability(page);
    const functionalFailures = [
      ...initialDomProbe.failures.map(
        (failure) => `initial DOM probe: ${failure}`
      ),
      ...emailProbe.failures.map((failure) => `email probe: ${failure}`),
      ...(mainCapture.kind === "main"
        ? []
        : [
            "No visible main element was rendered; document screenshot used as fallback",
          ]),
      ...(selection.status === "failed" ? [selection.detail] : []),
      ...actionFailures(actionAvailability),
      ...(problems.length > 0
        ? problems.map(({ kind, message }) => `${kind}: ${message}`)
        : []),
    ];
    return {
      viewport: {
        cssWidth: desktop.cssWidth,
        cssHeight: desktopCssHeight,
        physicalWidth: desktop.physicalWidth,
        physicalHeight: desktopCssHeight * desktop.deviceScaleFactor,
        deviceScaleFactor: desktop.deviceScaleFactor,
      },
      mainBoundingRect: mainCapture.boundingRect,
      mainCssDimensions: mainCapture.cssDimensions,
      mainPhysicalDimensions,
      captureKind: mainCapture.kind,
      selection,
      routeComponent,
      initialDomProbe,
      emailProbe,
      computedStyles,
      files: {
        main: relative(screenDirectory, imageEvidence.files.main),
        comparison: relative(screenDirectory, imageEvidence.files.comparison),
        heatmap: relative(screenDirectory, imageEvidence.files.heatmap),
        overlay: relative(screenDirectory, imageEvidence.files.overlay),
      },
      hashes: imageEvidence.hashes,
      comparisonPlacement: imageEvidence.comparisonPlacement,
      comparison: {
        coordinateSpace: "reference-physical-pixels",
        referencePhysicalPixels: {
          width: reference.width,
          height: reference.height,
        },
        actualCssPixels: mainCapture.cssDimensions,
        actualPhysicalPixels: mainPhysicalDimensions,
        placement: imageEvidence.comparisonPlacement,
      },
      metrics: imageEvidence.metrics,
      regions: imageEvidence.regions,
      adapterMetadata,
      actionAvailability,
      browserProblems: problems,
      functionalFailures,
    } as const;
  } finally {
    await context.close();
  }
};

const runMobileCapture = async ({
  browser,
  baseUrl,
  isCallerAdapter,
  locale,
  screen,
  width,
  screenDirectory,
}: {
  readonly browser: Browser;
  readonly baseUrl: string;
  readonly isCallerAdapter: boolean;
  readonly locale: AccountVisualLocale;
  readonly screen: AccountVisualScreen;
  readonly width: (typeof mobileCssWidths)[number];
  readonly screenDirectory: string;
}) => {
  const problems: BrowserProblem[] = [];
  const context = await createContext(
    browser,
    baseUrl,
    problems,
    {
      width,
      height: mobileCssHeight,
    },
    1,
    locale
  );
  try {
    const page = await loadRendererPage(context, baseUrl, screen, problems);
    const initialDomProbe = await readInitialDomProbe(page, {
      deviceScaleFactor: 1,
      locale,
      mode: "mobile",
    });
    const selection = await selectProductionScreen(
      page,
      screen,
      "mobile",
      isCallerAdapter
    );
    const emailProbe = await readSelectedEmailProbe(page, {
      deviceScaleFactor: 1,
      expectedSelectedProfile: screen === "profile" && !isCallerAdapter,
      locale,
      mode: "mobile",
      requestedScreen: screen,
      selectionStatus: selection.status,
      selectedTargetVisible: selection.targetVisible,
    });
    const computedStyles = await readComputedStyleEvidence(page, {
      deviceScaleFactor: 1,
      mode: "mobile",
      selectedScreenLabel: selection.sectionLabel,
    });
    const screenshot = await page.screenshot({
      animations: "disabled",
      fullPage: false,
    });
    const publicLegalNavigation =
      !isCallerAdapter && screen === "legal"
        ? await runPublicLegalNavigationCheck({
            baseUrl,
            context,
            locale,
          })
        : null;
    const horizontalOverflow = await readHorizontalOverflow(page);
    const sectionNavigation = await runMobileSectionNavigation(
      page,
      screen,
      isCallerAdapter
    );
    const focusSequence: FocusTarget[] = [];
    const seenFocusTargets = new Set<string>();
    let focusScreenshot: Buffer | undefined;
    let reportedFocusTarget: FocusTarget | null = null;
    let activeFocusElement: FocusTarget | null = null;
    let matchesReportedTarget = false;
    let focusCaptureFailure: string | undefined;
    const focusPage = await loadRendererPage(
      context,
      baseUrl,
      screen,
      problems
    );
    let focusSelection: ScreenSelection;
    try {
      focusSelection = await selectProductionScreen(
        focusPage,
        screen,
        "mobile",
        isCallerAdapter
      );
      if (focusSelection.status !== "failed") {
        for (let index = 0; index < 80; index += 1) {
          await focusPage.keyboard.press("Tab");
          const focused = await readFocusedElement(focusPage);
          if (!focused) continue;
          if (focused.visible) {
            const target = {
              tag: focused.tag,
              id: focused.id,
              role: focused.role,
              label: focused.label,
            };
            const focusKey = [
              focused.tag,
              focused.id,
              focused.role ?? "",
              focused.label,
            ].join("|");
            if (seenFocusTargets.has(focusKey)) {
              reportedFocusTarget = target;
              break;
            }
            seenFocusTargets.add(focusKey);
            focusSequence.push(target);
          }
        }
      }
      if (!reportedFocusTarget) {
        const focused = await readFocusedElement(focusPage);
        if (focused?.visible) {
          reportedFocusTarget = {
            id: focused.id,
            label: focused.label,
            role: focused.role,
            tag: focused.tag,
          };
        }
      }
      await focusPage.addStyleTag({
        content: "input, textarea { caret-color: transparent !important; }",
      });
      focusScreenshot = await focusPage.screenshot({
        animations: "disabled",
        fullPage: false,
      });
      const focusedAfterScreenshot = await readFocusedElement(focusPage);
      if (focusedAfterScreenshot?.visible) {
        activeFocusElement = {
          id: focusedAfterScreenshot.id,
          label: focusedAfterScreenshot.label,
          role: focusedAfterScreenshot.role,
          tag: focusedAfterScreenshot.tag,
        };
      }
      matchesReportedTarget = sameFocusTarget(
        reportedFocusTarget,
        activeFocusElement
      );
      if (reportedFocusTarget && !activeFocusElement) {
        focusCaptureFailure =
          "Native focus screenshot page did not retain the reported active element";
      } else if (reportedFocusTarget && !matchesReportedTarget) {
        focusCaptureFailure =
          "Native focus screenshot active element did not match the reported target";
      }
      focusScreenshot ??= await focusPage.screenshot({
        animations: "disabled",
        fullPage: false,
      });
    } finally {
      await focusPage.close();
    }
    const files = {
      screenshot: join(screenDirectory, "screenshot.png"),
      focus: join(screenDirectory, "focus.png"),
    } as const;
    await writeFile(files.screenshot, screenshot);
    await writeFile(files.focus, focusScreenshot);
    const functional = await runMobileFunctionalChecks(page);
    const draftPersistence = await runDraftPersistenceCheck({
      baseUrl,
      context,
      isCallerAdapter,
      requestedScreen: screen,
    });
    const actionAvailability = await readActionAvailability(page);
    const functionalFailures = [
      ...initialDomProbe.failures.map(
        (failure) => `initial DOM probe: ${failure}`
      ),
      ...emailProbe.failures.map((failure) => `email probe: ${failure}`),
      ...functional.failures,
      ...(publicLegalNavigation?.failures ?? []),
      ...(selection.status === "failed" ? [selection.detail] : []),
      ...(focusSelection.status === "failed" ? [focusSelection.detail] : []),
      ...sectionNavigation.failures,
      ...draftPersistence.failures,
      ...actionFailures(actionAvailability),
      ...(focusSequence.length === 0
        ? ["No visible keyboard focus target was reachable"]
        : []),
      ...(focusCaptureFailure ? [focusCaptureFailure] : []),
      ...(problems.length > 0
        ? problems.map(({ kind, message }) => `${kind}: ${message}`)
        : []),
    ];
    return {
      viewport: {
        cssWidth: width,
        cssHeight: mobileCssHeight,
        deviceScaleFactor: 1,
      },
      selection,
      initialDomProbe,
      emailProbe,
      focusSelection,
      computedStyles,
      sectionNavigation,
      draftPersistence,
      publicLegalNavigation,
      files: {
        screenshot: relative(screenDirectory, files.screenshot),
        focus: relative(screenDirectory, files.focus),
      },
      hashes: {
        screenshot: sha256(screenshot),
        focus: sha256(focusScreenshot),
      },
      horizontalOverflow,
      focus: {
        reachable: focusSequence.length > 0,
        capture: "same-page-native",
        sequence: focusSequence,
        reportedTarget: reportedFocusTarget,
        activeElement: activeFocusElement,
        matchesReportedTarget,
      },
      actionAvailability,
      functional: {
        ...functional,
        failures: functionalFailures,
      },
      browserProblems: problems,
    } as const;
  } finally {
    await context.close();
  }
};

const readNativeValidationPageState = async (page: Page) =>
  page.evaluate(() => {
    const isVisible = (element: Element | null) => {
      if (!element) return false;
      const htmlElement = element as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        !htmlElement.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const readControl = (id: string) => {
      const element = document.getElementById(id);
      if (!(element instanceof HTMLInputElement)) {
        return {
          mounted: element !== null,
          visible: isVisible(element),
          value: null,
          required: null,
          validityValid: null,
        };
      }
      return {
        mounted: true,
        visible: isVisible(element),
        value: element.value,
        required: element.required,
        validityValid: element.validity.valid,
      };
    };
    const form = document.querySelector("#account-profile-form");
    const eligibleControlValidity =
      form instanceof HTMLFormElement
        ? Array.from(form.elements)
            .filter(
              (
                control
              ): control is
                | HTMLButtonElement
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement =>
                control instanceof HTMLButtonElement ||
                control instanceof HTMLInputElement ||
                control instanceof HTMLSelectElement ||
                control instanceof HTMLTextAreaElement
            )
            .filter((control) => control.willValidate)
            .map((control) => ({
              id: control.id,
              name: control.getAttribute("name") ?? "",
              tag: control.tagName.toLowerCase(),
              validityValid: control.validity.valid,
            }))
        : [];
    const profilePanel = document.querySelector("[data-slot='profile-screen']");
    const billingKind = document.querySelector("#account-profile-billing-kind");
    const billingPanel = billingKind?.closest("section") ?? null;
    const billing = {
      companyName: readControl("account-profile-billing-company-name"),
      companyId: readControl("account-profile-billing-company-id"),
      vatId: readControl("account-profile-billing-vat-id"),
      addressLine1: readControl("account-profile-billing-address-line1"),
      addressLine2: readControl("account-profile-billing-address-line2"),
      city: readControl("account-profile-billing-city"),
      zip: readControl("account-profile-billing-zip"),
      country: readControl("account-profile-billing-country"),
    };
    const firstName = readControl("account-profile-first-name");
    const phone = readControl("account-profile-phone");
    return {
      formMounted: document.querySelector("#account-profile-form") !== null,
      formValidityValid:
        form instanceof HTMLFormElement &&
        eligibleControlValidity.every(({ validityValid }) => validityValid),
      eligibleControlValidity,
      panels: {
        profile: isVisible(profilePanel),
        billing: isVisible(billingPanel),
      },
      firstName,
      companyName: billing.companyName,
      phone,
      billing,
      identityControlsValid:
        firstName.validityValid === true && phone.validityValid === true,
    };
  });

const installNativeInvalidObserver = async (page: Page) =>
  page.evaluate((propertyKey) => {
    const form = document.querySelector("#account-profile-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Native validation probe did not find the profile form");
    }
    type Observation = {
      readonly targetId: string;
      readonly targetName: string;
      readonly targetTag: string;
      readonly targetVisible: boolean;
      readonly targetValidityValid: boolean;
    };
    const observations: Observation[] = [];
    Object.defineProperty(form, propertyKey, {
      configurable: false,
      enumerable: false,
      value: observations,
      writable: false,
    });
    form.addEventListener(
      "invalid",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const rect = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        const validityTarget =
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
            ? target
            : null;
        observations.push({
          targetId: target.id,
          targetName: target.getAttribute("name") ?? "",
          targetTag: target.tagName.toLowerCase(),
          targetVisible:
            !target.hidden &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0,
          targetValidityValid: validityTarget?.validity.valid ?? true,
        });
      },
      { capture: true, passive: true }
    );
  }, nativeInvalidObservationKey);

const clearNativeInvalidObservations = async (page: Page) =>
  page.evaluate((propertyKey) => {
    const form = document.querySelector("#account-profile-form");
    if (!(form instanceof HTMLFormElement)) return;
    const observations = (
      form as HTMLFormElement & {
        readonly [nativeInvalidObservationKey]?: unknown;
      }
    )[propertyKey];
    if (Array.isArray(observations)) observations.length = 0;
  }, nativeInvalidObservationKey);

const readNativeInvalidObservations = async (
  page: Page
): Promise<readonly NativeInvalidObservation[]> =>
  Schema.decodeUnknownSync(nativeInvalidObservationsSchema)(
    await page.evaluate((propertyKey) => {
      const form = document.querySelector("#account-profile-form");
      if (!(form instanceof HTMLFormElement)) return [];
      const observations = (
        form as HTMLFormElement & {
          readonly [nativeInvalidObservationKey]?: unknown;
        }
      )[propertyKey];
      return Array.isArray(observations) ? observations.slice() : [];
    }, nativeInvalidObservationKey)
  );

const readNativeActionInvocationCount = async (page: Page) =>
  Schema.decodeUnknownSync(nativeActionInvocationCountSchema)(
    await page.evaluate(() => {
      const tracker = (
        globalThis as typeof globalThis & {
          readonly __accountVisualActionTracker?: {
            readonly invocationCount?: unknown;
          };
        }
      ).__accountVisualActionTracker;
      return tracker?.invocationCount ?? null;
    })
  );

const requestNativeSubmit = async (page: Page) =>
  page.evaluate(() => {
    const form = document.querySelector("#account-profile-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Native validation probe did not find the profile form");
    }
    form.requestSubmit();
  });

const waitForNativeReactPaint = async (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );

const isExpectedNativeValidationDiagnostic = ({
  kind,
  message,
}: BrowserProblem) =>
  kind === "console-error" &&
  message ===
    "An invalid form control with name='billingCompanyName' is not focusable.";

const makeFailedNativeValidationReport = (
  failures: readonly string[],
  browserProblems: readonly BrowserProblem[],
  actionInvocationCount: NativeValidationReport["actionInvocationCount"],
  navigation: NativeValidationReport["navigation"] = null
): NativeValidationReport => ({
  status: "failed",
  method: "fresh-browser-context-native-request-submit",
  adapter: displayPath(populatedAdapterPath),
  fixture:
    "synthetic Ada Native business billing with all non-target fields valid",
  context: "fresh-context-after-original-capture",
  initialScreenshotsUntouched: true,
  prohibitedOperations: {
    dispatchedInvalidEvent: false,
    unhiddenDom: false,
    enabledBackendActionControls: false,
  },
  navigation,
  syntheticInteractionDrafts: nativeSyntheticInteractionDrafts,
  firstSubmission: null,
  secondSubmission: null,
  draftsAfterSecondSubmission: null,
  actionInvocationCount,
  backendActionControls: [],
  expectedBrowserDiagnostics: browserProblems.filter(
    isExpectedNativeValidationDiagnostic
  ),
  browserProblems,
  pageErrors: browserProblems
    .filter(({ kind }) => kind === "page-error")
    .map(({ message }) => message),
  failures,
});

const runNativeValidationProbe = async ({
  baseUrl,
  browser,
  locale,
}: {
  readonly baseUrl: string;
  readonly browser: Browser;
  readonly locale: AccountVisualLocale;
}): Promise<NativeValidationReport> => {
  const browserProblems: BrowserProblem[] = [];
  let actionInvocationCount: NativeValidationReport["actionInvocationCount"] = {
    initial: null,
    beforeFirstSubmission: null,
    afterFirstSubmission: null,
    beforeSecondSubmission: null,
    afterSecondSubmission: null,
  };
  let navigation: NativeValidationReport["navigation"] = null;
  const context = await createContext(
    browser,
    baseUrl,
    browserProblems,
    { width: desktopCssWidth, height: 900 },
    desktopDeviceScaleFactor,
    locale
  );
  let page: Page | undefined;
  try {
    page = await loadRendererPage(context, baseUrl, "profile", browserProblems);
    const adapterMetadata = await readAdapterMetadata(page);
    actionInvocationCount = {
      ...actionInvocationCount,
      initial: await readNativeActionInvocationCount(page),
    };
    await installNativeInvalidObserver(page);

    const initialProfile = await selectProductionScreen(
      page,
      "profile",
      "desktop",
      false
    );
    navigation = {
      initialProfile,
      billing: initialProfile,
      backToProfile: initialProfile,
    };
    const failures: string[] = [];
    if (initialProfile.status !== "selected") {
      failures.push(
        `Native validation profile navigation failed: ${initialProfile.detail}`
      );
    }
    if (adapterMetadata.fixture.includes("synthetic") === false) {
      failures.push(
        "Native validation adapter fixture metadata was not synthetic"
      );
    }

    const firstName = page.locator("#account-profile-first-name");
    const phone = page.locator("#account-profile-phone");
    await firstName.fill("");
    await phone.fill(nativeSyntheticInteractionDrafts.phone);

    const billingSelection = await selectProductionScreen(
      page,
      "billing",
      "desktop",
      false
    );
    navigation = { ...navigation, billing: billingSelection };
    if (billingSelection.status !== "selected") {
      failures.push(
        `Native validation billing navigation failed: ${billingSelection.detail}`
      );
    }
    const billingKind = page.locator("#account-profile-billing-kind");
    if ((await billingKind.inputValue()) !== "business") {
      failures.push(
        "Native validation populated fixture did not render business billing"
      );
    }
    const billingInputs = {
      companyName: page.locator("#account-profile-billing-company-name"),
      companyId: page.locator("#account-profile-billing-company-id"),
      vatId: page.locator("#account-profile-billing-vat-id"),
      addressLine1: page.locator("#account-profile-billing-address-line1"),
      addressLine2: page.locator("#account-profile-billing-address-line2"),
      city: page.locator("#account-profile-billing-city"),
      zip: page.locator("#account-profile-billing-zip"),
      country: page.locator("#account-profile-billing-country"),
    } as const;
    for (const [field, input] of Object.entries(billingInputs)) {
      await input.fill(
        nativeSyntheticInteractionDrafts.billing[
          field as keyof NativeSyntheticBillingDrafts
        ]
      );
    }
    await billingInputs.companyName.fill("");

    const backToProfile = await selectProductionScreen(
      page,
      "profile",
      "desktop",
      false
    );
    navigation = { ...navigation, backToProfile };
    if (backToProfile.status !== "selected") {
      failures.push(
        `Native validation return to profile failed: ${backToProfile.detail}`
      );
    }

    await clearNativeInvalidObservations(page);
    actionInvocationCount = {
      ...actionInvocationCount,
      beforeFirstSubmission: await readNativeActionInvocationCount(page),
    };
    await requestNativeSubmit(page);
    await waitForNativeReactPaint(page);
    const firstState = await readNativeValidationPageState(page);
    const firstRequestInvalidEvents = await readNativeInvalidObservations(page);
    actionInvocationCount = {
      ...actionInvocationCount,
      afterFirstSubmission: await readNativeActionInvocationCount(page),
    };
    const firstSubmission: NativeValidationSubmission = {
      method: "HTMLFormElement.requestSubmit() via page.evaluate",
      blockedByNativeValidation:
        firstState.formValidityValid === false &&
        actionInvocationCount.beforeFirstSubmission ===
          actionInvocationCount.afterFirstSubmission,
      invalidEventSource: "requestSubmit",
      formValidityValid: firstState.formValidityValid,
      eligibleControlValidity: firstState.eligibleControlValidity,
      requestSubmitInvalidEvents: firstRequestInvalidEvents,
      visiblePanels: {
        profile: firstState.panels.profile,
        billing: firstState.panels.billing,
        selectors: {
          profile: "[data-slot='profile-screen']",
          billing: "#account-profile-billing-kind -> ancestor section",
        },
      },
      firstName: firstState.firstName,
      companyName: firstState.companyName,
      phone: firstState.phone,
      identityControlsValid: firstState.identityControlsValid,
    };
    if (!firstSubmission.blockedByNativeValidation) {
      failures.push(
        "First native requestSubmit was not blocked by native validation"
      );
    }
    if (
      !firstSubmission.visiblePanels.profile ||
      firstSubmission.visiblePanels.billing
    ) {
      failures.push(
        "First native invalid event did not leave the profile panel visible"
      );
    }
    if (firstSubmission.firstName.validityValid !== false) {
      failures.push(
        "First native invalid event did not reject the empty first name"
      );
    }
    if (
      !firstSubmission.companyName.mounted ||
      firstSubmission.companyName.visible ||
      firstSubmission.companyName.validityValid !== false
    ) {
      failures.push(
        "First native invalid event did not retain the hidden invalid company field"
      );
    }
    if (
      !firstSubmission.requestSubmitInvalidEvents.some(
        ({ targetId }) => targetId === "account-profile-first-name"
      )
    ) {
      failures.push(
        "First requestSubmit did not emit a native invalid event for firstName"
      );
    }

    await firstName.fill("Ada");
    await clearNativeInvalidObservations(page);
    actionInvocationCount = {
      ...actionInvocationCount,
      beforeSecondSubmission: await readNativeActionInvocationCount(page),
    };
    await requestNativeSubmit(page);
    await waitForNativeReactPaint(page);
    const secondState = await readNativeValidationPageState(page);
    const secondRequestInvalidEvents =
      await readNativeInvalidObservations(page);
    actionInvocationCount = {
      ...actionInvocationCount,
      afterSecondSubmission: await readNativeActionInvocationCount(page),
    };
    const secondSubmission: NativeValidationSubmission = {
      method: "HTMLFormElement.requestSubmit() via page.evaluate",
      blockedByNativeValidation:
        secondState.formValidityValid === false &&
        actionInvocationCount.beforeSecondSubmission ===
          actionInvocationCount.afterSecondSubmission,
      invalidEventSource: "requestSubmit",
      formValidityValid: secondState.formValidityValid,
      eligibleControlValidity: secondState.eligibleControlValidity,
      requestSubmitInvalidEvents: secondRequestInvalidEvents,
      visiblePanels: {
        profile: secondState.panels.profile,
        billing: secondState.panels.billing,
        selectors: {
          profile: "[data-slot='profile-screen']",
          billing: "#account-profile-billing-kind -> ancestor section",
        },
      },
      firstName: secondState.firstName,
      companyName: secondState.companyName,
      phone: secondState.phone,
      identityControlsValid: secondState.identityControlsValid,
    };
    if (!secondSubmission.blockedByNativeValidation) {
      failures.push(
        "Second native requestSubmit was not blocked by native validation"
      );
    }
    if (
      secondSubmission.visiblePanels.profile ||
      !secondSubmission.visiblePanels.billing
    ) {
      failures.push(
        "Second native invalid event did not switch to the billing panel"
      );
    }
    if (
      secondSubmission.companyName.validityValid !== false ||
      secondSubmission.companyName.visible !== true
    ) {
      failures.push(
        "Second native invalid event did not expose the invalid company field"
      );
    }
    if (!secondSubmission.identityControlsValid) {
      failures.push(
        "Second native invalid event left an identity control invalid"
      );
    }
    if (
      !secondSubmission.requestSubmitInvalidEvents.some(
        ({ targetId }) => targetId === "account-profile-billing-company-name"
      )
    ) {
      failures.push(
        "Second requestSubmit did not emit a native invalid event for companyName"
      );
    }

    const draftsAfterSecondSubmission = {
      firstName: secondState.firstName.value,
      phone: secondState.phone.value,
      billing: Object.fromEntries(
        Object.entries(secondState.billing).map(([field, control]) => [
          field,
          control.value ?? "",
        ])
      ) as NativeSyntheticBillingDrafts,
      preserved:
        secondState.firstName.value === "Ada" &&
        secondState.phone.value === nativeSyntheticInteractionDrafts.phone &&
        Object.entries(nativeSyntheticInteractionDrafts.billing).every(
          ([field, expected]) =>
            field === "companyName"
              ? secondState.billing.companyName.value === ""
              : secondState.billing[field as keyof typeof secondState.billing]
                  .value === expected
        ),
    };
    if (!draftsAfterSecondSubmission.preserved) {
      failures.push(
        "Native invalid reroute did not preserve phone and other billing drafts"
      );
    }

    const backendActionControls = await readActionAvailability(page);
    if (
      backendActionControls.some(
        ({ present, disabled }) => present && disabled !== true
      )
    ) {
      failures.push(
        "Native validation probe observed an enabled backend action control"
      );
    }
    const expectedBrowserDiagnostics = browserProblems.filter(
      isExpectedNativeValidationDiagnostic
    );
    failures.push(
      ...browserProblems
        .filter((problem) => !isExpectedNativeValidationDiagnostic(problem))
        .map(({ kind, message }) => `${kind}: ${message}`)
    );
    failures.push(
      ...(Object.values(actionInvocationCount).some((count) => count !== 0)
        ? [
            `Native validation action invocation counter was not zero: ${JSON.stringify(actionInvocationCount)}`,
          ]
        : []),
      ...(Object.values(actionInvocationCount).some((count) => count === null)
        ? ["Native validation action invocation counter was unavailable"]
        : [])
    );
    return {
      status: failures.length === 0 ? "passed" : "failed",
      method: "fresh-browser-context-native-request-submit",
      adapter: displayPath(populatedAdapterPath),
      fixture: adapterMetadata.fixture,
      context: "fresh-context-after-original-capture",
      initialScreenshotsUntouched: true,
      prohibitedOperations: {
        dispatchedInvalidEvent: false,
        unhiddenDom: false,
        enabledBackendActionControls: false,
      },
      navigation,
      syntheticInteractionDrafts: nativeSyntheticInteractionDrafts,
      firstSubmission,
      secondSubmission,
      draftsAfterSecondSubmission,
      actionInvocationCount,
      backendActionControls,
      expectedBrowserDiagnostics,
      browserProblems,
      pageErrors: browserProblems
        .filter(({ kind }) => kind === "page-error")
        .map(({ message }) => message),
      failures,
    };
  } catch (error) {
    const failures = [error instanceof Error ? error.message : String(error)];
    failures.push(
      ...browserProblems
        .filter((problem) => !isExpectedNativeValidationDiagnostic(problem))
        .map(({ kind, message }) => `${kind}: ${message}`)
    );
    return makeFailedNativeValidationReport(
      failures,
      browserProblems,
      actionInvocationCount,
      navigation
    );
  } finally {
    await page?.close();
    await context.close();
  }
};

const makeUniqueRunDirectory = async (outputRoot: string, label: string) => {
  const resolvedOutputRoot = resolve(outputRoot);
  if (!isWithin(defaultOutputRoot, resolvedOutputRoot)) {
    throw new Error(
      `--output must remain under ${defaultOutputRoot}; received ${resolvedOutputRoot}`
    );
  }
  await mkdir(resolvedOutputRoot, { recursive: true });
  let suffix = 1;
  while (true) {
    const directoryName = suffix === 1 ? label : `${label}-${suffix}`;
    const candidate = join(resolvedOutputRoot, directoryName);
    if (!(await fileExists(candidate))) {
      await mkdir(candidate);
      return candidate;
    }
    suffix += 1;
  }
};

const makeReferenceReport = (reference: ReferenceAsset) => ({
  filename: basename(reference.path),
  sha256: reference.sha256,
  bytes: reference.bytes,
  format: reference.format,
  nativeWidth: reference.width,
  nativeHeight: reference.height,
  channels: reference.channels,
});

export const makeComparisonMetadata = (
  adapterPath: string,
  captureLocale: AccountVisualLocale
): AccountVisualComparisonMetadata => {
  const isDefaultFixture = adapterPath === defaultAdapterPath;
  const copyMismatch = captureLocale !== referenceLocale;
  const controlledComparability = false;
  let controlledComparabilityCaveat: string;
  if (copyMismatch) {
    controlledComparabilityCaveat = `historical baseline is not controlled: capture copy locale ${captureLocale} differs from reference locale ${referenceLocale}; renderer annotation layout changed`;
  } else if (isDefaultFixture) {
    controlledComparabilityCaveat =
      "historical baseline is not controlled: prior renderer annotation changed layout";
  } else {
    controlledComparabilityCaveat =
      "historical baseline is not controlled: fixture differs from the default baseline and renderer annotation layout changed";
  }
  return {
    referenceLocale,
    captureLocale,
    copyMismatch,
    fixture: displayPath(adapterPath),
    rendererMethodVersion: accountVisualRendererMethodVersion,
    historicalBaselineComparability: false,
    historicalBaselineComparabilityReason:
      accountVisualHistoricalBaselineComparabilityReason,
    iterationComparabilityRule: accountVisualIterationComparabilityRule,
    controlledComparability,
    controlledComparabilityCaveat,
  };
};

const makeExecutionFindings = (screens: readonly ScreenReport[]) =>
  screens.flatMap(({ screen, desktop, mobile }) => [
    ...desktop.browserProblems.map(
      ({ kind, message }) => `${screen} desktop ${kind}: ${message}`
    ),
    ...desktop.functionalFailures.map(
      (message) => `${screen} desktop: ${message}`
    ),
    ...Object.entries(mobile).flatMap(([width, evidence]) => [
      ...evidence.browserProblems.map(
        ({ kind, message }) => `${screen} mobile ${width} ${kind}: ${message}`
      ),
      ...evidence.functional.failures.map(
        (message) => `${screen} mobile ${width}: ${message}`
      ),
      ...(evidence.horizontalOverflow.documentOverflow
        ? [
            `${screen} mobile ${width}: document scrollWidth ${evidence.horizontalOverflow.documentScrollWidth} exceeds viewportWidth ${evidence.horizontalOverflow.viewportWidth}`,
          ]
        : []),
      ...(evidence.horizontalOverflow.bodyOverflow
        ? [
            `${screen} mobile ${width}: body scrollWidth ${evidence.horizontalOverflow.bodyScrollWidth} exceeds viewportWidth ${evidence.horizontalOverflow.viewportWidth}`,
          ]
        : []),
      ...(evidence.horizontalOverflow.offenders.length > 0
        ? [
            `${screen} mobile ${width}: ${evidence.horizontalOverflow.offenders.length} horizontal overflow offender(s)`,
          ]
        : []),
    ]),
  ]);

export const run = async (options: CliOptions) => {
  const desktopCapture = getDesktopCaptureSettings(options.tablet);
  const outputDirectory = await makeUniqueRunDirectory(
    options.outputRoot,
    options.label
  );
  const selectedScreens = options.screen
    ? [options.screen]
    : [...accountVisualScreens];
  const adapterPath = await resolveAdapterPath(options.adapterPath);
  const isCallerAdapter =
    adapterPath !== defaultAdapterPath && adapterPath !== populatedAdapterPath;
  const references = new Map<AccountVisualScreen, ReferenceAsset>();
  for (const screen of selectedScreens) {
    references.set(
      screen,
      await loadReferenceAsset(resolve(options.referencesDir), screen)
    );
  }
  const menu = await loadMenuMetadata(resolve(options.referencesDir));
  const regularFont = await readFile(fontPaths.regular);
  const italicFont = await readFile(fontPaths.italic);
  const rendererCss = await readFile(rendererCssPath);
  let bundle: Awaited<ReturnType<typeof buildBundle>>;
  try {
    bundle = await buildBundle(outputDirectory, adapterPath, options.locale);
  } finally {
    await rm(buildEntryPathForRun(outputDirectory), { force: true });
  }
  const sourceManifestPath = join(outputDirectory, "source-manifest.json");
  const sourceManifestBytes = Buffer.from(
    `${JSON.stringify(bundle.manifest, null, 2)}\n`
  );
  await writeFile(sourceManifestPath, sourceManifestBytes);
  const sourceManifest = {
    path: "source-manifest.json",
    sha256: sha256(sourceManifestBytes),
    bytes: sourceManifestBytes.byteLength,
  } as const;
  const actualAccountPageBytes = await readFile(actualAccountPagePath);
  const actualGlobalsCssBytes = await readFile(actualGlobalsPath);
  const actualSourceSnapshot = {
    capturedFrom: "current worktree at renderer invocation",
    accountPage: {
      path: displayPath(actualAccountPagePath),
      sha256: sha256(actualAccountPageBytes),
      bytes: actualAccountPageBytes.byteLength,
    },
    globalsCss: {
      path: displayPath(actualGlobalsPath),
      sha256: sha256(actualGlobalsCssBytes),
      bytes: actualGlobalsCssBytes.byteLength,
    },
  } as const;

  const staticServer = await makeStaticServer(
    bundle.javascriptPath,
    bundle.cssPath,
    rendererCss,
    regularFont,
    italicFont,
    options.locale,
    options.port
  );
  let browser: Browser | undefined;
  let browserVersion = "";
  const screenReports: ScreenReport[] = [];
  let nativeValidation: NativeValidationReport | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    browserVersion = browser.version();
    for (const screen of selectedScreens) {
      const reference = references.get(screen);
      if (!reference) throw new Error(`Missing loaded reference for ${screen}`);
      const screenDirectory = join(outputDirectory, screen);
      await mkdir(screenDirectory);
      const desktop = await runDesktopCapture({
        baseUrl: staticServer.baseUrl,
        browser,
        desktop: desktopCapture,
        isCallerAdapter,
        locale: options.locale,
        reference,
        screen,
        screenDirectory,
      });
      const mobile: Partial<
        Record<`${(typeof mobileCssWidths)[number]}`, MobileEvidence>
      > = {};
      for (const width of mobileCssWidths) {
        const mobileDirectory = join(screenDirectory, "mobile", String(width));
        await mkdir(mobileDirectory, { recursive: true });
        mobile[String(width) as `${(typeof mobileCssWidths)[number]}`] =
          await runMobileCapture({
            baseUrl: staticServer.baseUrl,
            browser,
            isCallerAdapter,
            locale: options.locale,
            screen,
            width,
            screenDirectory: mobileDirectory,
          });
      }
      let coverageStatus: ScreenReport["coverage"]["status"];
      if (desktop.selection.status === "adapter-defined") {
        coverageStatus = "adapter-defined";
      } else if (desktop.selection.status === "failed") {
        coverageStatus = "selection-failed";
      } else {
        coverageStatus =
          desktop.captureKind === "main" ? "rendered" : "missing";
      }
      const coverageSource: ScreenReport["coverage"]["source"] =
        desktop.selection.status === "selected"
          ? "production-account-shell"
          : "adapter-defined";
      let coverageNote: string;
      if (desktop.selection.status === "selected") {
        if (desktop.routeComponent === "PublicAccountLegal") {
          coverageNote =
            "The requested section was selected through the current production AccountShell and captured from the observed PublicAccountLegal component on the simulated public legal route; this visual fixture does not prove route or authentication behavior.";
        } else if (desktop.routeComponent === "AccountPage") {
          coverageNote =
            "The requested section was selected through the current production AccountShell and captured from the observed AccountPage component on the simulated private account route; this visual fixture does not prove route or authentication behavior.";
        } else {
          coverageNote =
            "The requested section was selected through the current production AccountShell, but the renderer exposed no route component wrapper; no component, route, or authentication claim is made.";
        }
      } else if (desktop.selection.status === "adapter-defined") {
        coverageNote =
          "The supplied adapter did not render the production AccountShell; screen composition remains adapter-defined and no production selection is claimed.";
      } else {
        coverageNote = desktop.selection.detail;
      }
      screenReports.push({
        screen,
        reference: makeReferenceReport(reference),
        coverage: {
          status: coverageStatus,
          source: coverageSource,
          selection: desktop.selection.status,
          component: desktop.routeComponent,
          note: coverageNote,
        },
        desktop,
        mobile: mobile as Record<
          `${(typeof mobileCssWidths)[number]}`,
          MobileEvidence
        >,
      });
    }
    if (adapterPath === populatedAdapterPath) {
      nativeValidation = await runNativeValidationProbe({
        baseUrl: staticServer.baseUrl,
        browser,
        locale: options.locale,
      });
    }
  } finally {
    await browser?.close();
    await staticServer.server.stop(true);
  }

  const fontSha = {
    regular: {
      path: displayPath(fontPaths.regular),
      sha256: sha256(regularFont),
      bytes: regularFont.byteLength,
    },
    italic: {
      path: displayPath(fontPaths.italic),
      sha256: sha256(italicFont),
      bytes: italicFont.byteLength,
    },
  } as const;
  const executionFindings = [
    ...makeExecutionFindings(screenReports),
    ...(nativeValidation?.failures.map(
      (failure) => `native validation: ${failure}`
    ) ?? []),
  ];
  const executionStatus =
    executionFindings.length === 0 ? "passed" : "completed-with-findings";
  const execution = {
    schemaVersion: 1,
    status: executionStatus,
    label: options.label,
    outputDirectory,
    selectedScreens,
    sourceManifest,
    sourceFiles: bundle.manifest.ownedSources,
    metricRows: screenReports.map(({ screen, reference, desktop }) => ({
      screen,
      referenceNativePixels: {
        width: reference.nativeWidth,
        height: reference.nativeHeight,
      },
      captureCssPixels: desktop.mainCssDimensions,
      capturePhysicalPixels: desktop.mainPhysicalDimensions,
      meanAbsoluteRgbError: desktop.metrics.meanAbsoluteRgbError,
      mismatchPercentage: desktop.metrics.mismatchPercentage,
      maxChannelDelta: desktop.metrics.maxChannelDelta,
      pixelCount: desktop.metrics.pixelCount,
    })),
    nativeValidation,
    findings: executionFindings,
  } as const;
  const report = {
    schemaVersion: 1,
    label: options.label,
    outputDirectory,
    scope: {
      kind: "component-only",
      fullRouteSiteChrome: "unavailable",
      parentIntegration: "must be proved separately",
      omittedRouteBoundaries: [
        "SiteHeader",
        "PageNavigationBoundary",
        "PublicSiteFooter",
        "UnsavedChangesProvider (default confirm=true context)",
      ],
      bypasses: [
        "Build-time @/env alias supplies explicit undefined NEXT_PUBLIC_POSTHOG_HOST and NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN values for visual-only rendering; no real client environment or cookie stub is used.",
        "The actual local vanilla-cookieconsent library is initialized with createConsentConfig(locale) and autoShow=false; its banner and analytics runtime are omitted, screenshots precede consent interaction with the default state unmutated, and no fake consent state or external network is used.",
      ],
    },
    renderer: {
      browserEntry: displayPath(rendererEntryPath),
      actualAccountPage: displayPath(actualAccountPagePath),
      actualGlobalsCss: displayPath(actualGlobalsPath),
      actualSourceSnapshot,
      postCssConfig: displayPath(postCssConfigPath),
      adapter: displayPath(adapterPath),
      adapterMetadata: screenReports[0]?.desktop.adapterMetadata ?? null,
      buildManifest: sourceManifest,
      ownedSources: bundle.manifest.ownedSources,
      isolatedCss: {
        path: displayPath(rendererCssPath),
        variable: "--site-header-height",
        value: "0px",
        purpose:
          "Main-only references exclude the site header; runtime styles are not modified.",
      },
      typeImportsErased: [
        displayPath(join(appRoot, "features/account/page-data.server.ts")),
      ],
    },
    fixture: options.adapterPath ? null : defaultFixtureReport,
    environment: {
      bunVersion: Bun.version,
      browser: `Chromium ${browserVersion}`,
      server: {
        port: options.port,
        ownership: "single renderer process",
        concurrency: "sequential screens and runs only",
        occupiedPort: "fail without stopping another process",
      },
      viewport: {
        desktopCssWidth: desktopCapture.cssWidth,
        desktopPhysicalWidth: desktopCapture.physicalWidth,
        desktopDeviceScaleFactor: desktopCapture.deviceScaleFactor,
        desktopMode: desktopCapture.mode,
        desktopCssHeight: `Math.round(reference physical height / ${desktopCapture.deviceScaleFactor}) per screen`,
        desktopPhysicalHeight: `desktop CSS height * ${desktopCapture.deviceScaleFactor} per screen`,
        mobileCssWidths,
        mobileCssHeight,
      },
      clock: fixedClockIso,
      timeZone,
      locale: options.locale,
      reducedMotion: "reduce",
      fonts: {
        wait: "document.fonts.load + document.fonts.ready",
        sha256: fontSha,
      },
    },
    comparison: {
      referenceDirectory: resolve(options.referencesDir),
      ...makeComparisonMetadata(adapterPath, options.locale),
      nativeReferencePixelsPreserved: true,
      scaling: "none",
      canvas:
        "reference-sized top-left crop/pad in physical reference pixels; actual capture is never resized",
      referenceCapture: {
        pixels: "native PNG metadata; no resize",
        cssViewport: "unknown",
        deviceScaleFactor: "unknown",
      },
      standardDesktopCapture: {
        mode: desktopCapture.mode,
        cssWidth: desktopCapture.cssWidth,
        cssHeight: `Math.round(reference physical height / ${desktopCapture.deviceScaleFactor}) per screen`,
        physicalWidth: desktopCapture.physicalWidth,
        physicalHeight: `${desktopCapture.deviceScaleFactor} * rounded CSS height per screen`,
        deviceScaleFactor: desktopCapture.deviceScaleFactor,
        interpretation: "chosen",
        note: "Reference CSS viewport and DPR metadata are unknown; this is a chosen interpretation, not original metadata.",
        justification:
          desktopCapture.mode === "standard"
            ? "The reference sidebar is about 560 physical px (about 280 CSS px) and an input is about 84 physical px (about 42 CSS px), which supports DPR 2 at 1280 CSS px for a 2560 physical-pixel comparison."
            : "Tablet mode is an explicitly requested 768 CSS px, DPR 1 probe; it is not a claim about the original reference capture metadata.",
        oddHeightRounding: `Math.round(reference physical height / ${desktopCapture.deviceScaleFactor}); .5 rounds up`,
      },
      padding: {
        color: "#ffffff",
        rgba: comparisonPaddingColor,
        placement: "top-left",
      },
      threshold: "max channel delta > 16",
      regionGeometry: accountMetricRegionGeometry,
      regions: accountMetricRegionsByScreen(
        screenReports.map(({ screen, reference }) => ({
          screen,
          width: reference.nativeWidth,
          height: reference.nativeHeight,
        }))
      ),
    },
    references: {
      menuMetadataOnly: menu,
      screens: screenReports.map(({ reference }) => reference),
    },
    execution: {
      status: execution.status,
      evidence: "execution.json",
    },
    nativeValidation,
    screens: screenReports,
  } as const;
  await writeFile(
    join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(outputDirectory, "execution.json"),
    `${JSON.stringify(execution, null, 2)}\n`,
    "utf8"
  );
  return report;
};

if (import.meta.main) {
  try {
    const options = parseCliArgs(Bun.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP_TEXT);
    } else {
      const report = await run(options);
      process.stdout.write(
        `${JSON.stringify(
          {
            label: report.label,
            outputDirectory: report.outputDirectory,
            screens: report.screens.map((screen) => ({
              screen: screen.screen,
              meanAbsoluteRgbError: screen.desktop.metrics.meanAbsoluteRgbError,
              mismatchPercentage: screen.desktop.metrics.mismatchPercentage,
              mainCssDimensions: screen.desktop.mainCssDimensions,
              mainPhysicalDimensions: screen.desktop.mainPhysicalDimensions,
            })),
          },
          null,
          2
        )}\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : "Account visual renderer failed"}\n`
    );
    process.exitCode = 1;
  }
}
