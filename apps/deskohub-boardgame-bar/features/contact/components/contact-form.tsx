"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics";
import { Send } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { submitContactForm } from "@/features/contact/actions/contact";
import {
  type ContactData,
  type ContactFormData,
  contactDefaultValues,
  getContactSchema,
} from "@/features/contact/schemas/contact";
import { m } from "@/features/i18n";
import { PhoneInput } from "@/shared/components/phone-input";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";

type ContactFormProps = {
  initialValues?: ContactFormInitialValues;
};

export type ContactFormInitialValues = Partial<ContactFormData>;

export function ContactForm({ initialValues }: ContactFormProps) {
  const form = useForm<ContactFormData, unknown, ContactData>({
    resolver: zodResolver(getContactSchema()),
    defaultValues: { ...contactDefaultValues, ...initialValues },
    mode: "onChange",
  });

  const { execute, isExecuting } = useAction(submitContactForm, {
    onSuccess: () => {
      track("Contact Form Success");
      toast.success(m["contact.successMessage"]());
      form.reset(contactDefaultValues);
    },
    onError: ({ error }) => {
      track("Contact Form Error", {
        error: error.serverError || "Unknown error",
      });
      toast.error(error.serverError || m["errors.submissionError"]());
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    track("Contact Form Submit", {
      hasPhone: !!data.phone,
    });
    execute(data);
  });

  return (
    <Card id="contact-form" className="bg-gray-900 border-gray-700">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-white">
          {m["contact.formTitle"]()}
        </CardTitle>
        <p className="text-gray-300">{m["contact.formDescription"]()}</p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">
                      {m["contact.nameLabel"]()} *
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        variant={fieldState.error ? "error" : "default"}
                        className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400"
                        placeholder={m["contact.namePlaceholder"]()}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">
                      {m["contact.phoneFormLabel"]()}
                    </FormLabel>
                    <FormControl>
                      <PhoneInput
                        {...field}
                        variant={fieldState.error ? "error" : "default"}
                        className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400"
                        placeholder={m["contact.phonePlaceholder"]()}
                        showValidation={true}
                        formatOnBlur={true}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    {m["contact.emailFormLabel"]()} *
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      variant={fieldState.error ? "error" : "default"}
                      className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400"
                      placeholder={m["contact.emailPlaceholder"]()}
                    />
                  </FormControl>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    {m["contact.messageLabel"]()} *
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      variant={fieldState.error ? "error" : "default"}
                      className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400"
                      placeholder={m["contact.messagePlaceholder"]()}
                    />
                  </FormControl>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full bg-green-500 hover:bg-green-600 text-white py-3 text-lg font-semibold"
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  {m["tableReservation.submitting"]()}
                </>
              ) : (
                <>
                  <Send className="w-5 h-5 mr-2" />
                  {m["contact.submitButton"]()}
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
