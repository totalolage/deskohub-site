import { Platform, type TextStyle, type ViewStyle } from "react-native";

export const palette = {
  navy: "#00024F",
  navyRaised: "#101262",
  navyMuted: "#4C4D7A",
  paper: "#F5F4EF",
  surface: "#FFFFFF",
  surfaceMuted: "#ECEBE6",
  silver: "#D8D8D8",
  sunset: "#ECA423",
  orange: "#DD480A",
  orangeInk: "#7A2E0A",
  aquamarine: "#00DF99",
  aquamarineInk: "#004C3B",
  danger: "#B3261E",
  dangerSurface: "#F9DEDC",
  warningSurface: "#FFF0D1",
  successSurface: "#D8F8EA",
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
  sm: 10,
  md: 14,
  lg: 18,
  full: 999,
} as const;

export const type = {
  display: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.6,
  } satisfies TextStyle,
  headline: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: -0.35,
  } satisfies TextStyle,
  title: {
    fontSize: 18,
    lineHeight: 24,
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
    lineHeight: 20,
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
    web: { boxShadow: "0 8px 18px rgba(0, 2, 79, 0.08)" },
    default: {
      shadowColor: palette.navy,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 2,
    },
  }),
} as const;
