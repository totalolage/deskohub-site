import { env } from "@/env";

export const appendVercelPreviewProtectionBypass = (
  url: URL,
  options: { readonly setBypassCookie?: boolean } = {}
) => {
  if (env.VERCEL_ENV === "production") return;
  if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) return;

  url.searchParams.set(
    "x-vercel-protection-bypass",
    env.VERCEL_AUTOMATION_BYPASS_SECRET
  );

  if (options.setBypassCookie) {
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
  }
};
