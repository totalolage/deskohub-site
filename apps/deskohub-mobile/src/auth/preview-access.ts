/**
 * Access to a deployment-protected Vercel preview from a development build.
 * The bypass value comes from `EXPO_PUBLIC_DEV_VERCEL_PROTECTION_BYPASS`,
 * which only a local, uncommitted environment sets when Metro bundles a
 * development build; release bundles never read it. Native requests then send
 * Vercel's bypass header, and the in-app auth session's first page load asks
 * Vercel to set its bypass cookie (Vercel answers with a redirect that drops
 * the bypass parameters).
 */
export interface PreviewAccess {
  readonly bypass: () => string;
}

export const developmentPreviewAccess = (
  development: boolean,
  configured: string | undefined
): PreviewAccess | undefined => {
  const value = configured?.trim();
  if (!development || !value) return undefined;
  // A function keeps the value out of logs, string conversion and JSON.
  return { bypass: () => value };
};

export const previewAccessHeaders = (
  access: PreviewAccess | undefined
): Record<string, string> =>
  access === undefined ? {} : { "x-vercel-protection-bypass": access.bypass() };

export const withPreviewAccessCookie = (
  url: string,
  access: PreviewAccess | undefined
): string => {
  if (access === undefined) return url;
  const withBypass = new URL(url);
  withBypass.searchParams.set("x-vercel-protection-bypass", access.bypass());
  withBypass.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return withBypass.toString();
};
