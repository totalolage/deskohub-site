import { EmailServiceError } from "@deskohub/email/backend/service";
import { Effect } from "effect";
import type { ReactElement } from "react";
import { render } from "react-email";

export interface RenderedWorkspaceEmail {
  readonly html: string;
  readonly text: string;
}

export const renderWorkspaceEmail = Effect.fn("renderWorkspaceEmail")(
  (
    email: ReactElement
  ): Effect.Effect<RenderedWorkspaceEmail, EmailServiceError> =>
    Effect.tryPromise({
      try: async () => {
        const [html, text] = await Promise.all([
          render(email),
          render(email, { plainText: true }),
        ]);

        return { html, text };
      },
      catch: (cause) =>
        new EmailServiceError("Workspace email could not be rendered.", cause),
    })
);
