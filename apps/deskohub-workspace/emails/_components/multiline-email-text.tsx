import { Fragment } from "react";

export function MultilineEmailText({ value }: { readonly value: string }) {
  const lines = value.split("\n");

  return lines.map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: Email lines need positional keys because duplicate and blank lines are valid.
    <Fragment key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ));
}
