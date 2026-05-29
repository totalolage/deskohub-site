import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { Fragment } from "react";

// Turbopack rejects a static `react-dom/server` import when this module is
// pulled into the app-route/server-component graph. Keep it behind require so
// email rendering can stay server-only without breaking the Vercel build.
const require = createRequire(import.meta.url);
const { renderToString } = require("react-dom/server") as typeof import("react-dom/server");

export type EmailDetailRow = readonly [label: string, value: string];

const emailRowCellStyle = {
  padding: "8px 0",
  borderBottom: "1px solid #e6e9f3",
} as const;

export const renderWorkspaceEmailHtml = (children: ReactNode): string =>
  renderToString(children);

export const MultilineEmailText = ({ value }: { readonly value: string }) => {
  const lines = value.split("\n").map((line, index) => ({
    line,
    key: `${value.slice(0, index).length}:${line}`,
    hasBreakBefore: index > 0,
  }));

  return (
    <>
      {lines.map(({ line, key, hasBreakBefore }) => (
        <Fragment key={key}>
          {hasBreakBefore ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </>
  );
};

export const WorkspaceEmailRows = ({
  rows,
}: {
  readonly rows: readonly EmailDetailRow[];
}) => (
  <>
    {rows.map(([label, value]) => (
      <WorkspaceEmailRow
        key={`${label}:${value}`}
        label={label}
        value={value}
      />
    ))}
  </>
);

export const WorkspaceEmailRow = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) => (
  <tr>
    <td style={emailRowCellStyle}>
      <strong>{label}:</strong>
    </td>
    <td style={emailRowCellStyle}>{value}</td>
  </tr>
);

export const renderWorkspaceEmailRowsHtml = (
  rows: readonly EmailDetailRow[]
): string =>
  rows
    .map(([label, value]) =>
      renderToString(<WorkspaceEmailRow label={label} value={value} />)
    )
    .join("");

export const renderEmailRowsText = (
  rows: readonly EmailDetailRow[]
): readonly string[] => rows.map(([label, value]) => `${label}: ${value}`);
