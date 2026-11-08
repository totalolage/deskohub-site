import { describe, expect, test } from "bun:test";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "../../ui/controls";
import { AssistantConnectionRow } from "./assistant-connection-row";
import type { AssistantRow } from "./connected-assistants";

type Props = {
  readonly children?: ReactNode;
  readonly role?: string;
  readonly "aria-label"?: string;
  readonly accessibilityLabel?: string;
  readonly label?: string;
};

/** Every element in a returned element tree that matches. */
const findAll = (
  node: ReactNode,
  matches: (element: ReactElement<Props>) => boolean
): ReadonlyArray<ReactElement<Props>> => {
  if (!isValidElement<Props>(node)) return [];
  return [
    ...(matches(node) ? [node] : []),
    ...Children.toArray(node.props.children).flatMap((child) =>
      findAll(child, matches)
    ),
  ];
};

const row = (overrides: Partial<AssistantRow> = {}): AssistantRow => ({
  id: "consent-a",
  name: "Synthetic Assistant",
  details: { kind: "date", date: "4 Mar 2026" },
  scopes: ["offerings:read", "reservations:read"],
  administration: false,
  ...overrides,
});

const render = (shown: AssistantRow) =>
  AssistantConnectionRow({
    row: shown,
    locale: "en-US",
    onDisconnect: () => undefined,
  });

describe("AssistantConnectionRow", () => {
  test("its Disconnect button is named after the assistant, not only its visible label", () => {
    const [disconnect] = findAll(
      render(row()),
      (element) => element.type === Button
    );
    expect(disconnect?.props.accessibilityLabel).toBeString();
    expect(disconnect?.props.accessibilityLabel).not.toBe(
      disconnect?.props.label
    );
    expect(disconnect?.props.accessibilityLabel).toContain(
      "Synthetic Assistant"
    );
  });

  test("lists one item per granted scope, plus the administrator marker", () => {
    const items = (shown: AssistantRow) =>
      findAll(render(shown), (element) => element.props.role === "listitem");

    expect(items(row())).toHaveLength(2);
    expect(items(row({ administration: true }))).toHaveLength(3);
  });

  test("the scope list is a labelled list", () => {
    const [list] = findAll(
      render(row()),
      (element) => element.props.role === "list"
    );
    expect(list?.props["aria-label"]).toBeString();
  });

  test("an assistant without scopes or administrator access has no list", () => {
    expect(
      findAll(
        render(row({ scopes: [] })),
        (element) => element.props.role === "list"
      )
    ).toEqual([]);
  });
});
