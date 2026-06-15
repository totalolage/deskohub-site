/**
 * Analytics Feature Module
 * Public API exports
 */

export { useGTMPageView } from "./hooks/use-gtm";
export {
  type GTMEvent,
  sendGTMEvent,
  trackButtonClick,
  trackCustomEvent,
  trackFormSubmit,
  trackPageView,
} from "./utils/gtm-events";
