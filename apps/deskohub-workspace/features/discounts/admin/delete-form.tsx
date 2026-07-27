"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/components/ui/button";

type DeleteFormProps = {
  readonly action: (formData: FormData) => Promise<void> | void;
  readonly children?: ReactNode;
  readonly confirmation: string;
};

export function DeleteForm({
  action,
  children = "Delete",
  confirmation,
}: DeleteFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!globalThis.confirm(confirmation)) {
          event.preventDefault();
        }
      }}
    >
      <Button
        className="border-burned-orange/25 text-burned-orange-ink hover:border-burned-orange"
        type="submit"
        variant="secondary"
      >
        <Trash2 aria-hidden className="size-4" />
        {children}
      </Button>
    </form>
  );
}
