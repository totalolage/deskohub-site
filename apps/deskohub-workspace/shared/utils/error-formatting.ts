import { projectErrorMetadata } from "./error-metadata";

export function formatError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  return {
    code: "INTERNAL_ERROR",
    message: "An internal error occurred.",
    details: projectErrorMetadata(error),
  };
}

export const serializeErrorForLog = projectErrorMetadata;
