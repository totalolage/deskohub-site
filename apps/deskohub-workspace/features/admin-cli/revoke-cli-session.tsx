"use client";

import {
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { revokeCliSession } from "./actions";

const revokeCliSessionFormSchema = Schema.Struct({
  sessionId: CliSessionId,
});

const revokeCliSessionFormStandardSchema = Schema.toStandardSchemaV1(
  revokeCliSessionFormSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

type RevokeCliSessionFormInput = StandardSchemaV1.InferInput<
  typeof revokeCliSessionFormStandardSchema
>;

type RevokeCliSessionFormValues = StandardSchemaV1.InferOutput<
  typeof revokeCliSessionFormStandardSchema
>;

export function RevokeCliSession({
  clientName,
  revoked,
  sessionId,
}: {
  readonly clientName: string;
  readonly revoked: boolean;
  readonly sessionId: CliSessionIdType;
}) {
  const [isPending, startTransition] = useTransition();
  const submissionStarted = useRef(false);
  const form = useForm<
    RevokeCliSessionFormInput,
    unknown,
    RevokeCliSessionFormValues
  >({
    defaultValues: { sessionId },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: standardSchemaResolver(revokeCliSessionFormStandardSchema),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={revoked} size="sm" type="button" variant="secondary">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke CLI session?</DialogTitle>
          <DialogDescription>
            “{clientName}” will immediately lose Workspace administration
            access. Its CLI will remove the credential when it next contacts the
            API. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              if (submissionStarted.current) return;
              submissionStarted.current = true;

              const formData = new FormData();
              formData.set("sessionId", values.sessionId);
              startTransition(async () => {
                try {
                  await revokeCliSession(formData);
                } finally {
                  submissionStarted.current = false;
                }
              });
            })(event);
          }}
        >
          <input type="hidden" {...form.register("sessionId")} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={isPending} type="submit">
              {isPending ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
