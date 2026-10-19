import { Img, Link, Section, Text } from "react-email";
import { workspaceLocationMapEmailWidth } from "@/shared/utils";
import { WorkspaceEmailLabel } from "./workspace-email-content";

export type ReservationEmailTable = {
  readonly mode: "assigned" | "shared";
  readonly name: string;
};

export type ReservationEmailLocation = {
  readonly address: string;
  readonly directionsUrl: string;
  readonly mapImageSrc?: string;
};

/** The reservation's primary button, with its table underneath when known. */
export function ReservationEmailActionPanel({
  action,
  table,
  labels,
}: {
  readonly action: { readonly button: string; readonly url: string };
  readonly table?: ReservationEmailTable;
  readonly labels: { readonly table: string; readonly tables: string };
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
            {{ assigned: labels.table, shared: labels.tables }[table.mode]}
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
  location,
  labels,
}: {
  readonly location: ReservationEmailLocation;
  readonly labels: { readonly location: string; readonly directions: string };
}) {
  return (
    <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6ded2] bg-cream">
      <Section className="px-5 py-4">
        <WorkspaceEmailLabel>{labels.location}</WorkspaceEmailLabel>
        <Link
          className="mt-2 inline-block text-[17px] font-bold leading-[25px] text-navy no-underline"
          href={location.directionsUrl}
        >
          {location.address}
        </Link>
      </Section>
      {location.mapImageSrc && (
        <Img
          alt={labels.location}
          className="block h-auto w-full"
          src={location.mapImageSrc}
          width={workspaceLocationMapEmailWidth}
        />
      )}
      <Section className="px-5 py-5 text-center">
        <Link
          className="inline-block rounded-full bg-navy px-7 py-3 text-[14px] font-bold leading-[20px] text-white no-underline"
          href={location.directionsUrl}
        >
          {labels.directions}
        </Link>
      </Section>
    </Section>
  );
}
