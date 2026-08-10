import { CliClientName, CliSessionId } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

export const renameCliSessionSchema = Schema.Struct({
  sessionId: CliSessionId,
  clientName: CliClientName,
});

export const renameCliSessionStandardSchema = Schema.toStandardSchemaV1(
  renameCliSessionSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);
