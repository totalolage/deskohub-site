"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { CliAuthenticationCode } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { approveCliAuthentication } from "@/features/admin-cli/actions";
import { Button } from "@/shared/components/ui/button";

const approveCliAuthenticationFormSchema = Schema.Struct({
  code: CliAuthenticationCode,
});

type ApproveCliAuthenticationFormInput =
  typeof approveCliAuthenticationFormSchema.Encoded;

type ApproveCliAuthenticationFormValues =
  typeof approveCliAuthenticationFormSchema.Type;

export function ApproveCliAuthenticationForm({
  code,
}: {
  readonly code?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const submissionStarted = useRef(false);
  const form = useForm<
    ApproveCliAuthenticationFormInput,
    unknown,
    ApproveCliAuthenticationFormValues
  >({
    defaultValues: { code: code ?? "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(approveCliAuthenticationFormSchema, {
      onExcessProperty: "error",
    }),
  });

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          if (submissionStarted.current) return;
          submissionStarted.current = true;

          const formData = new FormData();
          formData.set("code", values.code);
          startTransition(async () => {
            try {
              await approveCliAuthentication(formData);
            } finally {
              submissionStarted.current = false;
            }
          });
        })(event);
      }}
    >
      <input type="hidden" {...form.register("code")} />
      <Button aria-busy={isPending} disabled={isPending} type="submit">
        Approve this CLI
      </Button>
    </form>
  );
}
