import { connection } from "next/server";
import { env } from "@/env";
import { markUnindexedResponse } from "@/shared/utils/unindexed-response";
import { nativeApp } from "./native-app";

/** The site paths the native app opens instead of the browser. */
const appPathPattern = "/app/*";

/**
 * Android's Digital Asset Links statement for the release-signed app: it may
 * use the site's passkeys and saved sign-ins, and open its links. Android
 * verifies the file only from a 200 `application/json` response without a
 * redirect, so it is a plain route outside the proxy and locale rewrites.
 */
const androidAssetLinks = [
  {
    relation: [
      "delegate_permission/common.get_login_creds",
      "delegate_permission/common.handle_all_urls",
    ],
    target: {
      namespace: "android_app",
      package_name: nativeApp.applicationId,
      sha256_cert_fingerprints: [nativeApp.androidReleaseCertificate],
    },
  },
] as const;

// Exactly `application/json`, which Android checks, in every runtime.
const jsonHeaders = { "Content-Type": "application/json" };

export function serveAndroidAssetLinks() {
  return markUnindexedResponse(
    Response.json(androidAssetLinks, { headers: jsonHeaders })
  );
}

/**
 * Apple's app site association for the team's app: passkeys through
 * `webcredentials` and the app paths through universal links. Apple app IDs
 * are the team ID and the bundle ID.
 */
const appleAppSiteAssociation = (teamId: string) => {
  const appId = `${teamId}.${nativeApp.applicationId}`;
  return {
    applinks: {
      details: [{ appIDs: [appId], components: [{ "/": appPathPattern }] }],
    },
    webcredentials: { apps: [appId] },
  };
};

/**
 * Serves the association while an Apple team is configured, else not found.
 * Read per request, so setting the team ID needs no new build.
 */
export async function serveAppleAppSiteAssociation() {
  await connection();

  const teamId = env.APPLE_TEAM_ID;
  if (teamId === undefined) return new Response(null, { status: 404 });

  return markUnindexedResponse(
    Response.json(appleAppSiteAssociation(teamId), { headers: jsonHeaders })
  );
}
