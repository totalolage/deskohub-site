"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Clock, Gamepad2, MessageSquare, Phone } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitBooking } from "@/features/booking/actions/booking";
import { useFormErrorScroll } from "@/features/booking/hooks/use-form-error-scroll";
import {
  type BookingFormData,
  getBookingSchema,
} from "@/features/booking/schemas/booking";
import { m } from "@/i18n";
import { useLocale } from "@/i18n/utils/use-locale";
import { constants } from "@/shared/utils/constants";
import {
  formatDateTimeForInput,
  getMinBookingDateTime,
} from "@/shared/utils/date-formatting";
import { getAvailableDurations } from "@/shared/utils/working-hours-timezone";
import { cn } from "@/shared/utils";
import styles from "./booking-form.module.css";

export function BookingForm() {
  const locale = useLocale();

  const form = useForm<BookingFormData>({
    resolver: zodResolver(getBookingSchema()),
    defaultValues: constants.booking.defaultValues,
    mode: "onTouched",
    shouldFocusError: false, // We handle focus in our custom error scroll hook
  });

  // Use the custom error scroll hook
  const { register: registerErrorRef } = useFormErrorScroll(
    form.formState.errors,
    {
      offset: 100, // Adjust based on your sticky header height
      focusOnError: true,
      behavior: "smooth",
      block: "center",
    }
  );

  const { execute, isExecuting } = useAction(submitBooking, {
    onError: ({ error }) => {
      // Show server error as toast
      toast.error(error.serverError || m["errors.submissionError"]());
    },
    onSettled: ({ result }) => {
      if (result?.validationErrors) {
        let firstErrorField: keyof BookingFormData | null = null;

        Object.entries(result.validationErrors).forEach(([field, errors]) => {
          const validFields: (keyof BookingFormData)[] = [
            "datetime",
            "guestCount",
            "duration",
            "name",
            "email",
            "phone",
            "tablePreference",
            "specialRequests",
          ];
          if (validFields.includes(field as keyof BookingFormData)) {
            if (errors && Array.isArray(errors)) {
              if (!firstErrorField) {
                firstErrorField = field as keyof BookingFormData;
              }
              form.setError(field as keyof BookingFormData, {
                type: "server",
                message: errors[0],
              });
            }
          }
        });

        // The useFormErrorScroll hook will automatically handle scrolling to the first error
      }
    },
  });

  const handleSubmit = form.handleSubmit(
    async (data) => {
      // Only execute if the data is valid
      execute(data);
    },
    (errors) => {
      // Client-side validation errors are handled by useFormErrorScroll hook
      console.error("Form validation errors:", errors);
    }
  );

  // Watch datetime field to update available durations
  const selectedDatetime = form.watch("datetime");
  const availableDurations = getAvailableDurations(selectedDatetime);

  return (
    <div className="space-y-6">
      {/* Operating Hours */}
      <div className="flex justify-center gap-4 mb-6">
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekdays"]()} {constants.workingHours.weekdays.open}-
          {constants.workingHours.weekdays.close}
        </Badge>
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekends"]()} {constants.workingHours.weekends.open}-
          {constants.workingHours.weekends.close === "24:00"
            ? "00:00"
            : constants.workingHours.weekends.close}
        </Badge>
      </div>

      <Form {...form}>
        {/* CSS Grid with named areas is implemented via CSS Modules
            This keeps styles localized to the component and ensures proper loading */}
        <form onSubmit={handleSubmit} className={styles.bookingFormGrid}>
          {/* Basic Information */}
          <Card className={styles.gridAreaDatetimeInfo}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-green-500" />
                {m["booking.dateLabel"]()} & {m["booking.timeLabel"]()}
              </CardTitle>
              <CardDescription>{m["descriptions.dateTime"]()}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Date and Time */}
              <FormField
                control={form.control}
                name="datetime"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("datetime")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>
                      {new Intl.ListFormat(locale, {
                        style: "long",
                        type: "conjunction",
                      }).format([
                        m["booking.dateLabel"](),
                        m["booking.timeLabel"](),
                      ])}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        min={getMinBookingDateTime()}
                        variant={fieldState.error ? "error" : "default"}
                        {...field}
                        value={
                          field.value &&
                          !Number.isNaN(new Date(field.value).getTime())
                            ? formatDateTimeForInput(field.value)
                            : ""
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value) {
                            field.onChange(new Date(value));
                          } else {
                            field.onChange(null);
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Duration */}
              <FormField
                control={form.control}
                name="duration"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("duration")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>{m["booking.durationLabel"]()}</FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(parseFloat(value))
                      }
                      defaultValue={String(
                        field.value || constants.booking.defaultValues.duration
                      )}
                      value={String(
                        field.value || constants.booking.defaultValues.duration
                      )}
                      disabled={availableDurations.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger
                          variant={fieldState.error ? "error" : "default"}
                        >
                          <SelectValue
                            placeholder={m["placeholders.duration"]()}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableDurations.map((hours) => (
                          <SelectItem key={hours} value={hours.toString()}>
                            {m.durationFormat({ hours })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Guest Count */}
              <FormField
                control={form.control}
                name="guestCount"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("guestCount")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>{m["booking.guestCountLabel"]()}</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={String(
                        field.value ||
                          constants.booking.defaultValues.guestCount
                      )}
                      value={String(
                        field.value ||
                          constants.booking.defaultValues.guestCount
                      )}
                    >
                      <FormControl>
                        <SelectTrigger
                          variant={fieldState.error ? "error" : "default"}
                        >
                          <SelectValue
                            placeholder={m["placeholders.guestCount"]()}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.from(
                          {
                            length: constants.booking.validation.guestCount.max,
                          },
                          (_, i) =>
                            i + constants.booking.validation.guestCount.min
                        ).map((num) => (
                          <SelectItem key={num} value={num.toString()}>
                            {m.guestCountPlural({ count: num })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card className={styles.gridAreaContactInfo}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-green-500" />
                {m["booking.contactTitle"]()}
              </CardTitle>
              <CardDescription>
                {m["booking.contactDescription"]()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("name")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>{m["booking.nameLabel"]()}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={m["placeholders.fullName"]()}
                        variant={fieldState.error ? "error" : "default"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("email")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>{m["booking.emailLabel"]()}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={m["placeholders.email"]()}
                        variant={fieldState.error ? "error" : "default"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phone */}
              <FormField
                control={form.control}
                name="phone"
                render={({ field, fieldState }) => (
                  <FormItem
                    ref={registerErrorRef("phone")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormLabel>{m["booking.phoneLabel"]()}</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder={m["placeholders.phone"]()}
                        variant={fieldState.error ? "error" : "default"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Table Preferences */}
          <Card className={styles.gridAreaTablePreferences}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-green-500" />
                {m["booking.tablePreferenceLabel"]()}
              </CardTitle>
              <CardDescription>{m["descriptions.tableType"]()}</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="tablePreference"
                render={({ field }) => (
                  <FormItem
                    ref={registerErrorRef("tablePreference")}
                    className="space-y-3 scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="space-y-2"
                      >
                        {constants.booking.validation.tablePreference.values.map(
                          (preference) => (
                            <div
                              key={preference}
                              className="flex items-center space-x-2"
                            >
                              <RadioGroupItem
                                value={preference}
                                id={preference}
                              />
                              <FormLabel
                                htmlFor={preference}
                                className="cursor-pointer"
                              >
                                {m[`booking.tablePreferences.${preference}`]()}
                              </FormLabel>
                            </div>
                          )
                        )}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Special Requests */}
          <Card className={styles.gridAreaSpecialRequests}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-green-500" />
                {m["booking.specialRequestsLabel"]()}
              </CardTitle>
              <CardDescription>
                {m["descriptions.specialRequests"]()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="specialRequests"
                render={({ field }) => (
                  <FormItem
                    ref={registerErrorRef("specialRequests")}
                    className="scroll-mt-[calc(var(--header-height)+20px)]"
                  >
                    <FormControl>
                      <Textarea
                        placeholder={m["booking.specialRequestsPlaceholder"]()}
                        rows={4}
                        maxLength={
                          constants.booking.validation.specialRequests.max
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Pricing Info */}
          <Card
            className={cn(styles.gridAreaPricing, "bg-green-50 border-green-200")}
          >
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-green-800">
                  {m["booking.pricingInfo"]()}
                </h3>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className={cn(styles.gridAreaSubmit, "text-center")}>
            <Button
              type="submit"
              size="lg"
              className="bg-green-500 hover:bg-green-601 text-white px-8 py-3 text-lg w-full"
              disabled={isExecuting}
            >
              {isExecuting ? m["booking.submitting"]() : m["booking.submit"]()}
            </Button>
            <p className="text-sm text-gray-500 mt-2">
              {m["descriptions.confirmationTime"]()}
            </p>
          </div>
        </form>
      </Form>
    </div>
  );
}
