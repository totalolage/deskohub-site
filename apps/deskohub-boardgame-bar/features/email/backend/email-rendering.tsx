import { createRequire } from "node:module";
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";

// Turbopack rejects a static `react-dom/server` import when this module is
// pulled into the app-route/server-component graph. Keep it behind require so
// email rendering can stay server-only without breaking the Vercel build.
const require = createRequire(import.meta.url);
const { renderToString } =
  require("react-dom/server") as typeof import("react-dom/server");

export type EmailDetailRow = readonly [label: string, value: ReactNode];

export const renderBoardgameEmailHtml = (children: ReactNode): string =>
  renderToString(children);

export const renderBoardgameEmailDocument = (children: ReactNode): string =>
  `<!DOCTYPE html>${renderToString(children)}`;

export const MultilineEmailText = ({ value }: { readonly value: string }) => (
  <>
    {value.split("\n").map((line, index) => (
      <Fragment key={`${index}:${line}`}>
        {index > 0 ? <br /> : null}
        {line}
      </Fragment>
    ))}
  </>
);

export const BoardgameEmailRow = ({
  label,
  value,
  cellStyle,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly cellStyle: CSSProperties;
}) => (
  <tr>
    <td style={cellStyle}>
      <strong>{label}</strong>
    </td>
    <td style={cellStyle}>{value}</td>
  </tr>
);
