"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Clock, Gamepad2, MessageSquare, Phone } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { submitBooking } from "@/features/booking/actions/booking";
import { useFormErrorScroll } from "@/features/booking/hooks/use-form-error-scroll";
import {
  type BookingFormData,
  type BookingFormUserInput,
  getBookingSchema,
} from "@/features/booking/schemas/booking";
import { m } from "@/i18n";
import { useLocale } from "@/i18n/utils/use-locale";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import { siteConstants } from "@/shared/utils/constants";
import {
  formatDateTimeForInput,
  getMinBookingDateTime,
} from "@/shared/utils/date-formatting";
import { formatPrice } from "@/shared/utils/price-formatting";
import { getAvailableDurations } from "@/shared/utils/working-hours-timezone";
import styles from "./booking-form.module.css";

export function BookingForm() {
  const locale = useLocale();

  const bookingSchema = getBookingSchema();

  const form = useForm<BookingFormUserInput>({
    resolver: zodResolver(bookingSchema),
    defaultValues: siteConstants.booking.defaultValues,
    mode: "onTouched",
    shouldFocusError: false, // We handle focus in our custom error scroll hook
  });

  // Use the custom error scroll hook
  const { register: registerErrorRef } = useFormErrorScroll(
    form.formState.errors,
    {
      focusOnError: true,
      behavior: "smooth",
      block: "center",
    }
  );

  const { execute, isExecuting } = useAction(submitBooking, {
    onError: ({ error }) => {
      // Show server error as toast
      toast.error(
        typeof error.serverError === "string"
          ? error.serverError
          : m["errors.submissionError"]()
      );
    },
    onSettled: ({ result }) => {
      if (result?.validationErrors) {
        let firstErrorField: keyof BookingFormData | null = null;

        Object.entries(result.validationErrors).forEach(([field, errors]) => {
          if (
            bookingSchema.keyof().safeParse(field).success &&
            errors &&
            Array.isArray(errors)
          ) {
            if (!firstErrorField)
              firstErrorField = field as keyof BookingFormData;

            form.setError(field as keyof BookingFormData, {
              type: "server",
              message:
                typeof errors[0] === "string" ? errors[0] : "Validation error",
            });
          }
        });
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
          {m["hours.weekdays"]()} {siteConstants.workingHours.weekdays.open}-
          {siteConstants.workingHours.weekdays.close}
        </Badge>
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekends"]()} {siteConstants.workingHours.weekends.open}-
          {siteConstants.workingHours.weekends.close === "24:00"
            ? "00:00"
            : siteConstants.workingHours.weekends.close}
        </Badge>
      </div>

      <Form {...form}>
        {/* CSS Grid with named areas is implemented via CSS Modules
            This keeps styles localized to the component and ensures proper loading */}
        <form onSubmit={handleSubmit} className={styles.bookingFormGrid}>
          {/* Basic Information */}
          <Card
            className={cn(
              styles.gridAreaDatetimeInfo,
              "flex flex-col justify-between"
            )}
          >
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
                        step={siteConstants.booking.validation.time.minuteIncrement * 60}
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
                        field.value ||
                          siteConstants.booking.defaultValues.duration
                      )}
                      value={String(
                        field.value ||
                          siteConstants.booking.defaultValues.duration
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
                      onValueChange={(value) =>
                        field.onChange(parseInt(value, 10))
                      }
                      defaultValue={String(
                        field.value ||
                          siteConstants.booking.defaultValues.guestCount
                      )}
                      value={String(
                        field.value ||
                          siteConstants.booking.defaultValues.guestCount
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
                            length:
                              siteConstants.booking.validation.guestCount.max,
                          },
                          (_, i) =>
                            i + siteConstants.booking.validation.guestCount.min
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
            <CardContent className="space-y-4">
              {/* Larger Table Checkbox */}
              <FormField
                control={form.control}
                name="needsLargerTable"
                render={({ field }) => (
                  <FormItem
                    ref={registerErrorRef("needsLargerTable")}
                    className="flex flex-row items-start space-x-3 space-y-0"
                  >
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (checked)
                            form.setValue("needsPrivateSpace", false);
                        }}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="cursor-pointer">
                        {m["booking.tablePreferences.largerTable"]()}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {m["booking.tablePreferences.largerTableDescription"]()}
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              {/* Private Space Checkbox */}
              <FormField
                control={form.control}
                name="needsPrivateSpace"
                render={({ field }) => {
                  const guestCount = form.watch("guestCount");
                  const isDisabled = guestCount > 5;

                  return (
                    <FormItem
                      ref={registerErrorRef("needsPrivateSpace")}
                      className="flex flex-row items-start space-x-3 space-y-0"
                    >
                      <FormControl>
                        <Checkbox
                          checked={field.value && !isDisabled}
                          onCheckedChange={(checked) => {
                            if (!isDisabled) {
                              field.onChange(checked);
                              if (checked)
                                form.setValue("needsLargerTable", false);
                            }
                          }}
                          disabled={isDisabled}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel
                          className={cn(
                            "cursor-pointer",
                            isDisabled && "opacity-50"
                          )}
                        >
                          {m["booking.tablePreferences.privateSpace"]()}
                        </FormLabel>
                        <p className="text-sm text-muted-foreground">
                          {isDisabled
                            ? m[
                                "booking.tablePreferences.privateSpaceDisabled"
                              ]()
                            : m[
                                "booking.tablePreferences.privateSpaceDescription"
                              ]()}
                        </p>
                      </div>
                    </FormItem>
                  );
                }}
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
                          siteConstants.booking.validation.specialRequests.max
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
            className={cn(
              styles.gridAreaPricing,
              "bg-green-50 border-green-200"
            )}
          >
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-green-800">
                  {m["booking.pricingInfo"]({
                    priceWith: formatPrice(
                      siteConstants.pricing.entryFee.withPurchase,
                      locale
                    ),
                    priceWithout: formatPrice(
                      siteConstants.pricing.entryFee.withoutPurchase,
                      locale
                    ),
                  })}
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
