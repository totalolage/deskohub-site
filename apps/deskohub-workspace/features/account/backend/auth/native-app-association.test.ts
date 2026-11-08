// Bun skips dot directories when it collects tests, so the `.well-known`
// routes are covered here, next to their handlers.

import { describe, expect, mock, test } from "bun:test";
import * as envModule from "@/env";

// Outside a request, Next's `connection()` throws; the Apple route calls it
// so the build never prerenders the team ID of the build environment.
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: mock(() => Promise.resolve()),
}));

// The workspace env object is read once at import; route the team ID
// through a switchable override so one file covers a set and an unset one.
let appleTeamId: string | undefined;
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "APPLE_TEAM_ID" ? appleTeamId : Reflect.get(target, key),
  }),
}));

const assetLinksRoute = await import("@/app/.well-known/assetlinks.json/route");
const appleAssociationRoute = await import(
  "@/app/.well-known/apple-app-site-association/route"
);

describe("Android digital asset links", () => {
  test("lets the release-signed app use the site's passkeys and links", async () => {
    const response = assetLinksRoute.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.json()).toEqual([
      {
        relation: [
          "delegate_permission/common.get_login_creds",
          "delegate_permission/common.handle_all_urls",
        ],
        target: {
          namespace: "android_app",
          package_name: "cz.deskohub.workspace",
          sha256_cert_fingerprints: [
            "69:42:8E:71:15:01:75:FC:0E:84:52:03:54:42:A8:A1:19:86:4C:21:D0:AB:E9:C8:E2:33:A0:54:2E:C9:4A:A0",
          ],
        },
      },
    ]);
  });
});

describe("Apple app site association", () => {
  test("is not found while no Apple team is configured", async () => {
    appleTeamId = undefined;
    const response = await appleAssociationRoute.GET();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  test("associates the team's app with passkeys and the app paths", async () => {
    appleTeamId = "ABCDE12345";
    const response = await appleAssociationRoute.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.cz.deskohub.workspace"],
            components: [{ "/": "/app/*" }],
          },
        ],
      },
      webcredentials: { apps: ["ABCDE12345.cz.deskohub.workspace"] },
    });
  });
});
