import { localeRedirectPattern } from "./locales.mjs";

const trainingRoomReservationQueryKeys = [
  "company",
  "firstName",
  "lastName",
  "role",
  "email",
  "phone",
  "date",
  "time",
  "duration",
  "specialRequirements",
];

const trainingRoomReservationQuery = new URLSearchParams(
  trainingRoomReservationQueryKeys.map((key) => [key, ""])
).toString();

const trainingRoomReservationRedirects = trainingRoomReservationQueryKeys.flatMap(
  (key) => [
    {
      source: "/training-room/reservation/:path*",
      has: [{ type: "query", key }],
      destination: `https://workspace.deskohub.cz/ttrpg-room?${trainingRoomReservationQuery}`,
      permanent: true,
    },
    {
      source: `/:locale(${localeRedirectPattern})/training-room/reservation/:path*`,
      has: [{ type: "query", key }],
      destination: `https://workspace.deskohub.cz/:locale/ttrpg-room?${trainingRoomReservationQuery}`,
      permanent: true,
    },
  ]
);

export const redirects = [
  ...trainingRoomReservationRedirects,
  {
    source: "/training-room",
    destination: "https://workspace.deskohub.cz/ttrpg-room",
    permanent: true,
  },
  {
    source: "/training-room/:path*",
    destination: "https://workspace.deskohub.cz/ttrpg-room",
    permanent: true,
  },
  {
    source: `/:locale(${localeRedirectPattern})/training-room`,
    destination: "https://workspace.deskohub.cz/:locale/ttrpg-room",
    permanent: true,
  },
  {
    source: `/:locale(${localeRedirectPattern})/training-room/:path*`,
    destination: "https://workspace.deskohub.cz/:locale/ttrpg-room",
    permanent: true,
  },
  {
    source: "/workspace",
    destination: "https://workspace.deskohub.cz",
    permanent: true,
  },
  {
    source: "/workspace/:path*",
    destination: "https://workspace.deskohub.cz/:path*",
    permanent: true,
  },
];
