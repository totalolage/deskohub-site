import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/shared/polyfills/temporal";
import { DateInput } from "./date-input";
import { DateTimeInput } from "./date-time-input";

const mountPoint = document.getElementById("date-picker-test-root");

if (!mountPoint) {
  throw new Error("The date picker browser harness root is missing.");
}

function ControlledPicker() {
  const [value, setValue] = useState("2099-06-10");

  return (
    <DateInput
      label="Reservation date"
      locale="en-US"
      name="date"
      onChange={setValue}
      value={value}
    />
  );
}

/** A form without validation that lists what it submitted. */
function SubmissionForm() {
  const [submissions, setSubmissions] = useState<ReadonlyArray<string>>([]);

  return (
    <form
      data-submissions={JSON.stringify(submissions)}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmissions((previous) => [
          ...previous,
          `${data.get("startsAt")}|${data.get("serviceDate")}`,
        ]);
      }}
    >
      <DateTimeInput
        dateLabel="Starts"
        locale="en-US"
        name="startsAt"
        timeLabel="Starts time"
      />
      <DateInput label="Service date" locale="en-US" name="serviceDate" />
      <button type="submit">Save</button>
    </form>
  );
}

/** A form whose date-time keeps to one evening's hours. */
function BoundedSubmissionForm() {
  const [submissions, setSubmissions] = useState<ReadonlyArray<string>>([]);

  return (
    <form
      data-bounded-form
      data-submissions={JSON.stringify(submissions)}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmissions((previous) => [
          ...previous,
          String(data.get("eveningStart")),
        ]);
      }}
    >
      <DateTimeInput
        dateLabel="Evening start"
        defaultValue="2099-06-10T16:00"
        locale="en-US"
        maximum="2099-06-10T20:00"
        minimum="2099-06-10T16:00"
        name="eveningStart"
        stepMinutes={60}
        timeLabel="Evening start time"
      />
      <button type="submit">Book the evening</button>
    </form>
  );
}

/** A date field in a cell too narrow for the calendar button beside it. */
function NarrowCellPicker() {
  return (
    <div className="flex items-start gap-3">
      <div data-narrow-cell style={{ width: 150 }}>
        <DateInput label="Datum v úzké buňce" locale="cs-CZ" />
      </div>
      <button type="button">Po úzké buňce</button>
    </div>
  );
}

createRoot(mountPoint).render(
  <>
    <ControlledPicker />
    <SubmissionForm />
    <BoundedSubmissionForm />
    <NarrowCellPicker />
  </>
);
