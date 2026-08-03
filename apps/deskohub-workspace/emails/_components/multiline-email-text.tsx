import { Fragment } from "react";

export function MultilineEmailText({ value }: { readonly value: string }) {
  const lines = value.split("\n");

  return lines.map((line, index) => (
    <Fragment key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ));
}
