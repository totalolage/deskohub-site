/**
 * Whether the page already runs posthog-js. Its snippet build assigns
 * `window.posthog` (posthog-js 1.438.1 `init_from_snippet`); a second SDK in
 * the same page would double-capture, so app analytics stays off then.
 */
export const detectOtherPostHogSdk = (page: object): boolean => {
  const candidate = (page as { readonly posthog?: unknown }).posthog;
  return typeof candidate === "object" && candidate !== null;
};
