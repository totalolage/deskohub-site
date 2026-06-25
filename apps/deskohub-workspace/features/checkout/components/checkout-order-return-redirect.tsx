"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  checkoutReturnStateTokenQueryParam,
  parseCheckoutReturnStateToken,
} from "@/features/checkout/schemas/checkout-return-state-token";
import type { Locale } from "@/features/i18n";

type CheckoutOrderReturnRedirectProps = {
  locale: Locale;
};

export function CheckoutOrderReturnRedirect({
  locale,
}: CheckoutOrderReturnRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("paymentOrderId")?.trim();
    const token = parseCheckoutReturnStateToken(
      params.get(checkoutReturnStateTokenQueryParam) ?? undefined
    );

    if (!orderId || !token) return;

    const url = new URL(
      `/${locale}/checkout/status/${encodeURIComponent(orderId)}`,
      window.location.origin
    );
    url.searchParams.set(checkoutReturnStateTokenQueryParam, token);

    router.replace(`${url.pathname}${url.search}`);
  }, [locale, router]);

  return null;
}
