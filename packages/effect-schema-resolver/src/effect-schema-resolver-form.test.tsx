/*
 * Cases adapted from the React Hook Form Effect resolver form tests:
 * https://github.com/react-hook-form/resolvers/tree/5483a0335edcb61c9d4cc5b669d30314d366987e/effect-ts/src/__tests__
 *
 * MIT License
 *
 * Copyright (c) 2019-present Beier(Bill) Luo
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Schema } from "effect";
import { type SubmitHandler, useForm } from "react-hook-form";
import { effectSchemaResolver } from "./index";

// The DOM must exist before React DOM loads so its event system binds to it.
GlobalRegistrator.register();
const { act, cleanup, fireEvent, render, renderHook, screen } = await import(
  "@testing-library/react"
);

afterAll(() => {
  cleanup();
  GlobalRegistrator.unregister();
});

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const USERNAME_REQUIRED_MESSAGE = "username field is required";
const AGE_MESSAGE = "age must be a number";

const schema = Schema.Struct({
  username: Schema.String.check(
    Schema.isNonEmpty({ message: USERNAME_REQUIRED_MESSAGE })
  ),
  age: Schema.FiniteFromString.annotate({ message: AGE_MESSAGE }),
});

type FormInput = typeof schema.Encoded;
type FormOutput = typeof schema.Type;

function SignupForm({
  onSubmit,
  shouldUseNativeValidation = false,
}: {
  readonly onSubmit: SubmitHandler<FormOutput>;
  readonly shouldUseNativeValidation?: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: { username: "", age: "" },
    resolver: effectSchemaResolver(schema),
    shouldUseNativeValidation,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("username")} placeholder="username" />
      {errors.username && <span role="alert">{errors.username.message}</span>}
      <input {...register("age")} placeholder="age" />
      {errors.age && <span role="alert">{errors.age.message}</span>}
      <button type="submit">submit</button>
    </form>
  );
}

const submit = () =>
  act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "submit" }));
  });

describe("effectSchemaResolver with useForm", () => {
  beforeAll(cleanup);

  test("renders field errors and submits decoded values", async () => {
    const onSubmit = mock<SubmitHandler<FormOutput>>();
    const { unmount } = render(<SignupForm onSubmit={onSubmit} />);

    await submit();

    expect(screen.getByText(USERNAME_REQUIRED_MESSAGE)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("username"), {
      target: { value: "joe" },
    });
    fireEvent.change(screen.getByPlaceholderText("age"), {
      target: { value: "42" },
    });
    await submit();

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ username: "joe", age: 42 });
    unmount();
  });

  test("reports and clears native validation messages", async () => {
    const onSubmit = mock<SubmitHandler<FormOutput>>();
    const { unmount } = render(
      <SignupForm onSubmit={onSubmit} shouldUseNativeValidation />
    );
    const username = () =>
      screen.getByPlaceholderText<HTMLInputElement>("username");

    expect(username().validationMessage).toBe("");

    await submit();

    expect(username().validity.valid).toBe(false);
    expect(username().validationMessage).toBe(USERNAME_REQUIRED_MESSAGE);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(username(), { target: { value: "joe" } });
    fireEvent.change(screen.getByPlaceholderText("age"), {
      target: { value: "42" },
    });
    await submit();

    expect(username().validity.valid).toBe(true);
    expect(username().validationMessage).toBe("");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    unmount();
  });

  test("infers encoded field values and decoded submit values", () => {
    const { result } = renderHook(() =>
      useForm({ resolver: effectSchemaResolver(schema) })
    );

    const age = result.current.getValues("age");

    type _FieldValue = Expect<Equal<typeof age, string>>;
    type _Submitted = Expect<
      Equal<
        Parameters<typeof result.current.handleSubmit>[0],
        SubmitHandler<FormOutput>
      >
    >;
    expect(age).toBeUndefined();
  });
});
