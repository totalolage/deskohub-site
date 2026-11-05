import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { toast } from "sonner";
import { m } from "@/features/i18n";
import { reservationSubmissionFeedback } from "./reservation-submission-feedback";

const toastSuccess = spyOn(toast, "success");
const toastError = spyOn(toast, "error");

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
});

afterAll(() => {
  toastSuccess.mockRestore();
  toastError.mockRestore();
});

const setUp = () => {
  const navigate = mock((_url: string) => {});
  const setFieldError = mock((_field: string, _message: string) => {});
  return {
    navigate,
    setFieldError,
    ...reservationSubmissionFeedback({ navigate, setFieldError }),
  };
};

describe("reservationSubmissionFeedback", () => {
  test("confirms a successful submission and opens its confirmation page", () => {
    const { onSuccess, navigate } = setUp();

    onSuccess({ data: { success: true, redirectUrl: "/confirmation?x=1" } });

    expect(toastSuccess).toHaveBeenCalledWith(
      m["trainingReservation.success.title"](),
      { description: m["trainingReservation.success.description"]() }
    );
    expect(navigate).toHaveBeenCalledWith("/confirmation?x=1");
  });

  test("confirms a successful submission without a confirmation page in place", () => {
    const { onSuccess, navigate } = setUp();

    onSuccess({ data: { success: true } });

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("ignores a result that isn't a successful submission", () => {
    const { onSuccess, navigate } = setUp();

    onSuccess({});
    onSuccess({ data: { success: false, redirectUrl: "/confirmation" } });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("puts the first message of each rejected field on that field without a toast", () => {
    const { onError, setFieldError } = setUp();

    onError({
      error: {
        validationErrors: {
          fieldErrors: {
            email: ["Invalid email", "Too long"],
            phone: [],
            time: undefined,
            date: ["Pick a date"],
          },
        },
      },
    });

    expect(setFieldError.mock.calls).toEqual([
      ["email", "Invalid email"],
      ["date", "Pick a date"],
    ]);
    expect(toastError).not.toHaveBeenCalled();
  });

  test("stays quiet for validation errors without field errors", () => {
    const { onError, setFieldError } = setUp();

    onError({ error: { validationErrors: {} } });

    expect(setFieldError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  test("toasts the server's error, or the generic one without it", () => {
    const { onError, setFieldError } = setUp();

    onError({ error: { serverError: "Mail provider unavailable" } });
    onError({ error: {} });
    onError({});

    const title = m["trainingReservation.error.title"]();
    expect(toastError.mock.calls).toEqual([
      [title, { description: "Mail provider unavailable" }],
      [title, { description: m["trainingReservation.error.description"]() }],
      [title, { description: m["trainingReservation.error.description"]() }],
    ]);
    expect(setFieldError).not.toHaveBeenCalled();
  });
});
