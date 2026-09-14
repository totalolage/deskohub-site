import type {
  BeforeSendFn,
  CapturedNetworkRequest,
  PostHogConfig,
} from "posthog-js";
import { normalizeHostname } from "@/shared/utils/hostname";
import { createPostHogPageUrl } from "./posthog-url";

/**
 * Deployment contract: browser telemetry must use an absolute HTTP(S) URL on
 * a hostname different from the application hostname and without credentials.
 */
export function isPostHogTelemetryHostAllowed(
  telemetryHost: string,
  applicationHostname: string
) {
  const normalizedApplicationHostname = normalizeHostname(applicationHostname);
  if (!normalizedApplicationHostname) return false;

  try {
    const telemetryUrl = new URL(telemetryHost);
    if (
      (telemetryUrl.protocol !== "http:" &&
        telemetryUrl.protocol !== "https:") ||
      telemetryUrl.username !== "" ||
      telemetryUrl.password !== ""
    ) {
      return false;
    }

    const normalizedTelemetryHostname = normalizeHostname(
      telemetryUrl.hostname
    );
    if (!normalizedTelemetryHostname) return false;

    return normalizedTelemetryHostname !== normalizedApplicationHostname;
  } catch {
    return false;
  }
}

type PostHogConfigOptions = {
  readonly apiHost: string;
  readonly beforeSend: BeforeSendFn;
  readonly optOutUseragentFilter: boolean;
};

export function createPostHogConfig({
  apiHost,
  beforeSend,
  optOutUseragentFilter,
}: PostHogConfigOptions) {
  return {
    api_host: apiHost,
    autocapture: false,
    before_send: beforeSend,
    capture_exceptions: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_pageleave: false,
    capture_pageview: false,
    defaults: "2026-01-30",
    disable_capture_url_hashes: true,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    internal_or_test_user_hostname: null,
    mask_all_text: true,
    opt_out_useragent_filter: optOutUseragentFilter,
    person_profiles: "identified_only",
    rageclick: false,
    save_campaign_params: false,
    save_referrer: false,
    // Replay is disabled for this release. Keep these rrweb-safe defaults for a
    // future policy-reviewed re-enable, without relying on element-attribute masking.
    session_recording: {
      maskAllInputs: true,
      maskCapturedNetworkRequestFn: maskCapturedNetworkRequest,
      maskTextSelector: "body",
      recordBody: false,
      recordHeaders: false,
    },
    tracing_headers: [],
  } satisfies Partial<PostHogConfig>;
}

function maskCapturedNetworkRequest(
  request: CapturedNetworkRequest
): CapturedNetworkRequest | null {
  try {
    return {
      ...request,
      name: createPostHogPageUrl(request.name),
      requestBody: undefined,
      requestHeaders: undefined,
      responseBody: undefined,
      responseHeaders: undefined,
    };
  } catch {
    return null;
  }
}
