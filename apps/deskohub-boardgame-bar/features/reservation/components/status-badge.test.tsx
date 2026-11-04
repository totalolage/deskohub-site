import { describe, expect, test } from "bun:test";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/features/i18n";
import { ReservationStatusBadge } from "./status-badge";

describe("ReservationStatusBadge", () => {
  test.each([
    ["submitted", Clock, m["status.pending"](), "bg-blue-100"],
    ["confirmed", CheckCircle, m["status.confirmed"](), "bg-green-100"],
    ["rejected", XCircle, m["status.rejected"](), "bg-red-100"],
  ] as const)(
    "marks a %s reservation with its icon, label, and color",
    (status, Icon, label, background) => {
      const html = renderToStaticMarkup(
        <ReservationStatusBadge status={status} />
      );

      const icon = renderToStaticMarkup(<Icon className="w-4 h-4" />);

      expect(html).toEndWith(`>${icon}<span>${label}</span></div>`);
      expect(html.match(/^<div class="([^"]*)"/)?.[1]).toContain(background);
    }
  );
});
