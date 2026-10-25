import { connection } from "next/server";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import { markUnindexedResponse } from "@/shared/utils/unindexed-response";

const securityTxtPathname = "/.well-known/security.txt";

const dayMilliseconds = 24 * 60 * 60 * 1000;

/**
 * The RFC 9116 security contact file. `Expires` stays just under a year
 * ahead of the day it is served, as the RFC recommends: the contacts come
 * from the site constants, so every deployment serves current ones.
 */
export const securityTxt = (now: Date) => {
  const today = Math.floor(now.getTime() / dayMilliseconds) * dayMilliseconds;
  const expires = new Date(today + 364 * dayMilliseconds);

  return [
    `Contact: mailto:${workspaceSiteConstants.contact.infoEmail}`,
    `Contact: ${getWorkspaceCanonicalUrl("/contact")}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: cs, en",
    `Canonical: ${getWorkspaceCanonicalUrl(securityTxtPathname)}`,
    "",
  ].join("\n");
};

/** Serves `securityTxt` per request, so `Expires` never ages with a build. */
export async function serveSecurityTxt() {
  await connection();

  return markUnindexedResponse(
    new Response(securityTxt(new Date()), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}
