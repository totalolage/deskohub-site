import {
  Children,
  createElement,
  isValidElement,
  type JSXElementConstructor,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type HostProps = Readonly<Record<string, unknown>> & {
  readonly children?: ReactNode;
};

/**
 * The element tree a component returns for `props`. The component runs
 * inside a throwaway server render, so its hooks work (effects don't run),
 * and the tree isn't rendered further: with the preload's host components
 * standing in as names, a test reads it as returned. `within` places the
 * component under providers, such as a context it reads.
 */
export const elementTree = <Props>(
  component: (props: Props) => ReactNode,
  props: Props,
  within: (component: ReactElement) => ReactElement = (node) => node
): ReactNode => {
  let tree: ReactNode = null;
  const Probe = () => {
    tree = component(props);
    return null;
  };
  renderToStaticMarkup(within(createElement(Probe)));
  return tree;
};

/**
 * Every element of `type` in an element tree, in document order: a host
 * element by its name, or a component's element by the component.
 */
export const findAll = <Props = HostProps>(
  node: ReactNode,
  type: string | JSXElementConstructor<Props>
): ReadonlyArray<ReactElement<Props>> => {
  if (!isValidElement<HostProps>(node)) return [];
  const nested = Children.toArray(node.props.children).flatMap((child) =>
    findAll(child, type)
  );
  return node.type === type
    ? [node as unknown as ReactElement<Props>, ...nested]
    : nested;
};

/** The first element of `type` in an element tree. */
export const find = <Props = HostProps>(
  node: ReactNode,
  type: string | JSXElementConstructor<Props>
): ReactElement<Props> | undefined => findAll(node, type)[0];
