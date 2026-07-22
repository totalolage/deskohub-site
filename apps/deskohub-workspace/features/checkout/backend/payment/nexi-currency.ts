import { env } from "@/env";

export const getNexiCurrencyOverride = () => {
  if (env.VERCEL_ENV === "production") return undefined;
  if (new URL(env.NEXI_API_ORIGIN).hostname !== "xpaysandbox.nexigroup.com") {
    return undefined;
  }
  return env.NEXI_CHECKOUT_CURRENCY_OVERRIDE;
};
