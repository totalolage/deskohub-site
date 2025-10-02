/**
 * Google Tag Manager Event Tracking Utilities
 */

export interface GTMEvent {
  event: string;
  [key: string]: unknown;
}

/**
 * Send a custom event to Google Tag Manager
 */
export function sendGTMEvent(event: GTMEvent): void {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
}

/**
 * Track page view
 */
export function trackPageView(url: string): void {
  sendGTMEvent({
    event: "page_view",
    page_path: url,
  });
}

/**
 * Track button click
 */
export function trackButtonClick(buttonName: string, location?: string): void {
  sendGTMEvent({
    event: "button_click",
    button_name: buttonName,
    button_location: location,
  });
}

/**
 * Track form submission
 */
export function trackFormSubmit(formName: string, success: boolean): void {
  sendGTMEvent({
    event: "form_submit",
    form_name: formName,
    form_success: success,
  });
}

/**
 * Track custom event
 */
export function trackCustomEvent(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  sendGTMEvent({
    event: eventName,
    ...properties,
  });
}
