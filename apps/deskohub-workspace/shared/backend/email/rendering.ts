import { escapeHtml } from "@deskohub/email/backend/escaping";

export type EmailDetailRow = readonly [label: string, value: string];

export const renderWorkspaceEmailRowsHtml = (
  rows: readonly EmailDetailRow[]
): string =>
  rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>${escapeHtml(label)}:</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${escapeHtml(value)}</td>
      </tr>`
    )
    .join("");

export const renderEmailRowsText = (
  rows: readonly EmailDetailRow[]
): readonly string[] => rows.map(([label, value]) => `${label}: ${value}`);
