import { describe, expect, test } from "bun:test";
import { findElementsOfType } from "./react-element-tree";

const Badge = ({ label }: { label: string }) => <span>{label}</span>;
const Card = ({ children }: { children?: React.ReactNode }) => (
  <section>{children}</section>
);

describe("findElementsOfType", () => {
  test("finds nested elements of a component type in document order", () => {
    const tree = (
      <div>
        <Badge label="first" />
        {[<Card key="card">{<Badge label="second" />}</Card>]}
        {false}
        text
      </div>
    );

    expect(
      findElementsOfType(tree, Badge).map((element) => element.props.label)
    ).toEqual(["first", "second"]);
  });

  test("finds intrinsic elements, including the root and ones nested in a match", () => {
    const tree = (
      <section>
        <section />
      </section>
    );

    expect(findElementsOfType(tree, "section")).toHaveLength(2);
  });

  test("does not render components to look inside them", () => {
    expect(findElementsOfType(<Card />, "section")).toEqual([]);
  });

  test("finds nothing outside an element tree", () => {
    expect(findElementsOfType(null, Badge)).toEqual([]);
    expect(findElementsOfType("text", Badge)).toEqual([]);
  });
});
