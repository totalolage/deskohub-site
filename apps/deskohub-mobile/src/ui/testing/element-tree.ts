import {
  Children,
  createElement,
  isValidElement,
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

/** Every host element of `type` in an element tree, in document order. */
export const findAll = (
  node: ReactNode,
  type: string
): ReadonlyArray<ReactElement<HostProps>> => {
  if (!isValidElement<HostProps>(node)) return [];
  const nested = Children.toArray(node.props.children).flatMap((child) =>
    findAll(child, type)
  );
  return node.type === type ? [node, ...nested] : nested;
};

/** The first host element of `type` in an element tree. */
export const find = (
  node: ReactNode,
  type: string
): ReactElement<HostProps> | undefined => findAll(node, type)[0];
