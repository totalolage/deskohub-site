/**
 * The app a hosted payment returns the customer to: the installed native app
 * or the web app. A checkout without one returns to the site's reservation
 * status page.
 */
export const paymentReturnTargets = ["native-app", "web-app"] as const;

export type PaymentReturnTarget = (typeof paymentReturnTargets)[number];
