import type { ReactNode } from "react";
import Logo from "@/shared/components/logo/logo";

/**
 * Schematic drawings for the add-to-Home-Screen guide, one per step: the
 * browser control to tap is drawn in the action colour, everything else in
 * navy line art. They simplify the browsers' layouts rather than copy them,
 * and are decorative: the step text says the same.
 */
export type InstallGuidePicture =
  | "toolbar-compact"
  | "toolbar-bottom"
  | "toolbar-top"
  | "toolbar-menu"
  | "app-menu"
  | "menu-share"
  | "menu-add"
  | "menu-open-browser"
  | "share-sheet"
  | "web-app-switch"
  | "confirm-add"
  | "home-screen";

export function InstallGuideIllustration({
  picture,
}: {
  readonly picture: InstallGuidePicture;
}) {
  if (picture === "home-screen") return <HomeScreen />;
  return (
    <Frame>
      {
        {
          "toolbar-compact": <CompactToolbar />,
          "toolbar-bottom": <BottomToolbar />,
          "toolbar-top": <TopToolbar control={<ShareGlyph />} />,
          "toolbar-menu": <TopToolbar control={<VerticalDots />} />,
          "app-menu": <AppMenu />,
          "menu-share": <Menu glyph={<ShareGlyph />} />,
          "menu-add": <Menu glyph={<AddGlyph />} />,
          "menu-open-browser": <Menu glyph={<CompassGlyph />} />,
          "share-sheet": <ShareSheet />,
          "web-app-switch": <AddScreen withWebAppSwitch />,
          "confirm-add": <AddScreen withWebAppSwitch={false} />,
        }[picture]
      }
    </Frame>
  );
}

const width = 72;
const height = 56;

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className="h-auto w-full"
      fill="none"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox={`0 0 ${width} ${height}`}
    >
      <rect
        className="fill-navy-blue/[0.04] stroke-navy-blue/15"
        height={height - 1.5}
        rx={9}
        strokeWidth={1.5}
        width={width - 1.5}
        x={0.75}
        y={0.75}
      />
      {children}
    </svg>
  );
}

/** Placeholder text lines standing in for page content. */
function PageLines({ top }: { readonly top: number }) {
  return (
    <g className="stroke-navy-blue/20" strokeWidth={2.5}>
      <path d={`M10 ${top}h40`} />
      <path d={`M10 ${top + 7}h52`} />
      <path d={`M10 ${top + 14}h30`} />
    </g>
  );
}

/** The ring that marks the control to tap. */
function Highlight({
  x,
  y,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle
        className="fill-burned-orange/10 stroke-burned-orange"
        r={7.5}
        strokeWidth={1.5}
      />
      <g className="stroke-burned-orange" strokeWidth={1.5}>
        {children}
      </g>
    </g>
  );
}

function ShareGlyph() {
  return <path d="M-3.5 -0.5v4h7v-4M0 1.5v-6M-2.2 -2.4L0 -4.5l2.2 2.1" />;
}

function AddGlyph() {
  return (
    <>
      <rect height={7} rx={2} width={7} x={-3.5} y={-3.5} />
      <path d="M0 -1.6v3.2M-1.6 0h3.2" />
    </>
  );
}

function CompassGlyph() {
  return (
    <>
      <circle r={3.8} />
      <path d="M1.8 -1.8L-0.6 -0.6L-1.8 1.8L0.6 0.6Z" />
    </>
  );
}

function HorizontalDots() {
  return <path d="M-3 0h0.01M0 0h0.01M3 0h0.01" strokeWidth={2.2} />;
}

function VerticalDots() {
  return <path d="M0 -3v0.01M0 0v0.01M0 3v0.01" strokeWidth={2.2} />;
}

/** Safari 26 Compact layout: back, the address field, then ···. */
function CompactToolbar() {
  return (
    <>
      <PageLines top={11} />
      <g className="stroke-navy-blue" strokeWidth={1.5}>
        <circle cx={11} cy={44} r={6} />
        <path d="M12.2 41.5L9.6 44l2.6 2.5" />
        <rect height={12} rx={6} width={32} x={20} y={38} />
        <path className="stroke-navy-blue/30" d="M26 44h18" />
      </g>
      <Highlight x={61} y={44}>
        <HorizontalDots />
      </Highlight>
    </>
  );
}

/** Safari 18 bottom toolbar with Share in the middle. */
function BottomToolbar() {
  return (
    <>
      <PageLines top={9} />
      <g className="stroke-navy-blue" strokeWidth={1.5}>
        <path className="stroke-navy-blue/15" d="M1.5 35.5h69" />
        <path d="M12 43l-3 3 3 3" />
        <path d="M22 43l3 3-3 3" />
        <path d="M47 43.5c2-1 4-1 5 0v6c-1-1-3-1-5 0zM52 43.5c1-1 3-1 5 0v6c-2-1-4-1-5 0z" />
        <rect height={7} rx={1.5} width={7} x={60} y={42.5} />
      </g>
      <Highlight x={36} y={46}>
        <ShareGlyph />
      </Highlight>
    </>
  );
}

/** A top address bar with the control at its right end. */
function TopToolbar({ control }: { readonly control: ReactNode }) {
  return (
    <>
      <g className="stroke-navy-blue" strokeWidth={1.5}>
        <rect height={12} rx={6} width={42} x={7} y={6} />
        <path className="stroke-navy-blue/30" d="M13 12h22" />
        <path className="stroke-navy-blue/15" d="M1.5 23.5h69" />
      </g>
      <Highlight x={60} y={12}>
        {control}
      </Highlight>
      <PageLines top={32} />
    </>
  );
}

/** Another app's own top bar, with its ··· menu at the right. */
function AppMenu() {
  return (
    <>
      <g className="stroke-navy-blue" strokeWidth={1.5}>
        <path d="M8 9l4 4M12 9l-4 4" />
        <path className="stroke-navy-blue/30" d="M20 11h22" strokeWidth={2.5} />
        <path className="stroke-navy-blue/15" d="M1.5 23.5h69" />
      </g>
      <Highlight x={60} y={11.5}>
        <HorizontalDots />
      </Highlight>
      <PageLines top={32} />
    </>
  );
}

/** A dropdown menu whose second row is the action to choose. */
function Menu({ glyph }: { readonly glyph: ReactNode }) {
  return (
    <>
      <rect
        className="fill-white stroke-navy-blue/30"
        height={44}
        rx={6}
        strokeWidth={1.5}
        width={52}
        x={14}
        y={6}
      />
      <g className="stroke-navy-blue/25" strokeWidth={2.5}>
        <path d="M22 15h30" />
        <path d="M22 43h24" />
      </g>
      <rect
        className="fill-burned-orange/10"
        height={14}
        rx={4}
        width={46}
        x={17}
        y={22}
      />
      <g className="stroke-burned-orange" strokeWidth={1.5}>
        <g transform="translate(26 29)">{glyph}</g>
        <path d="M34 29h22" strokeWidth={2.5} />
      </g>
    </>
  );
}

/** The share sheet's list with Add to Home Screen. */
function ShareSheet() {
  return (
    <>
      <path
        className="fill-white stroke-navy-blue/30"
        d="M4 54V20a6 6 0 0 1 6-6h52a6 6 0 0 1 6 6v34"
        strokeWidth={1.5}
      />
      <g className="stroke-navy-blue/25" strokeWidth={1.5}>
        <circle cx={14} cy={22} r={3.5} />
        <circle cx={25} cy={22} r={3.5} />
        <circle cx={36} cy={22} r={3.5} />
        <path d="M14 47h34" strokeWidth={2.5} />
      </g>
      <rect
        className="fill-burned-orange/10"
        height={13}
        rx={4}
        width={56}
        x={8}
        y={30}
      />
      <g className="stroke-burned-orange" strokeWidth={1.5}>
        <g transform="translate(17 36.5)">
          <AddGlyph />
        </g>
        <path d="M26 36.5h30" strokeWidth={2.5} />
      </g>
    </>
  );
}

/**
 * The screen that names the new icon, with Add at the top right and, from
 * Safari 26, the Open as Web App switch.
 */
function AddScreen({
  withWebAppSwitch,
}: {
  readonly withWebAppSwitch: boolean;
}) {
  return (
    <>
      <g className="stroke-navy-blue/30" strokeWidth={2.5}>
        <path d="M9 12h12" />
      </g>
      <rect
        className="fill-burned-orange stroke-burned-orange"
        height={10}
        rx={5}
        strokeWidth={1.5}
        width={18}
        x={45}
        y={7}
      />
      <path className="stroke-white" d="M50 12h8" strokeWidth={2} />
      <g className="stroke-navy-blue" strokeWidth={1.5}>
        <rect height={12} rx={3.5} width={12} x={9} y={22} />
        <path className="stroke-navy-blue/30" d="M27 28h28" strokeWidth={2.5} />
      </g>
      {withWebAppSwitch && (
        <g strokeWidth={1.5}>
          <path
            className="stroke-navy-blue/30"
            d="M9 45h26"
            strokeWidth={2.5}
          />
          <rect
            className="fill-navy-blue stroke-navy-blue"
            height={10}
            rx={5}
            width={18}
            x={45}
            y={40}
          />
          <circle className="fill-white stroke-none" cx={58} cy={45} r={3.6} />
        </g>
      )}
    </>
  );
}

const iconSlots = [
  [11, 8],
  [28.5, 8],
  [46, 8],
  [11, 31],
  [28.5, 31],
] as const;

const logoSlot = { x: 46, y: 31, size: 15 } as const;

/** The Home Screen with the Deskohub icon in its new place. */
function HomeScreen() {
  return (
    <div className="relative">
      <Frame>
        <g className="fill-navy-blue/10">
          {iconSlots.map(([x, y]) => (
            <rect height={15} key={`${x}-${y}`} rx={4} width={15} x={x} y={y} />
          ))}
        </g>
        <rect
          className="fill-white stroke-burned-orange"
          height={logoSlot.size + 4}
          rx={5.5}
          strokeWidth={1.5}
          width={logoSlot.size + 4}
          x={logoSlot.x - 2}
          y={logoSlot.y - 2}
        />
      </Frame>
      <span
        className="absolute flex items-center justify-center"
        style={{
          left: `${(logoSlot.x / width) * 100}%`,
          top: `${(logoSlot.y / height) * 100}%`,
          width: `${(logoSlot.size / width) * 100}%`,
          height: `${(logoSlot.size / height) * 100}%`,
        }}
      >
        <Logo
          alt=""
          className="h-full w-auto"
          height={20}
          styling={{ color: "light", variant: "small" }}
        />
      </span>
    </div>
  );
}
