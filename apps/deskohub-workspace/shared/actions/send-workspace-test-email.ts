"use server";

import {
  EmailConfigTag,
  type EmailMessage,
  EmailServiceTag,
  StandaloneEmailServiceLayer,
} from "@deskohub/email";
import { Effect, Layer } from "effect";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const testEmailRecipient = "workspace@deskohub.cz";

export type WorkspaceTestEmailResult =
  | {
      status: "success";
      id: string;
      provider: string;
    }
  | {
      status: "error";
      errorType: string;
      message: string;
      provider?: string;
      statusCode?: number;
      code?: string;
    };

const getRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
};

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

export async function sendWorkspaceTestEmail(): Promise<WorkspaceTestEmailResult> {
  const program = Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    const message: EmailMessage = {
      from: emailConfig.defaultFrom,
      to: { email: testEmailRecipient, name: "Deskohub Workspace" },
      subject: "Deskohub workspace email service test",
      html: "<p>This is a test email from the Deskohub workspace header button.</p>",
      text: "This is a test email from the Deskohub workspace header button.",
      tags: ["workspace-email-service-test"],
      metadata: { source: "workspace-header-test-email" },
    };

    yield* Effect.logInfo("Workspace test email send requested", {
      recipient: testEmailRecipient,
    });

    const result = yield* emailService.send(message);

    yield* Effect.logInfo("Workspace test email sent", {
      id: result.id,
      provider: result.provider,
      status: result.status,
    });

    return {
      status: "success" as const,
      id: result.id,
      provider: result.provider,
    };
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
    ),
    Effect.catchAll((error) => {
      const errorRecord = getRecord(error);
      const causeRecord = getRecord(errorRecord?.cause);
      const statusCode = getNumber(causeRecord?.statusCode);
      const code =
        getString(causeRecord?.code) ??
        getString(causeRecord?.name) ??
        getString(causeRecord?.error);
      const errorType = getString(errorRecord?._tag) ?? "UnknownEmailError";
      const message = getString(errorRecord?.message) ?? String(error);
      const provider = getString(errorRecord?.provider);

      return Effect.logError("Workspace test email failed", {
        error,
        errorType,
        message,
        provider,
        statusCode,
        code,
      }).pipe(
        Effect.as({
          status: "error" as const,
          errorType,
          message,
          provider,
          statusCode,
          code,
        })
      );
    })
  );

  return await runWorkspaceEffect(program);
}
