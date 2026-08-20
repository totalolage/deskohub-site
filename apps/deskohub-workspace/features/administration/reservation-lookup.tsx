"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { getAdministrationReservation } from "./actions";
import { AdministrationAlert } from "./notice";

export function ReservationLookup({
  variant = "card",
}: {
  readonly variant?: "card" | "toolbar";
}) {
  const identifierId = useId();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    getAdministrationReservation,
    {
      actionName: "getAdministrationReservation",
      onSuccess: ({ data }) => {
        if (!data) return;
        if (!data.reservationId) {
          setError("No reservation matched that ID.");
          return;
        }
        setError(null);
        router.push(
          `/admin/reservations/${encodeURIComponent(data.reservationId)}`
        );
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            "The reservation lookup could not be completed."
        ),
      onTransportError: () =>
        setError("The reservation lookup could not be completed."),
    }
  );

  return (
    <div className="space-y-4">
      <form
        className={cn(
          "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
          variant === "card" &&
            "rounded-xl border border-navy-blue/10 bg-white p-5"
        )}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const identifier = new FormData(event.currentTarget)
            .get("identifier")
            ?.toString()
            .trim();
          if (!identifier) return;
          execute({ identifier });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={identifierId}>Reservation or payment ID</Label>
          <Input
            autoComplete="off"
            id={identifierId}
            maxLength={256}
            name="identifier"
            placeholder="Paste any associated ID"
            required
            type="search"
          />
        </div>
        <Button disabled={isExecuting} type="submit">
          <Search aria-hidden className="size-4" />
          {isExecuting ? "Looking up…" : "Get reservation"}
        </Button>
      </form>

      {error && (
        <AdministrationAlert
          className="font-semibold"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
    </div>
  );
}
