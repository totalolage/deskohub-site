import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

export const WORKSPACE_ADMIN_API_VERSION = "v1" as const;

export const AdminCliInfo = Schema.Struct({
  apiVersion: Schema.Literal(WORKSPACE_ADMIN_API_VERSION),
  service: Schema.Literal("deskohub-workspace"),
});

export type AdminCliInfo = typeof AdminCliInfo.Type;

export const AdminCliApi = HttpApiGroup.make("cli")
  .add(
    HttpApiEndpoint.get("getInfo", "/info", {
      success: AdminCliInfo,
    })
  )
  .prefix("/api/v1/cli");

export const WorkspaceAdminApi =
  HttpApi.make("workspaceAdminApi").add(AdminCliApi);
