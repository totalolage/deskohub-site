import type { Locale } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import type { ReservationConfirmationData } from "../types/email.types";

/**
 * Email template for newly created reservations (pending confirmation)
 */
export function renderReservationCreatedEmail(
  data: ReservationConfirmationData,
  locale: Locale
) {
  const isEnglish = locale.startsWith("en");

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const subject = isEnglish
    ? `Reservation Request Received - ${data.customerName}`
    : `Přijali jsme vaši rezervaci - ${data.customerName}`;

  const html = `
    <!DOCTYPE html>
    <html lang="${locale}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">
          ${isEnglish ? "Reservation Request Received" : "Žádost o rezervaci přijata"}
        </h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          ${isEnglish ? `Dear ${data.customerName},` : `Vážený/á ${data.customerName},`}
        </p>
        
        <p style="font-size: 16px; margin-bottom: 20px;">
          ${
            isEnglish
              ? "We have received your reservation request. We will review it and confirm your booking shortly."
              : "Obdrželi jsme vaši žádost o rezervaci. Zkontrolujeme ji a brzy vám rezervaci potvrdíme."
          }
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #667eea; margin-top: 0;">
            ${isEnglish ? "Reservation Details" : "Detaily rezervace"}
          </h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Date:" : "Datum:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${formatDate(data.datetime)}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Time:" : "Čas:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${formatTime(data.datetime)}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Duration:" : "Doba trvání:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${data.duration} ${isEnglish ? "hours" : "hodin"}
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                <strong>${isEnglish ? "Number of Guests:" : "Počet hostů:"}</strong>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
                ${data.guestCount}
              </td>
            </tr>
            ${
              data.specialRequests
                ? `
            <tr>
              <td style="padding: 10px 0;">
                <strong>${isEnglish ? "Special Requests:" : "Speciální požadavky:"}</strong>
              </td>
              <td style="padding: 10px 0;">
                ${data.specialRequests}
              </td>
            </tr>
            `
                : ""
            }
          </table>
        </div>

        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #856404;">
            <strong>${isEnglish ? "Please Note:" : "Upozornění:"}</strong><br>
            ${
              isEnglish
                ? "This reservation is not yet confirmed. We will send you a confirmation email once your reservation is approved."
                : "Tato rezervace ještě není potvrzena. Jakmile bude vaše rezervace schválena, zašleme vám potvrzující e-mail."
            }
          </p>
        </div>

        <p style="font-size: 16px; margin-top: 30px;">
          ${isEnglish ? "Best regards," : "S pozdravem,"}<br>
          <strong>DeskOHub Team</strong>
        </p>
      </div>

      <div style="text-align: center; padding: 20px; color: #999; font-size: 14px;">
        <p>
          DeskOHub<br>
          ${isEnglish ? "Board Game Bar & Coworking Space" : "Deskové hry & Coworking"}<br>
          📍 Prague, Czech Republic<br>
          📧 ${siteConstants.contact.email} | 📞 ${siteConstants.contact.phone}
        </p>
      </div>
    </body>
    </html>
  `;

  const text = isEnglish
    ? `Reservation Request Received

Dear ${data.customerName},

We have received your reservation request. We will review it and confirm your booking shortly.

Reservation Details:
- Date: ${formatDate(data.datetime)}
- Time: ${formatTime(data.datetime)}
- Duration: ${data.duration} hours
- Number of Guests: ${data.guestCount}
${data.specialRequests ? `- Special Requests: ${data.specialRequests}` : ""}

Please Note: This reservation is not yet confirmed. We will send you a confirmation email once your reservation is approved.

Best regards,
DeskOHub Team

DeskOHub - Board Game Bar & Coworking Space
Prague, Czech Republic
${siteConstants.contact.email} | ${siteConstants.contact.phone}`
    : `Žádost o rezervaci přijata

Vážený/á ${data.customerName},

Obdrželi jsme vaši žádost o rezervaci. Zkontrolujeme ji a brzy vám rezervaci potvrdíme.

Detaily rezervace:
- Datum: ${formatDate(data.datetime)}
- Čas: ${formatTime(data.datetime)}
- Doba trvání: ${data.duration} hodin
- Počet hostů: ${data.guestCount}
${data.specialRequests ? `- Speciální požadavky: ${data.specialRequests}` : ""}

Upozornění: Tato rezervace ještě není potvrzena. Jakmile bude vaše rezervace schválena, zašleme vám potvrzující e-mail.

S pozdravem,
DeskOHub Team

DeskOHub - Deskové hry & Coworking
Praha, Česká republika
${siteConstants.contact.email} | ${siteConstants.contact.phone}`;

  return { subject, html, text };
}
