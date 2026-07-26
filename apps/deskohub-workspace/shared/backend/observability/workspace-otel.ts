import type { Configuration } from "@vercel/otel";
import { CensoringSpanProcessor } from "../logging/censorship";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "./workspace-service";

export const createWorkspaceOtelConfiguration = (): Configuration => ({
  serviceName: WORKSPACE_SERVICE_NAME,
  attributes: {
    "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
  },
  spanProcessors: [CensoringSpanProcessor, "auto"],
});
