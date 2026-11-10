import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { TextInputInstance } from "react-native";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { sampleProfile } from "../../customer-api/testing/sample-fixtures";
import { elementTree } from "../../ui/testing/element-tree";
import {
  type CompletionTextField,
  identityFields,
  type ProfileDraftInvalid,
  profileDraftOf,
} from "./profile-draft";
import { ProfileTextFields } from "./profile-fields";
import {
  type ProfileSubmitState,
  ProfileSubmitState as SubmitState,
} from "./profile-save";
import { ProfileSubmitFooter } from "./profile-submit-footer";

type FieldProps = {
  readonly label: string;
  readonly error?: string;
  readonly maxLength?: number;
  readonly editable?: boolean;
};

const elementsOf = (tree: ReactNode) =>
  [tree]
    .flat()
    .filter((node): node is ReactElement<FieldProps> => isValidElement(node));

const fields = (invalid?: ProfileDraftInvalid<CompletionTextField>) =>
  elementsOf(
    elementTree(
      () =>
        ProfileTextFields({
          fields: identityFields,
          draft: profileDraftOf(sampleProfile, "CZ"),
          invalid,
          onChange: () => undefined,
          inputs: {
            current: new Map<CompletionTextField, TextInputInstance | null>(),
          },
          editable: true,
          locale: "en-US",
        }),
      {}
    )
  );

describe("ProfileTextFields", () => {
  test("renders one input per field, in order, each limited like the contract", () => {
    const inputs = fields();
    expect(inputs.map((input) => input.key)).toEqual([...identityFields]);
    expect(inputs.map((input) => input.props.maxLength)).toEqual([
      100, 100, 32,
    ]);
    expect(inputs.every((input) => input.props.error === undefined)).toBe(true);
  });

  test("only the fields with a problem show an error", () => {
    const inputs = fields({
      fields: { phone: "invalid-phone" },
      first: Option.some("phone"),
    });
    expect(
      inputs.map((input) => [input.key, input.props.error !== undefined])
    ).toEqual([
      ["firstName", false],
      ["lastName", false],
      ["phone", true],
    ]);
  });
});

const footerButton = (state: ProfileSubmitState, unsaved: boolean) => {
  const tree = elementTree(ProfileSubmitFooter, {
    state,
    unsaved,
    onSubmit: () => undefined,
    submitLabel: "save",
    submittingLabel: "saving",
    doneMessage: "done",
    invalidMessage: "invalid",
    locale: "en-US",
  });
  const [button] = elementsOf(
    isValidElement<{ children?: ReactNode }>(tree) ? tree.props.children : []
  ) as ReadonlyArray<ReactElement<{ disabled?: boolean; label: string }>>;
  return button?.props;
};

describe("ProfileSubmitFooter", () => {
  test("saving needs unsaved changes and no save in flight", () => {
    expect(footerButton(SubmitState.Idle(), false)?.disabled).toBe(true);
    expect(footerButton(SubmitState.Idle(), true)?.disabled).toBe(false);
    expect(footerButton(SubmitState.Submitting(), true)).toMatchObject({
      disabled: true,
      label: "saving",
    });
  });

  test("a failed save can be tried again", () => {
    expect(
      footerButton(
        SubmitState.Failed({ error: CustomerViewError.Unavailable() }),
        true
      )?.disabled
    ).toBe(false);
  });
});
