/**
 * How Android Browser Helper would open a page with the browser it picked:
 * as a Trusted Web Activity, as a Custom Tab, or as a plain browser page.
 */
export type TrustedWebActivityLaunchMode =
  | "trusted-web-activity"
  | "custom-tab"
  | "browser";

export interface TrustedWebActivityProvider {
  readonly packageName: string;
  readonly launchMode: TrustedWebActivityLaunchMode;
}

/** Hex colours (`#rrggbb`) for the browser's status and navigation bars. */
export interface TrustedWebActivityColors {
  readonly toolbar: string;
  readonly navigationBar: string;
}

export interface TrustedWebActivity {
  /**
   * The browser to open pages with, or `null` when there is none or the app
   * has no native Trusted Web Activity support (iOS, web, tests).
   */
  readonly findProvider: () => TrustedWebActivityProvider | null;
  /**
   * Asks `provider` to show `url`; resolves once it has. A browser that
   * can't verify the page's origin shows it as a Custom Tab instead.
   */
  readonly launch: (
    url: string,
    provider: TrustedWebActivityProvider,
    colors: TrustedWebActivityColors
  ) => Promise<void>;
  /** Drops the connection to the browser that the last launch opened. */
  readonly release: () => Promise<void>;
}
