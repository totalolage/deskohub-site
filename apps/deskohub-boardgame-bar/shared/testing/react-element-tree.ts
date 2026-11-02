import {
  type ComponentProps,
  type ElementType,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Finds every element of `type` in an unrendered element tree, such as the
 * one a server component returns. Components inside the tree are not called,
 * so only elements written directly in that tree are found.
 */
export const findElementsOfType = <T extends ElementType>(
  node: ReactNode,
  type: T
): ReactElement<ComponentProps<T>>[] => {
  if (Array.isArray(node)) {
    return node.flatMap((child) =>
      findElementsOfType(child as ReactNode, type)
    );
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];

  const nested = findElementsOfType(node.props.children, type);
  return node.type === type
    ? [node as ReactElement<ComponentProps<T>>, ...nested]
    : nested;
};
