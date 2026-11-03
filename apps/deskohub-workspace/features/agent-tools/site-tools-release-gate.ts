import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/**
 * `webmcp_site_tools`: whether the public agent tools register as browser
 * site tools.
 */
export class SiteToolsReleaseGate extends ReleaseGate<SiteToolsReleaseGate>()(
  "@deskohub-workspace/agent-tools/SiteToolsReleaseGate",
  "webmcp_site_tools"
) {}
