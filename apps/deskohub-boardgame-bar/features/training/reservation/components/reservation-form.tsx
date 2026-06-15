"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { m } from "@/features/i18n";
import { PhoneInput } from "@/shared/components/phone-input";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import { submitTrainingRoomReservation } from "../actions/submit-reservation";
import {
  type ReservationFormData,
  reservationSchema,
  workspaceConstants,
} from "../schemas/reservation";

export function ReservationForm() {
  const router = useRouter();
  const form = useForm<ReservationFormData>({
    resolver: zodResolver(reservationSchema),
    defaultValues: workspaceConstants.defaultValues,
    mode: "onSubmit", // Validate on submit
    reValidateMode: "onChange", // Re-validate on every change after first submission
  });

  const { execute, isExecuting } = useAction(submitTrainingRoomReservation, {
    onSuccess: (result) => {
      // Check if result has the expected structure
      if (result?.data?.success) {
        toast.success(m["trainingReservation.success.title"](), {
          description: m["trainingReservation.success.description"](),
        });

        // Handle redirect on client side with query parameters
        if (result?.data?.redirectUrl) {
          router.push(result.data.redirectUrl);
        }
      }
    },
    onError: (error) => {
      // Display validation errors if available
      if (error?.error?.validationErrors) {
        const validationErrors = error.error.validationErrors;
        // Handle field-specific validation errors
        if (validationErrors.fieldErrors) {
          Object.entries(validationErrors.fieldErrors).forEach(
            ([field, errors]) => {
              if (Array.isArray(errors) && errors.length > 0) {
                // Type the field properly for form.setError
                const fieldName = field as keyof ReservationFormData;
                form.setError(fieldName, {
                  type: "manual",
                  message: errors[0],
                });
              }
            }
          );
        }
      } else {
        // Show general error toast if no specific validation errors
        toast.error(m["trainingReservation.error.title"](), {
          description:
            error?.error?.serverError ||
            m["trainingReservation.error.description"](),
        });
      }
    },
  });

  async function onSubmit(values: ReservationFormData) {
    execute(values);
  }

  return (
    <section
      className="reservation-form-container max-w-2xl mx-auto"
      aria-label={m["trainingReservation.form.title"]()}
    >
      <h2 className="text-2xl font-bold mb-6">
        {m["trainingReservation.form.title"]()}
      </h2>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate // Use our custom validation
          aria-label={m["trainingReservation.form.title"]()}
        >
          {/* User Information Section */}
          <fieldset className="space-y-4">
            <legend className="text-lg font-medium">
              {m["trainingReservation.form.yourInformation"]()}
            </legend>

            {/* Display validation error for the name/company field group */}
            {form.formState.errors.root?.nameAndCompany && (
              <div
                className="text-sm font-medium text-destructive"
                role="alert"
              >
                {form.formState.errors.root.nameAndCompany.message}
              </div>
            )}

            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="firstName">
                      {m["trainingReservation.form.firstName"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="firstName"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.firstNamePlaceholder"
                        ]()}
                        aria-label="First Name"
                        aria-describedby="firstName-error"
                        autoComplete="given-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="firstName-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="lastName">
                      {m["trainingReservation.form.lastName"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="lastName"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.lastNamePlaceholder"
                        ]()}
                        aria-label="Last Name"
                        aria-describedby="lastName-error"
                        autoComplete="family-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="lastName-error" />
                  </FormItem>
                )}
              />
            </div>

            {/* Company and Role Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="company"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="company">
                      {m["trainingReservation.form.company"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="company"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.companyPlaceholder"
                        ]()}
                        aria-label="Company"
                        aria-describedby="company-error"
                        autoComplete="organization"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="company-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="role">
                      {m["trainingReservation.form.role"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="role"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.rolePlaceholder"
                        ]()}
                        aria-label="Role"
                        aria-describedby="role-error"
                        autoComplete="organization-title"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="role-error" />
                  </FormItem>
                )}
              />
            </div>

            {/* Contact Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="email">
                      {m["trainingReservation.form.email"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="email"
                        type="email"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.emailPlaceholder"
                        ]()}
                        aria-label="Email"
                        aria-describedby="email-error"
                        aria-required="true"
                        aria-invalid={!!fieldState.error}
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="email-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="phone">
                      {m["trainingReservation.form.phone"]()}
                    </FormLabel>
                    <FormControl>
                      <PhoneInput
                        id="phone"
                        variant={fieldState.error ? "error" : "default"}
                        placeholder={m[
                          "trainingReservation.form.phonePlaceholder"
                        ]()}
                        aria-label="Phone Number"
                        aria-describedby="phone-error"
                        aria-required="true"
                        aria-invalid={!!fieldState.error}
                        autoComplete="tel"
                        showValidation={true}
                        formatOnBlur={true}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="phone-error" />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>

          {/* Reservation Details Section */}
          <fieldset className="space-y-4">
            <legend className="text-lg font-medium">
              {m["trainingReservation.form.reservationDetails"]()}
            </legend>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel htmlFor="date-button">
                      {m["trainingReservation.form.date"]()}
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            id="date-button"
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            aria-label="Select date"
                            aria-describedby="date-error"
                            aria-required="true"
                            aria-haspopup="dialog"
                            aria-expanded={false}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>
                                {m["trainingReservation.form.pickDate"]()}
                              </span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            return date < today;
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage id="date-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="time"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel htmlFor="time-select">
                      {m["trainingReservation.form.time"]()}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger
                          id="time-select"
                          variant={fieldState.error ? "error" : "default"}
                          aria-label="Select time"
                          aria-describedby="time-error"
                          aria-required="true"
                        >
                          <SelectValue
                            placeholder={m[
                              "trainingReservation.form.selectTime"
                            ]()}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* Generate time slots from 8:00 AM to 6:00 PM */}
                        {Array.from({ length: 11 }, (_, i) => {
                          const hour = i + 8;
                          const time = `${hour.toString().padStart(2, "0")}:00`;
                          const displayTime = `${
                            hour > 12 ? hour - 12 : hour
                          }:00 ${hour >= 12 ? "PM" : "AM"}`;
                          return (
                            <SelectItem key={time} value={time}>
                              {displayTime}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage id="time-error" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="duration"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor="duration-select">
                    {m["trainingReservation.form.duration"]()}
                  </FormLabel>
                  <Select
                    value={field.value?.toString()}
                    onValueChange={(value) =>
                      field.onChange(parseInt(value, 10))
                    }
                  >
                    <FormControl>
                      <SelectTrigger
                        id="duration-select"
                        variant={fieldState.error ? "error" : "default"}
                        aria-label="Select duration"
                        aria-describedby="duration-error"
                        aria-required="true"
                      >
                        <SelectValue
                          placeholder={m[
                            "trainingReservation.form.selectDuration"
                          ]()}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((hours) => (
                        <SelectItem key={hours} value={hours.toString()}>
                          {hours} {hours === 1 ? "hour" : "hours"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage id="duration-error" />
                </FormItem>
              )}
            />
          </fieldset>

          {/* Special Requirements Section */}
          <FormField
            control={form.control}
            name="specialRequirements"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor="special-requirements">
                  {m["trainingReservation.form.specialRequirements"]()}
                </FormLabel>
                <FormControl>
                  <Textarea
                    id="special-requirements"
                    variant={fieldState.error ? "error" : "default"}
                    placeholder={m[
                      "trainingReservation.form.specialRequirementsPlaceholder"
                    ]()}
                    className="min-h-[100px]"
                    aria-label="Special requirements"
                    aria-describedby="special-requirements-error special-requirements-count"
                    maxLength={
                      workspaceConstants.validation.specialRequirements.max
                    }
                    {...field}
                  />
                </FormControl>
                <div className="flex justify-between">
                  <FormMessage id="special-requirements-error" />
                  <span
                    id="special-requirements-count"
                    className="text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {field.value?.length || 0}/
                    {workspaceConstants.validation.specialRequirements.max}
                  </span>
                </div>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="w-full"
            disabled={isExecuting}
            aria-busy={isExecuting}
          >
            {isExecuting
              ? m["trainingReservation.form.submitting"]()
              : m["trainingReservation.form.submit"]()}
          </Button>
        </form>
      </Form>
    </section>
  );
}
