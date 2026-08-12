/*
Warm Ledger makes a small fridge purchase feel like a trusted Workspace tab:
warm paper carries the catalog, Deskohub navy supplies structure, yellow makes
adding an item immediate, and green appears only for verified access or payment.
The interface stays compact enough for a quick visit while preserving Material
3 navigation, touch targets, and status behavior. Product photography is the
catalog's visual focus; decoration never competes with price, quantity, or the
next action. The generated reference is a north star, so live copy, accessibility,
safe areas, responsive layout, and authoritative commerce state remain primary.
*/

import { Platform, type TextStyle, type ViewStyle } from "react-native";

export const palette = {
  navy: "#00024F",
  navyRaised: "#0C0E63",
  navyMuted: "#4A4B70",
  paper: "#F7F5EE",
  surface: "#FFFEFA",
  surfaceMuted: "#EEECE4",
  silver: "#D6D2C7",
  sunset: "#ECA423",
  orange: "#C43E07",
  orangeInk: "#7A2E0A",
  aquamarine: "#00DF99",
  aquamarineInk: "#004C3B",
  success: "#00845F",
  danger: "#B3261E",
  dangerSurface: "#F9DEDC",
  warningSurface: "#FFF0D1",
  successSurface: "#DDF5E9",
  infoSurface: "#E9EAF5",
  outline: "#CBC8BF",
  white: "#FFFFFF",
  black: "#11111A",
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export const type = {
  display: {
    fontFamily: "Sculpin",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "400",
    letterSpacing: -0.7,
  } satisfies TextStyle,
  headline: {
    fontFamily: "Sculpin",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "400",
    letterSpacing: -0.4,
  } satisfies TextStyle,
  title: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "700",
  } satisfies TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  } satisfies TextStyle,
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  } satisfies TextStyle,
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  } satisfies TextStyle,
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  } satisfies TextStyle,
} as const;

export const elevation = {
  card: Platform.select<ViewStyle>({
    web: { boxShadow: "0 3px 12px rgba(0, 2, 79, 0.07)" },
    default: {
      shadowColor: palette.navy,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 1,
    },
  }),
  floating: Platform.select<ViewStyle>({
    web: { boxShadow: "0 10px 28px rgba(0, 2, 79, 0.16)" },
    default: {
      shadowColor: palette.navy,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.16,
      shadowRadius: 22,
      elevation: 6,
    },
  }),
} as const;
