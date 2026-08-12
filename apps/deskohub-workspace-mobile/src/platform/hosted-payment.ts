import type { PlatformOSType } from "react-native";

type HostedPaymentEffects<Result> = Readonly<{
  navigateWeb: (url: string) => void;
  openNativeSession: (url: string, returnUrl: string) => Promise<unknown>;
  reconcile: (orderId: string) => Promise<Result>;
}>;

export function getHostedPaymentReturnUrl(appOrigin: string, orderId: string) {
  return new URL(
    `/payment/${encodeURIComponent(orderId)}`,
    appOrigin
  ).toString();
}

export async function completeHostedPayment<Result>(
  input: Readonly<{
    appOrigin: string;
    hostedPaymentUrl: string;
    orderId: string;
    platform: PlatformOSType;
  }>,
  effects: HostedPaymentEffects<Result>
): Promise<Result | null> {
  if (input.platform === "web") {
    effects.navigateWeb(input.hostedPaymentUrl);
    return null;
  }

  await effects.openNativeSession(
    input.hostedPaymentUrl,
    getHostedPaymentReturnUrl(input.appOrigin, input.orderId)
  );
  return effects.reconcile(input.orderId);
}
