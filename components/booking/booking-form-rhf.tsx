"use client";

import { Calendar, Clock, Gamepad2, MessageSquare, Phone } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { m } from "@/i18n";
import { type BookingFormData } from "@/lib/schemas/booking";
import { useBookingSchema } from "@/lib/hooks/use-booking-schema";
import { constants } from "@/lib/constants";

interface BookingFormRHFProps {
  action: (data: BookingFormData) => Promise<void>;
  isSubmitting?: boolean;
  serverErrors?: Record<string, string[]>;
}

export function BookingFormRHF({
  action,
  isSubmitting = false,
  serverErrors = {},
}: BookingFormRHFProps) {
  const bookingSchema = useBookingSchema();

  const form = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: constants.booking.defaultValues,
    mode: "onTouched",
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await action(data);
    } catch (error) {
      console.error("Form submission error:", error);
    }
  });

  return (
    <div className="space-y-6">
      {/* Operating Hours */}
      <div className="flex justify-center gap-4 mb-6">
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekdays"]()} {m["hours.weekdaysTime"]()}
        </Badge>
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekends"]()} {m["hours.weekendsTime"]()}
        </Badge>
      </div>

      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-green-500" />
                  {m["booking.dateLabel"]()} & {m["booking.timeLabel"]()}
                </CardTitle>
                <CardDescription>
                  Choose your preferred date and time
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Date and Time */}
                <FormField
                  control={form.control}
                  name="datetime"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>
                        {m["booking.dateLabel"]()} a {m["booking.timeLabel"]()}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          min={new Date().toISOString().slice(0, 16)}
                          variant={
                            fieldState.error || serverErrors.datetime
                              ? "error"
                              : "default"
                          }
                          {...field}
                          value={
                            field.value &&
                            !isNaN(new Date(field.value).getTime())
                              ? new Date(field.value).toISOString().slice(0, 16)
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
                      {serverErrors.datetime && (
                        <p className="text-sm text-red-600">
                          {serverErrors.datetime[0]}
                        </p>
                      )}
                    </FormItem>
                  )}
                />

                {/* Guest Count */}
                <FormField
                  control={form.control}
                  name="guestCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{m["booking.guestCountLabel"]()}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={String(
                          field.value ||
                            constants.booking.defaultValues.guestCount,
                        )}
                        value={String(
                          field.value ||
                            constants.booking.defaultValues.guestCount,
                        )}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Number of guests" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.from(
                            {
                              length:
                                constants.booking.validation.guestCount.max,
                            },
                            (_, i) =>
                              i + constants.booking.validation.guestCount.min,
                          ).map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num} {num === 1 ? "person" : "people"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                      {serverErrors.guestCount && (
                        <p className="text-sm text-red-600">
                          {serverErrors.guestCount[0]}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Contact Information */}
            <Card>
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
                    <FormItem>
                      <FormLabel>{m["booking.nameLabel"]()}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="John Doe"
                          variant={
                            fieldState.error || serverErrors.name
                              ? "error"
                              : "default"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      {serverErrors.name && (
                        <p className="text-sm text-red-600">
                          {serverErrors.name[0]}
                        </p>
                      )}
                    </FormItem>
                  )}
                />

                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{m["booking.emailLabel"]()}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          variant={
                            fieldState.error || serverErrors.email
                              ? "error"
                              : "default"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      {serverErrors.email && (
                        <p className="text-sm text-red-600">
                          {serverErrors.email[0]}
                        </p>
                      )}
                    </FormItem>
                  )}
                />

                {/* Phone */}
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{m["booking.phoneLabel"]()}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="+420 123 456 789"
                          variant={
                            fieldState.error || serverErrors.phone
                              ? "error"
                              : "default"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      {serverErrors.phone && (
                        <p className="text-sm text-red-600">
                          {serverErrors.phone[0]}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Table Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-green-500" />
                {m["booking.tablePreferenceLabel"]()}
              </CardTitle>
              <CardDescription>
                Choose the type of table that suits your needs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="tablePreference"
                render={({ field }) => (
                  <FormItem className="space-y-3">
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
                          ),
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-green-500" />
                {m["booking.specialRequestsLabel"]()}
              </CardTitle>
              <CardDescription>Any special requests or notes?</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="specialRequests"
                render={({ field }) => (
                  <FormItem>
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
                    {serverErrors.specialRequests && (
                      <p className="text-sm text-red-600">
                        {serverErrors.specialRequests[0]}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Pricing Info */}
          <Card className="bg-green-50 border-green-200">
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-green-800">
                  {m["booking.pricingInfo"]()}
                </h3>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className="text-center">
            <Button
              type="submit"
              size="lg"
              className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 text-lg w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? m["booking.submitting"]() : m["booking.submit"]()}
            </Button>
            <p className="text-sm text-gray-500 mt-2">
              We'll confirm your booking within 24 hours
            </p>
          </div>
        </form>
      </Form>
    </div>
  );
}
