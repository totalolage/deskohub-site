import { Img, Link, Section, Text } from "react-email";
import { type Locale, m } from "@/features/i18n";
import type { CustomerReservationPlacement } from "@/features/reservation/backend/customer-reservation-placement";
import {
  getWorkspaceCanonicalUrl,
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapEmailWidth,
  workspaceLocationMapImagePath,
} from "@/shared/utils";
import { WorkspaceEmailLabel } from "./workspace-email-content";

// The hosted map route serves the same image with long-lived caching, so every
// generation references stable bytes instead of embedding a fresh OSM fetch.
const workspaceLocationMapUrl = getWorkspaceCanonicalUrl(
  workspaceLocationMapImagePath
);

/** The reservation's primary button, with its table underneath when known. */
export function ReservationEmailActionPanel({
  action,
  table,
  locale,
}: {
  readonly action: { readonly button: string; readonly url: string };
  readonly table?: CustomerReservationPlacement["table"];
  readonly locale: Locale;
}) {
  return (
    <Section className="mt-6 overflow-hidden rounded-[22px] border border-[#d8d9e4]">
      <Section
        bgcolor="#00024f"
        className="bg-navy px-4 py-6 text-center sm:px-6"
        style={{ backgroundColor: "#00024f" }}
      >
        <Link
          className="inline-block rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
          href={action.url}
          style={{ backgroundColor: "#00df99", color: "#00024f" }}
        >
          {action.button}
        </Link>
      </Section>
      {table && (
        <Section className="border-t-4 border-aquamarine bg-[#e9fff6] px-5 py-5 text-center">
          <WorkspaceEmailLabel>
            {
              {
                assigned: m.checkoutEmailTableNumberLabel({}, { locale }),
                shared: m.checkoutEmailTablesLabel({}, { locale }),
              }[table.mode]
            }
          </WorkspaceEmailLabel>
          <Text
            className={
              {
                assigned:
                  "m-0 mt-1 text-[48px] font-bold leading-[54px] text-navy",
                shared:
                  "m-0 mt-1 break-words text-[18px] font-bold leading-[26px] text-navy",
              }[table.mode]
            }
            style={
              table.mode === "shared" ? { overflowWrap: "anywhere" } : undefined
            }
          >
            {table.name}
          </Text>
        </Section>
      )}
    </Section>
  );
}

/** Where the workspace is, with its map and a directions button. */
export function ReservationEmailLocationPanel({
  locale,
}: {
  readonly locale: Locale;
}) {
  return (
    <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6ded2] bg-cream">
      <Section className="px-5 py-4">
        <WorkspaceEmailLabel>
          {m.checkoutEmailLocationHeading({}, { locale })}
        </WorkspaceEmailLabel>
        <Link
          className="mt-2 inline-block text-[17px] font-bold leading-[25px] text-navy no-underline"
          href={workspaceGoogleDirectionsUrl}
        >
          {workspaceFormattedAddress}
        </Link>
      </Section>
      <Img
        alt={m.checkoutEmailLocationHeading({}, { locale })}
        className="block h-auto w-full"
        src={workspaceLocationMapUrl}
        width={workspaceLocationMapEmailWidth}
      />
      <Section className="px-5 py-5 text-center">
        <Link
          className="inline-block rounded-full bg-navy px-7 py-3 text-[14px] font-bold leading-[20px] text-white no-underline"
          href={workspaceGoogleDirectionsUrl}
        >
          {m.checkoutEmailLocationMapLink({}, { locale })}
        </Link>
      </Section>
    </Section>
  );
}
