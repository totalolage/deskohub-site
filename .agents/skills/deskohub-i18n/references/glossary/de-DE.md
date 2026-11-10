# Deskohub Workspace glossary: German (`de-DE`)

Binding German terminology for the customer catalog, administration catalogs, legal documents and mobile catalog. Read it together with [style-guide.md](style-guide.md), which sets the shared rules (sources, placeholders, plurals, formatting, length). Where this file and the style guide disagree, this file wins for German. Every concept ID in [terms.md](terms.md) appears below.

| Surface | Register | Form |
|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | informal **du** | lowercase *du, dich, dir, dein*; imperative singular („Wähle“, „Gib … ein“) |
| Visitor speaking to the venue (FAQ questions, pre-filled support emails) | FAQ: *ihr* or impersonal; emails: **Sie** | „Habt ihr …?“ / „Gibt es …?“; email bodies start „Guten Tag,“ and use *Sie* (see K25) |
| Administration (staff UI, staff-facing copy) | formal **Sie** | „Wählen Sie …“, „Versuchen Sie es erneut.“ |
| Legal documents | formal **Sie**, mostly third person through defined terms | „der Kunde“, „der Anbieter“ (see L rows) |

Columns: **ID(s)** = master ids; **German** gives article and plural (Pl.) for nouns. "not:" lists forbidden alternatives. Where a row says "button", the button budget in style guide §9 applies.

## P: products and spaces

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| P01, P02 | coworking, cowork | coworking, cowork | das Coworking; CTA „Coworking reservieren“ | One word for both Czech forms (style guide §1). Compounds with hyphen: Coworking-Platz, Coworking-Bereich, Coworking-Preise. not: Cowork (bare), Co-Working, Coworking-Space as the product name. |
| P03 | open space, otevřený prostor | open space | der Open Space; Open-Space-Platz | „Sdílené místo v otevřeném prostoru“ = „gemeinsam genutzter Platz im Open Space“. not: Großraumbüro (negative connotation), offener Raum. |
| P04, P05 | zasedací místnost, zasedačka | meeting room | der Meetingraum (Pl. Meetingräume) | One everyday word for both Czech registers; shorter than the alternatives on CTAs („Meetingraum reservieren“). Long compounds: „Reservierungen des Meetingraums“ or hyphen „Meetingraum-Reservierungen“. not: Besprechungsraum, Besprechungszimmer, Konferenzraum, Sitzungszimmer. |
| P06, P07 | kancelář, soukromá kancelář | office, private office | das Büro (Pl. -s); das Privatbüro (nav label „Privatbüro“) | not: Einzelbüro, Office, privates Office. |
| P08 | pracovní stanice | workstation | die Workstation (Pl. -s) | Matches the tier name Profi Workstation; a desk with monitor setup. Keep distinct from Platz (P11). not: Arbeitsstation, Arbeitsplatz. |
| P09 | vyhrazené místo | reserved desk | der reservierte Platz; title „Reservierter Platz“ | A desk kept for you for the day. not: Fixdesk, Fixed Desk, fester Arbeitsplatz (these imply a monthly desk). |
| P10 | stůl | desk / table | der Tisch (Pl. -e) | Also the Dotypos table behind admin bookings (A09: Tischbuchung). „Schreibtisch“ is allowed for a coworking desk where the English says desk; the Dotypos table is always „Tisch“. not: Pult. |
| P11 | místo | spot / seat | der Platz (Pl. Plätze) | The bookable unit; plural noun in seat counts („1 Platz“ / „{count} Plätze“). not: Sitz, Sitzplatz, Arbeitsplatz, Spot. |
| P12 | místnost | room | der Raum (Pl. Räume) | not: Zimmer. |
| P13, L08 | prostor, pracovní prostor; Sdílený pracovní prostor | space, workspace (generic); shared workspace | der Arbeitsort (Pl. -e); legal L08 „gemeinsam genutzter Arbeitsort“ | `workspaceDescription`: „Ein flexibler Arbeitsort für …“. Plural venue sense („prostory“ outside defined-term use): „Räume“. Never lowercase „Workspace“ for the generic noun: it is the brand (P32). |
| P14, P16 | TTRPG místnost; one-shot | TTRPG room; one-shot | der TTRPG-Raum; der One-Shot (Pl. -s) | TTRPG stays as the acronym; One-Shot is the usual German RPG loan. not: Rollenspielzimmer, Einzelabenteuer. |
| P15 | kampaň (TTRPG) | campaign (role-playing) | die Kampagne (Pl. -n) | German RPG players say Kampagne too. Same German word as A24 (email campaign); the surfaces never meet, so no second word is needed. not: Feldzug, Abenteuerreihe. |
| P17 | bar | bar | die Bar (Pl. -s); „Brettspielbar“ where Czech names the board-game bar | not: Kneipe, Lokal. |
| P18, X09 | provozovna, adresa provozovny | venue / premises, venue address | der Standort (Pl. -e); footer label „Adresse des Standorts“ | Same concept in footer, legal and UI. Registered office (sídlo) is „Sitz“, a different word. not: Betriebsstätte, Filiale, Niederlassung, Location. |
| P19 | nabídka | offering / options | das Angebot (Pl. -e) | Tier picker label `reservationTierLabel` „Angebot“. Not a sale: sale is Rabattaktion (D06). not: Sonderangebot, Option. |
| P20, L10 | tarif; Tarif (legal) | tier / plan; Tariff | der Tarif (Pl. -e) | Same word in UI and as the legal defined term. „der Tarif Cowork Plus“. not: Plan, Paket, Stufe. |
| P21 | výhody | perks | die Vorteile (Pl.) | Perk-list label. not: Leistungen (reserved for legal Services L07), Extras, Benefits. |
| P22, P23, P24 | Basic Day Pass, Cowork Plus, Profi Workstation; Basic | tier names | Basic Day Pass, Cowork Plus, Profi Workstation; Basic | Verbatim, uninflected. Never compound (not: Cowork-Plus-Tarif, Basic-Day-Pass-Reservierung); attach grammar to a noun: „der Tarif Cowork Plus“, „Reservierung für Basic Day Pass“. Don't invent „Tagespass“. |
| P25 | monitorový setup, profi setup | monitor setup, pro setup | das Monitor-Setup (Pl. -s); perk „Profi-Setup“ | „sestava monitorů“ is the same concept: Monitor-Setup. „Profi“ here is the ordinary German word, not the tier name. not: Bildschirmkonfiguration, Monitoraufbau. |
| P26 | batch brew káva | batch brew coffee | der Batch-Brew-Kaffee; „Batch Brew“ alone | Loan stays. not: Filterkaffee as a replacement. |
| P27 | káva zdarma | free coffee | Kaffee gratis / kostenloser Kaffee | Only here and in other price-free contexts may „gratis/kostenlos“ appear (compare R15). Perk lists capitalise the noun: „Kaffee gratis“. |
| P28 | Wi-Fi | Wi-Fi | das WLAN; WLAN-Passwort | German UI, router labels and venue signage say WLAN; „Wi-Fi“ reads as untranslated. The one German exception to the industry-name rule (style guide §4). A technical standard name stays („Wi-Fi 6“). not: Wi-Fi, WiFi, Wifi as the network noun. |
| P29 | monitor | monitor | der Monitor (Pl. -e) | not: Bildschirm. |
| P30 | člen Workspace | Workspace member | das Workspace-Mitglied | Fallback display name `accountProfileScreenMemberFallback`. Mitglied is grammatically neuter, so it needs no gender marking. not: Workspace-Mitglied:in, Mitglied/in, Nutzer. |
| P31, P32, P33 | Deskohub Workspace; Workspace (brand); Deskohub | brands | Deskohub Workspace; Workspace; Deskohub | Never translate, inflect or add a genitive -s. Attach grammar to a preposition or noun: „bei Deskohub Workspace“, „im Workspace“ (dative, fine for either gender), „das Team von Deskohub“. Avoid accusative/genitive with the bare brand. Compound only one-word brands with a hyphen (Deskohub-Team); for the two-word brand rephrase („dein Konto bei Deskohub Workspace“, not Deskohub-Workspace-Konto). |

## R: reservation

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| R01, L13 | rezervace; Rezervace (legal) | reservation; Booking (legal English) | die Reservierung (Pl. -en) | **Decision:** one root in UI, admin and legal, because Czech uses one root and the legal definition (GTC 2.7) defines the very thing the UI sells; the legal English "Booking" is only the English rendering. Keeping „Buchung“ free lets A09 (Dotypos table booking) stay a different word. The binding, paid nature is stated by the checkout button (R05) and the GTC definition, not by the noun. not: Buchung, Reservation, Belegung. |
| R02 | rezervovat | book / reserve | reservieren; button „Reservieren“ | „Rezervovat cowork“ = „Coworking reservieren“. not: buchen, bestellen (except R05). |
| R03 | rezervační | booking (adj.) | Reservierungs- (closed compound): die Reservierungsanfrage, der Reservierungslink, das Reservierungsformular | `reservationSuccessMessage` „Rezervační poptávka“ = „Deine Reservierungsanfrage“. not: Buchungs-. |
| R04, A10 | objednávka; objednávky (admin) | order; orders | die Bestellung (Pl. -en); die Bestellnummer | The paid order behind a reservation; support copy „Bestellnummer {orderId}“. not: Auftrag, Order. |
| R05 | Objednat a zaplatit | Order and pay | „Zahlungspflichtig bestellen“ (both button keys, no amount) | **Decision:** the Czech rule (§ 1826a OZ) and § 312j(3) BGB both implement Art. 8(2) of the Consumer Rights Directive (button must state an obligation to pay), and „zahlungspflichtig bestellen“ is the wording German readers know from their statute, so it is the safest unambiguous form. Czech law governs; Rome I Art. 6 does not import German law here (Art. 6(4)(a): services supplied only in Prague). `checkoutPayOrderAndPayButton` and `checkoutPayOrderAndPayAmountButton` both read „Zahlungspflichtig bestellen“: German guidance discourages extra content on this button, so the German amount key drops `{amount}` (the only key where a placeholder is deliberately left out). Length exemption: 27 characters, by law. not: Bestellen, Weiter, Reservieren, Jetzt buchen, Bestellung abschließen, Bestellen und bezahlen, Kaufen, „Zahlungspflichtig bestellen ({amount})“. |
| R06 | poptávka | inquiry | die Anfrage (Pl. -n) | Contact form for offices and events. not: Nachfrage, Angebotsanfrage. |
| R07, R08, R09, R10, R11 | termín; datum, začátek, konec; délka | date / time slot; date, start, end; duration | der Termin (Pl. -e); das Datum; der Beginn; das Ende; die Dauer | Termin = a date or slot. Field labels „Datum“, „Beginn“, „Ende“, „Dauer“. not: Frist, Deadline (for termín), Start, Startzeit, Schluss, Länge. |
| R12, R13 | hodina, den | hour, day | die Stunde (Pl. -n); der Tag (Pl. -e) | Plural nouns: `one` „{count} Stunde“, `other` „{count} Stunden“; „{count} Tag“ / „{count} Tage“. Abbreviations („Std.“) only where Czech abbreviates. |
| R14, R15, R16 | dostupnost; volný, volno; obsazeno | availability; available / free; booked / taken | die Verfügbarkeit; verfügbar, „frei“ only for an open slot („freie Plätze“); belegt | volný is never kostenlos/gratis (that is P27). `bookingWidgetNotAvailable` „Sieht so aus, als wäre alles belegt.“ not: Belegungsplan, ausgebucht, gebucht (Buchung is A09), besetzt. |
| R17, S03 | potvrzení, potvrdit; potvrzeno | confirmation, confirm; confirmed | die Bestätigung; bestätigen; bestätigt | Booking confirmation and its email. Keep apart from U13 (verifizieren). not: Verifizierung, Freigabe. |
| R18, L16 | zrušení, zrušit; Storno Rezervace | cancellation, cancel; Booking Cancellation | Reservation: die Stornierung, stornieren; legal heading L16 „Stornierung der Reservierung“; payment: „abgebrochen“ (`checkoutStatusCancelledTitle` „Die Zahlung wurde abgebrochen.“) | Dialog button „Abbrechen“ is A52. not: Kündigung (ends a continuing contract), Storno (reserved for A12), Annullierung. |
| R19 | změna | change | die Änderung; button „Ändern“ | not: Wechsel, Modifikation. |
| R20 | Rezervoval(a) {name} | Booked by {name} | „Reserviert von {name}“ | **Decision:** a participle carries no gender and keeps the R01 root. Sibling `accountReservationBookedFor` „Für {name}“. not: „Reserviert durch“, „Gebucht von“, „{name} hat reserviert“ with gendered pronouns, slash forms. |
| R21 | přiřazené místo | assigned desk | der zugewiesene Platz | not: zugeteilter Sitz. |
| R22, R23 | platnost, platí; vypršet | validity, is valid; expire | die Gültigkeit, gültig sein; ablaufen, abgelaufen | „Der Link ist abgelaufen.“ not: Laufzeit, verfallen, expiriert. |

## K: payment and billing

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| K01, K02, K03 | platba; zaplatit; zaplaceno | payment; pay; paid | die Zahlung (Pl. -en); bezahlen; bezahlt | „Bitte bezahle bis …“. not: Bezahlung (as the noun), Payment. |
| K04 | platební karta, karta | payment card | die Zahlungskarte; short „Karte“ | Button `accountBillingAddPaymentCard` „Karte hinzufügen“. not: Kreditkarte, Bankkarte, EC-Karte. |
| K05 | platební metoda | payment method | die Zahlungsmethode (Pl. -n) | not: Zahlungsart, Zahlungsmittel. |
| K06 | platební brána, platební stránka | payment gateway / payment page | die Zahlungsseite (von Nexi) | The Nexi hosted page; one German word for both Czech forms. not: Payment-Gateway, Zahlungsportal, Bezahlseite. |
| K07 | platební odkaz | payment link | der Zahlungslink (Pl. -s) | not: Bezahllink, Zahlungsverknüpfung. |
| K08 | Nexi | Nexi | Nexi | Brand, uninflected: „über Nexi“, „die Zahlungsseite von Nexi“. not: Nexis. |
| K09, K10 | cena; základní cena | price; base price | der Preis (Pl. -e); der Grundpreis | not: Kosten, Basispreis, Listenpreis. |
| K11, L11 | ceník; Ceník (legal) | price list; Price List | die Preisliste (Pl. -n) | Page title and legal defined term. not: Preise (as the page name), Tarife (collides with P20), Preisübersicht. |
| K12, K13 | částka; celkem | amount; total | der Betrag (Pl. Beträge); „Gesamt“ (label), „insgesamt“ (prose) | `invoiceTotalPaidLabel` „Insgesamt bezahlt“. not: Summe as a label. |
| K14, K15 | měna; Kč | currency; CZK | die Währung; CZK | Prose names the currency „CZK“ (`pricingIntro` „Preise in CZK für …“). Never Kč, Kronen, tschechische Kronen, EUR. |
| K16, K17 | faktura; fakturační údaje | invoice; billing details | die Rechnung (Pl. -en); die Rechnungsdaten (Pl.) | The invoice is the only tax document. not: Quittung, Beleg, Kassenbon, Gutschrift; Abrechnungsdaten, Rechnungsadresse (narrower). |
| K18, K19 | DPH; neplátce DPH | VAT; not a VAT payer | die Umsatzsteuer, abbr. „USt.“; „in Tschechien nicht als Umsatzsteuerzahler registriert“ | **Decision:** German tax law and the USt-IdNr. use the Umsatzsteuer root, so one root for every VAT label; content stays the Czech VAT fact. A Czech neplátce can still be VAT-identified, so don't say „not registered for VAT“ in general. `invoiceNonVatPayerStatement` „Wir sind in Tschechien nicht als Umsatzsteuerzahler registriert.“; `footerVatStatus` „Gesellschaft in Tschechien nicht als Umsatzsteuerzahler registriert“. not: MwSt., Mehrwertsteuer, DPH, umsatzsteuerbefreit; never Kleinunternehmer or § 19 UStG (German law). |
| K20, K21 | IČO; DIČ | company ID number; VAT ID | form label „Firmennummer (IČO)“, before a value in legal and footer „IČO“; „USt-IdNr.“ (`reservationBillingVatIdLabel` „USt-IdNr. (optional)“) | **Decision:** the IČO field runs the Czech ARES lookup, so the Czech code stays visible and „Firmennummer“ tells a German reader what it is. DIČ follows the English twin (VAT ID) for the billing fields; where a text means the general Czech tax number rather than a VAT ID, use „Steuernummer (DIČ)“ and flag the key. Values never change. not: Handelsregisternummer, Steuernummer without „(DIČ)“, St.-Nr., Steuer-ID, bare DIČ. |
| K22 | firma, společnost | company | die Firma (customer's company field); die Gesellschaft (Desktechub s.r.o. in footer and legal) | not: Unternehmen as a form label, Company. |
| K23, K24 | PSČ; ulice | postal code; street | die PLZ; die Straße | Address-line label may read „Straße und Hausnummer“ if the Czech field holds both. Values stay Czech. not: Postleitzahl spelled out on labels, Str. |
| K25 | platba po vypršení blokace rezervace | payment after the reservation hold expired | „Zahlung nach Ablauf der Reservierungsfrist“; the hold: die Reservierungsfrist; verb „Wir halten deine Reservierung bis {expiresAt}“ | Pre-filled support emails (`checkoutStatusLatePaymentReviewContactMessage` and siblings) are the customer writing to the venue: „Guten Tag,“ + Sie. not: Blockierung, Sperre, Reservierungssperre. |

## D: discounts and referrals

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| D01 | sleva | discount | der Rabatt (Pl. -e) | Sale banners: „{title}: <discount>{adjustment}</discount> Rabatt auf …“. not: Ermäßigung, Nachlass, Discount, Preisnachlass. |
| D02, D03 | slevový kód; kód | discount code; code | der Rabattcode (Pl. -s); der Code (Pl. -s) | not: Gutscheincode (collides with D04), Promo-Code, Aktionscode, Kode. |
| D04 | poukaz | voucher | der Gutschein (Pl. -e) | **Decision:** the normal German word for prepaid or promotional vouchers. „Geschenkgutschein“ only where Czech says dárkový. not: Voucher, Geschenkkarte, Coupon. |
| D05 | Sleva, poukaz nebo doporučovací kód | Discount, voucher or referral code | „Rabatt, Gutschein oder Empfehlungscode“ | `checkoutDiscountCodeLabel`: three distinct words, in this order. |
| D06, A08 | akce (sale) | sale / promotion | die Rabattaktion (Pl. -en) | Admin area `discounts:discountsSalesTitle` „Rabattaktionen“. Never bare „Aktion(en)“ for a sale: that word belongs to A07. not: Sale, Sonderangebot, Angebot. |
| D07 | akce (event), event | event | die Veranstaltung (Pl. -en); legal „eventové prostory“ = Veranstaltungsräume | `landingOfferingEvents` „Firmen- und andere Veranstaltungen …“. not: Event, Aktion, Feier. |
| D08 | doporučení | referral | die Empfehlung (Pl. -en); section „Empfehlungen“ | Plural in `accountReferralsHowBenchmark`: `one` „Empfehlung“, `other` „Empfehlungen“. not: Weiterempfehlung, Referral, „Freunde werben“. |
| D09, D10 | doporučovací kód; doporučovací odkaz | referral code; referral link | der Empfehlungscode; der Empfehlungslink | Buttons next to the value: „Code kopieren“, „Link kopieren“ (`accountReferralsCopyCode`, `accountReferralsCopyLink`). not: Einladungscode, Werbecode, Referral-Link. |
| D11 | první rezervace | first reservation | die erste Reservierung | not: Erstbuchung. |

## U: account and authentication

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| U01 | účet | account | das Konto (Pl. Konten); „Mein Konto“ | not: Account, Benutzerkonto, Profil (U02). |
| U02 | profil | profile | das Profil (Pl. -e) | |
| U03, U04 | přihlásit se, přihlášení; odhlásit se | sign in, sign-in; sign out | sich anmelden, die Anmeldung, button „Anmelden“; sich abmelden, button „Abmelden“ | **Decision:** „Anmelden“ is what Apple, Google and Microsoft use in German UIs, and it is neutral in register. Separable: „Melde dich an“, „Melde dich nächstes Mal schneller an“. not: einloggen, Login, Log-in, ausloggen, Logout. |
| U05, U06 | přihlašovací odkaz; přihlašovací kód | sign-in link; sign-in code | der Anmeldelink (Pl. -s); der Anmeldecode (Pl. -s) | Never „Magic Link“ in customer copy. not: Login-Link, Einmalcode, OTP, Login-Code, Bestätigungscode (A38). |
| U07 | přístupový klíč | passkey | der Passkey (Pl. Passkeys) | **Decision:** Apple, Google and Microsoft all ship „Passkey/Passkeys“ in German. Short back-references in Czech („Klíč si uloží …“) become „den Passkey“, never „den Schlüssel“. not: Hauptschlüssel, Zugangsschlüssel, Passschlüssel, Sicherheitsschlüssel, Zugangscode (X01). |
| U08, U09 | správce hesel; heslo | password manager; password | der Passwortmanager; das Passwort (Pl. Passwörter) | not: Kennwort, Passwort-Manager. |
| U10, A47 | relace; relace CLI | session; CLI session | die Sitzung (Pl. -en); die CLI-Sitzung | not: Session. |
| U11, U12 | zařízení; prohlížeč | device; browser | das Gerät (Pl. -e); der Browser | not: Endgerät, Webbrowser in short labels. |
| U13 | ověření, ověřit | verification, verify | die Verifizierung; verifizieren; „Code verifiziert“ | Keep apart from R17 bestätigen. not: Bestätigung, Prüfung. |
| U14 | e-mail | email | die E-Mail (Pl. -s); die E-Mail-Adresse | not: Email, eMail, Mail. |
| U15, U16, A06, L03 | zákaznický účet; zákazník (UI and admin); Klient (legal) | customer account; customer; Client | das Kundenkonto; der Kunde (Pl. -n) | UI: prefer compounds and „du“ over the person noun („Du hast schon ein Konto?“ for `reservationSignInPrompt`). Admin: „der Kunde“ is the record type; prefer neutral compounds and plurals (Kundendetails, Kundenliste, Kunden). Legal: defined term „Kunde“ for Klient (see L02). Never „Klient“ (the software client is „Client“, A50). not: Kundin/Kunde, Kund:in, Kund*innen, Klient. |
| U17 | telefon | phone | das Telefon; label „Telefonnummer“ | Placeholder example per style guide: +49 151 00000000. |

## X: access and venue

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| X01, A01 | přístupový kód | access code | der Zugangscode (Pl. -s) | The door code for a reservation, customer and admin. Button `checkoutEmailCustomerAccessButton` „Zugangscode anzeigen“. not: Passkey, Zugangsschlüssel, Türcode, Zutrittscode. |
| X02, L12 | PIN, PIN kód; Přístupový PIN kód (legal) | PIN, PIN code; Access PIN Code | die PIN (Pl. -s); legal defined term „Zugangs-PIN“ | `accountReservationShowPinCode` „PIN anzeigen“. not: PIN-Code, PIN-Nummer, Geheimzahl. |
| X03, X04 | dveře; klávesnice | door; keypad | die Tür (Pl. -en), die Eingangstür; das Tastenfeld | „hlavní dveře“ = Haupteingang. `landingAccessStepKeypad` „Gib die PIN am Tastenfeld an der Eingangstür ein.“ not: Pforte, Tor; Tastatur (computer keyboard), Keypad, Codeschloss. |
| X05 | vstup | entry / entrance | der Zutritt (getting in); der Eingang (the place) | Legal „coworkingové vstupy“ = „Coworking-Zutritt“. not: Eintritt (sounds like a ticketed event), Einlass. |
| X06, A15 | přístup; přístup ke dveřím | access; door access | der Zugang (Pl. Zugänge); der Türzugang | Generic access to data, door or account. not: Zugriff for the door; „Zugriff“ only for data access if Czech is about permissions. |
| X07, X08 | otevírací doba; otevřeno nonstop | opening hours; open 24/7 | die Öffnungszeiten (Pl.); „rund um die Uhr geöffnet“ | Badge may use „24/7 geöffnet“. not: Geschäftszeiten, nonstop. |
| X10, X12 | Palmovka; Libeň | Palmovka; Libeň | Palmovka; Libeň | Never translate or inflect. „in Palmovka“, „in Libeň“, „Metrostation Palmovka“. not: an der Palmovka, Palmovkas. |
| X11 | Praha | Prague | Prag | Prose only; postal addresses keep „Praha 8“. |
| X13 | metro | metro | die Metro; „Metrolinie B“ | Prague's own name for the system. not: U-Bahn. |
| X14 | Google Maps | Google Maps | Google Maps | „In Google Maps öffnen“. |
| X15 | kontakt | contact | der Kontakt (Pl. -e); nav „Kontakt“ | `accountHelpContact` „kontaktiere uns“ (lowercase, inside a sentence). |

## G: consent and privacy

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| G01 | souhlas | consent | die Einwilligung (data, marketing, cookies); zustimmen / die Zustimmung (terms and documents) | Czech uses one word; German law uses two. GDPR consent is always Einwilligung („einwilligen“). Agreeing to the GTC or House Rules is „zustimmen“ / „akzeptieren“ (`checkoutPayConsent` „Ich stimme … zu“). not: Erlaubnis, Einverständnis. |
| G02, G03 | marketingový souhlas; marketingová sdělení | marketing consent; marketing messages | die Marketing-Einwilligung; die Marketingnachrichten (Pl.) | not: Werbeeinwilligung, Newsletter, Werbung. |
| G04, G05, G06, G07 | cookies; nezbytné cookies; analytické a marketingové cookies; nastavení cookies | cookies and categories | die Cookies (Pl.); notwendige Cookies; Analyse- und Marketing-Cookies; die Cookie-Einstellungen | not: Kekse, essenzielle Cookies, technisch notwendige Cookies (unless Czech adds technicky). |
| G08, L24 | osobní údaje; zpracování osobních údajů | personal data; processing of personal data | personenbezogene Daten (Pl.); die Verarbeitung personenbezogener Daten | GDPR wording in UI and legal. not: persönliche Daten, Personendaten. |
| G09 | soukromí | privacy | der Datenschutz | not: Privatsphäre (except a literal privacy-of-person sense). |

## S: status and errors

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| S01, S02 | stav; čeká | status; pending | der Status; „ausstehend“ (badge), „wartet auf …“ (prose) | not: Zustand, pendent, offen (ambiguous). |
| S04 | zkusit znovu | try again | button „Erneut versuchen“; prose customer „Versuch es noch einmal.“, admin „Versuchen Sie es erneut.“ | not: Nochmal versuchen, Wiederholen, Retry. |
| S05, S06 | nepodařilo se; načítání, načíst | could not; loading, load | „… konnte nicht geladen werden.“ pattern („X konnte nicht … werden.“); „Wird geladen …“, verb „laden“ | Errors state the fact, then the action. No added apology („Leider“, „Entschuldigung“) unless Czech has one. not: Fehler beim Laden von X (except as a title), lädt …. |
| S07, S08 | podpora; pomoc | support; help | der Support; die Hilfe | not: Kundendienst, Helpdesk. |
| S09 | neplatný | invalid | ungültig | not: invalide, falsch (blames the user). |

## I: AI assistants

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| I01 | AI asistent | AI assistant | der KI-Assistent (Pl. -en) | German says KI. not: AI-Assistent, KI-Agent, Chatbot, Bot. |
| I02 | konektor | connector | der Konnektor (Pl. -en) | Claude's German help uses „Konnektoren“; re-check the live label when translating `aiAssistantsCustomConnector*`. not: Connector, Verbindung. |
| I03 | aplikace (ChatGPT) | app (ChatGPT Apps) | ChatGPT's current German menu label (source says „Apps“) | Check the live German ChatGPT UI when translating `aiAssistantsChatGptStepFind` and quote its label exactly. OpenAI's German help may already show a newer label (for example „Einstellungen > Plugins“). If the label has changed, the Czech and English are stale too: flag the key, don't silently diverge. not: Anwendungen. |
| I04, I05 | ChatGPT, Claude; MCP | product names; protocol | ChatGPT, Claude; MCP | Verbatim, uninflected. „in ChatGPT“, „mit Claude“. |

## M: mobile app

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| M01 | aktualizace | update | das Update (Pl. -s) | `update_ready` „Ein App-Update ist bereit. …“. not: Aktualisierung (longer), Upgrade. |
| M02 | restartovat | restart | button „Neu starten“; der Neustart | not: Restarten, Neustarten (one word as a verb). |
| M03 | vrátit se do aplikace | return to the app | zur App zurückkehren; `signin_returning_to_app` „Du wirst zur App zurückgeleitet.“ | die App (Pl. -s). not: Anwendung, Applikation. |

## A: administration

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| A02 | administrace | administration | die Administration | Nav label `shell:shellNavigationLabel`. not: Verwaltung, Admin-Bereich, Backend. |
| A03, A04, A05 | administrátor; role administrátora; udělit / odebrat roli | administrator; administrator role; grant / revoke role | die Administratorrolle; „Rolle vergeben“ / „Rolle entziehen“; person in tight labels: der/die Admin (Pl. Admins) | Build copy around the role, not the person: `administratorsGrantTitle` „Administratorrolle vergeben“, `administratorsGrantSubmit` „Rolle vergeben“. not: Administrator/in, Administrator:in, AdministratorIn, Administratorinnen und Administratoren. |
| A07 | akce (actions) | actions | die Aktionen (Pl.) | Table column `administration:administrationTableActions`. Only this meaning may use bare „Aktionen“. not: Rabattaktionen, Optionen. |
| A09 | rezervace stolu | booking (Dotypos) | die Buchung (Pl. -en); die Tischbuchung | `administrationBookingDetailTitle` „Details der Tischbuchung“. Must never read as Reservierung. not: Tischreservierung, Reservierung, Belegung. |
| A11 | operace | operations | der Vorgang (Pl. Vorgänge); „Zahlungsvorgänge“ | Nexi payment operations. Operation types: Autorizace = Autorisierung, Stržení platby = Belastung, Vrácení peněz = Erstattung, Zrušení = Rücknahme (Nexi Cancel reverses a capture or refund; not an abandoned checkout), Storno = A12. not: Operationen, Transaktionen. |
| A12 | storno | void | das Autorisierungsstorno | Payment-provider void (`administrationProviderOperationTypeVoid`), not a reservation cancellation; „Stornierung“ belongs to R18. not: Stornierung, Storno (bare), Void. |
| A13 | platba nedokončena | payment abandoned | „Zahlung nicht abgeschlossen“ | Timeline event. not: Zahlung abgebrochen (that is R18), Zahlung verworfen. |
| A14 | aktivita rezervací | reservation activity | die Reservierungsaktivität | Calendar heatmap title. not: Buchungsaktivität. |
| A16, A17, A18 | filtry; stránkování; drobečková navigace | filters; pagination; breadcrumb | der Filter (Pl. Filter); die Seitennavigation; die Brotkrümelnavigation | Landmark labels for screen readers. not: Paginierung, Breadcrumb. |
| A19 | export | export | der Export; button „Exportieren“ | „CSV-Export“. not: Ausfuhr, Download. |
| A20 | odběratel | customer (invoice) | der Rechnungsempfänger | The invoice party on the statutory invoice form, a fixed invoicing term. not: Kunde (A06), Abnehmer, Käufer. |
| A21 | položky | line items | die Positionen (Pl.); die Rechnungsposition | not: Artikel, Posten, Zeilen. |
| A22 | datum splatnosti; po splatnosti; k úhradě | due date; overdue; due | das Fälligkeitsdatum; überfällig; „zu zahlen“ / „offener Betrag“ | not: Zahlungsziel (that is a period), Deadline, Verzug (legal consequence). |
| A23 | variabilní symbol | variable symbol | das variable Symbol (label „Variables Symbol“) | Czech bank payment reference; keep the Czech concept. First mention in help text may add „(Zahlungsreferenz für tschechische Banküberweisungen)“. not: Verwendungszweck, Referenznummer as a replacement. |
| A24 | kampaň | campaign | die Kampagne (Pl. -n); „E-Mail-Kampagne“ where context needs it | `emailCampaignsSendConfirmSubmit` „Kampagne senden“. See P15. not: Aussendung, Mailing. |
| A25, A26 | okruh příjemců; uložené publikum | audience; saved audience | die Zielgruppe (Pl. -n); „gespeicherte Zielgruppe“ | One German word for both Czech words. not: Publikum, Segment, Audience, Empfängerkreis. |
| A27 | příjemce | recipient | der Empfänger (Pl. Empfänger) | Mostly plural, which keeps counts neutral („{count} Empfänger“, same form for one/other except the count). not: Adressat, Empfänger:innen. |
| A28 | automatizace; automatická kampaň | automation; automated campaign | die Automatisierung (Pl. -en); „automatisierte Kampagne“ | not: Automation, Workflow. |
| A29, A30 | zkušební běh; běh | dry run; run | der Testlauf; der Durchlauf (Pl. Durchläufe) | One customer's pass through an automation = Durchlauf. not: Probelauf, Simulation, Lauf. |
| A31 | spuštění | fire (scheduled start) | die Ausführung (Pl. -en); `emailAutomationActivationNextFiresTitle` „Nächste Ausführungen“ | not: Auslösung, Start, Durchlauf (A30). |
| A32 | spouštěcí událost | trigger | der Auslöser; „auslösendes Ereignis“ where Czech spells out událost | not: Trigger, Startereignis. |
| A33, A34 | krok; podmínka | step; condition | der Schritt (Pl. -e); die Bedingung (Pl. -en) | not: Stufe, Regel. |
| A35 | vlastnost zákazníka | customer attribute | das Kundenmerkmal (Pl. -e) | not: Kundenattribut, Eigenschaft. |
| A36 | slevová skupina | discount group | die Rabattgruppe (Pl. -n) | Dotypos discount group; same Rabatt root as D01. |
| A37 | štítky v Dotyposu | Dotypos tags | die Tags (Pl.); `emailCampaignsAudienceDotyposTagsLabel` „Tags in Dotypos“ | Dotypos uninflected. not: Dotypos' Tags, Schlagwörter, Etiketten. |
| A38 | potvrzovací kód | confirmation code | der Bestätigungscode | Typed to confirm a send. not: Anmeldecode (U06). |
| A39, A40, A41, A42, A43, A44 | předmět; text náhledu; šablona; účel; překlad; zveřejnění | subject; preheader; template; purpose; translation; publishing | der Betreff; der Vorschautext; die Vorlage; der Zweck; die Übersetzung; die Veröffentlichung, veröffentlichen | Email editor fields. not: Thema, Preheader, Template, Publikation. |
| A45, A46 | archivovat; smazat | archive; delete | archivieren; löschen | Delete is permanent. not: entfernen (for delete). |
| A48, A49 | schválit; odvolat | approve; revoke | genehmigen; widerrufen | `adminCliAuthenticateApprovingAs` „Sie genehmigen als <email/>.“ not: freigeben, autorisieren, zurückziehen. |
| A50 | klient (CLI) | client | der Client (Pl. -s) | Software client of the dhw CLI. Never Kunde or Klient (legal party). |
| A51 | sestavení | build | der Build (Pl. -s) | CLI build version. not: Version, Kompilat. |
| A52, A53, A54 | zrušit; uložit / vytvořit; další / předchozí | cancel; save / create; next / previous | „Abbrechen“; „Speichern“ / „Erstellen“; „Weiter“ / „Zurück“ | Infinitive buttons. Cancel in dialogs is Abbrechen, never Stornieren. not: Anlegen, Nächste/Vorherige. |
| A55 | název; jméno; příjmení | name; first name; last name | die Bezeichnung or der Name (things); der Vorname; der Nachname | „Název“ of a record = „Name“ in short labels, „Bezeichnung“ in long ones. not: Familienname, Titel. |
| A56 | nepovinné | optional | „(optional)“ | not: (freiwillig), (nicht erforderlich). |
| A57 | propagační poukaz | promotional voucher | der Aktionsgutschein (Pl. -e) | `discounts:discountsVouchersPageTitle` „Aktionsgutscheine“. not: Werbegutschein, Promo-Voucher. |

## L: legal documents

Defined terms: German capitalises every noun, so capitals can't mark a defined term. The definition clause marks it („(nachfolgend „Kunde“)“), and the text then uses that exact noun every time, never a synonym. Legal text keeps the generic masculine for defined party terms (Kunde, Verbraucher, Nutzer, Betreiber, Anbieter, Verantwortlicher). These are legal roles that also cover legal persons, and German statutes use the same forms. Don't add a gender note the Czech doesn't have.

| ID(s) | Czech | English | German | Notes / forbidden alternatives |
|---|---|---|---|---|
| L01 | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | die Allgemeinen Geschäftsbedingungen (AGB) | Title and defined abbreviation „AGB“ (plural, „die AGB“). not: Nutzungsbedingungen, Geschäftsbedingungen without Allgemeine. |
| L02 | Poskytovatel | Provider | der Anbieter | The company in the GTC. Desktechub s.r.o. stays verbatim. not: Dienstleister, Unternehmer, Betreiber (L14). |
| L04 | Spotřebitel | Consumer | der Verbraucher | Statutory consumer (same concept as § 13 BGB, but defined by the Czech text). not: Konsument, Endkunde. |
| L05 | Smlouva | Contract | der Vertrag (Pl. Verträge) | not: Kontrakt, Vereinbarung. |
| L06 | Prostory | Premises | die Räumlichkeiten (Pl.) | Defined term; ordinary prose uses „Räume“. not: Prämissen, Gelände, Objekt. |
| L07 | Služby | Services | die Leistungen (Pl.) | Defined term. not: Dienste, Services, Dienstleistungen. |
| L09 | Provozní řád | House Rules (UI English: Operating Rules) | die Hausordnung | Title, defined term and the link text in `checkoutPayConsent`. not: Betriebsordnung, Nutzungsordnung. |
| L14, L15 | Provozovatel; Uživatel | Operator; User | der Betreiber; der Nutzer | House Rules parties. not: Benutzer, Besucher. |
| L17 | odstoupení od smlouvy | withdrawal from the contract | consumer's statutory right: der Widerruf, das Widerrufsrecht, die Widerrufsfrist; other contractual withdrawal: der Rücktritt | Decide per clause: the 14-day consumer right (Czech § 1829 OZ) is Widerruf; a party's contractual withdrawal is Rücktritt. `checkoutPayConsent` „zákonné lhůty pro odstoupení“ = „gesetzlichen Widerrufsfrist“. not: Kündigung, Storno. |
| L18 | vady a reklamace | defects and complaints | die Mängel und Reklamationen | GTC §12 heading. not: Beschwerden (general complaints), Garantie. |
| L19 | mimosoudní řešení spotřebitelských sporů | alternative consumer dispute resolution | die außergerichtliche Beilegung von Verbraucherstreitigkeiten | The Czech ADR body stays as named in Czech. not: Schlichtung (as the heading), Mediation. |
| L20 | Občanský zákoník, zákon č. 89/2012 Sb. | Civil Code, Act No. 89/2012 Coll. | „Gesetz Nr. 89/2012 Slg., Bürgerliches Gesetzbuch (Občanský zákoník)“ on first mention; afterwards „tschechisches Bürgerliches Gesetzbuch“ | Never abbreviate to „BGB“ (that means the German code) and never cite a German statute instead. |
| L21 | obchodní rejstřík | Commercial Register | das Handelsregister | Court name stays Czech: „Městský soud v Praze“, gloss allowed once: „(Stadtgericht Prag)“. „oddíl C, vložka 442830“ unchanged. |
| L22, L30 | Zásady ochrany osobních údajů; Zásady používání cookies | Privacy Policy; Cookie Policy | die Datenschutzerklärung; die Cookie-Richtlinie | Footer links and document titles. not: Datenschutzrichtlinie, Datenschutzbestimmungen, Cookie-Erklärung, Cookie-Hinweise. |
| L23 | Správce osobních údajů | Controller | der Verantwortliche | GDPR Art. 4(7) German term. not: Verwalter, Datenverwalter, Controller. |
| L25, L26, L27 | právní základ; doba uchování; předávání mimo EU | legal basis; retention period; transfers outside the EU | die Rechtsgrundlage; die Speicherdauer; die Übermittlung in Länder außerhalb der EU | Privacy §4, §5, §7 headings, GDPR German wording. not: Rechtsbasis, Aufbewahrungszeit, Transfer. |
| L28, L29 | Souhlas s marketingovou komunikací; odvolání souhlasu | Marketing Communications Consent; withdrawal of consent | „Einwilligung in Marketingkommunikation“; der Widerruf der Einwilligung | Uses G01 Einwilligung. not: Zustimmung, Rücknahme, Abmeldung (as the legal act). |

## Grammar and typography notes

**Nouns and capitalisation.** Capitalise every noun, including in perk lists and badges where Czech is lowercase („profi setup“ becomes „Profi-Setup“, „káva zdarma“ becomes „Kaffee gratis“). Lowercase *du, dich, dir, dein* everywhere, including emails. Formal *Sie, Ihnen, Ihr* are always capitalised.

**Compounds.**
- Join plain German words into one closed word: Reservierungsanfrage, Zahlungsseite, Rechnungsdaten, Meetingraum.
- Hyphenate when one part is a brand, acronym, digit or multi-word loan: Dotypos-Tags, Nexi-Zahlungsseite, KI-Assistent, TTRPG-Raum, CLI-Sitzung, E-Mail-Adresse, WLAN-Passwort, Coworking-Platz, Monitor-Setup, Batch-Brew-Kaffee, Open-Space-Platz.
- Two-word brand (Deskohub Workspace): don't build „Deskohub-Workspace-Konto“. Rephrase with „bei“/„von“: „dein Konto bei Deskohub Workspace“.
- Tier names are never part of a compound (not „Cowork-Plus-Tarif“; write „der Tarif Cowork Plus“).
- Long compounds over about 20 characters: rephrase with a genitive or preposition („Reservierungen des Meetingraums“) or hyphenate at the main joint („Meetingraum-Reservierungen“). Never on buttons.

**Brands and names in grammar.** Deskohub, Workspace, Nexi, Dotypos, Palmovka, Libeň, ChatGPT and Claude take no case endings and no genitive -s or apostrophe („Nexis“, „Dotypos'“ are wrong). Use prepositions: „über Nexi“, „in Dotypos“, „bei Deskohub“, „im Workspace“ (dative *im* is right whatever gender a reader assumes), „in Palmovka“.

**du-forms.** Imperative singular without -e where natural: „Wähle“, „Gib … ein“, „Versuch es noch einmal“, „Schreib uns“. Separable verbs keep the particle inside the same rich tag: `<signIn>Melde dich an</signIn>`, never `<signIn>Melde</signIn> dich an`. The Czech „můžeš“ becomes „du kannst“; Czech „tvé rezervace“ becomes „deine Reservierung“ (match the number of the Czech noun).

**Gender-neutral.** No Gendersternchen, colon, underscore, Binnen-I, slash or bracket forms. Use, in this order:
1. Neutral nouns: Mitglied, Person, Team, Kontakt.
2. The plural („Kunden“, „Empfänger“) or a compound („Kundendetails“).
3. Participles and passives („Reserviert von {name}“, „Die Rolle wurde vergeben.“).
4. Role nouns instead of person nouns („Administratorrolle“).

Never guess `{name}`'s gender. Legal defined terms are the exception described under L.

**Quotation marks and punctuation.** German quotes „…“ (U+201E, U+201C), nested ‚…‘. Apostrophe ’ (U+2019). Czech em dash with spaces („ — “) becomes a spaced en dash („ – “). Ellipsis „…“ as one character; with a space before it when it stands for missing words („Wird geladen …“). The comma before „und“ is not used for lists.

**Numbers, dates, money.** Everything comes formatted from Intl (de-DE: decimal comma, thousands dot, „14:00“, „8. November 2026“). Don't add „Uhr“, „€“, „Kč“ or „,-“ around a placeholder unless the Czech has the matching word. Prose currency is CZK. Units after a placeholder keep a space („{seconds} s“).

**Buttons.** Infinitive, verb last, no object when the context shows it: „Speichern“, „Abbrechen“, „Code kopieren“, „Karte hinzufügen“, „Erneut versuchen“. No „Bitte“ on buttons. The only exemption from the length budget is R05.

**Length.** German runs about 30 % longer than Czech. Budget: buttons, tabs, nav items, badges, table headers within Czech +20 % or 20 characters. Page titles ≤ 40 characters before „ | Deskohub Workspace“, meta descriptions ≤ 155, customer email subjects ≤ 60, mobile strings within the Czech length. Shorten by dropping objects and possessives first („Code kopieren“), then by choosing the shorter glossary form (Karte for Zahlungskarte, Update, Meetingraum), never by inventing an abbreviation.

## Watch keys

Customer catalog (`features/i18n/messages/cs-CZ.json`) unless an area is named.

| Key(s) | Risk | Rule |
|---|---|---|
| `checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton` | Legal button wording (R05), longer than budget | Both keys „Zahlungspflichtig bestellen“, no `{amount}`. Check that the layout fits; flag it if it wraps. |
| `checkoutPayConsent`, `checkoutPaymentRetryConsent` | First-person declaration: express request for early performance plus the acknowledgement that the withdrawal right expires after full performance (not a blanket waiver); two consent words (G01) | First person: „Ich stimme <terms>den Allgemeinen Geschäftsbedingungen</terms> und <operatingRules>der Hausordnung</operatingRules> zu.“ The `<earlyPerformance>` part must keep both elements of the waiver: the express request („verlange ich ausdrücklich, dass die Leistung zum reservierten Termin erbracht wird“) and the acknowledgement („und nehme zur Kenntnis, dass mein Widerrufsrecht mit vollständiger Erbringung der Leistung erlischt“). Use Widerrufsfrist (L17). Needs legal review. Retry variant starts „Ich bestätige erneut, dass ich … zustimme“. |
| `accountHelpBody` + `accountHelpContact` | `{contact}` is a linked imperative clause | „Wenn du Hilfe mit deinem Konto oder deinen Reservierungen brauchst, {contact}.“ with `accountHelpContact` „kontaktiere uns“ (lowercase). Translate both keys together. |
| `checkoutSummaryItemMeetingRoom`, `pricingMeetingRoomProduct`, `accountReferralsHowCompound`, `reservationValidationMeetingRoomDuration` | `{duration}` / `{durations}` hold already-formatted phrases („2 Stunden“) | Keep them in case-neutral slots: after a dash or comma, or after „Dauer:“/„eine der folgenden Optionen:“. No article in front. |
| `reservationAvailabilityUnavailable` | `{tier}` would need a genitive („Rezervace nabídky {tier}“) | „Deine Reservierung für {tier} ist am {date} nicht verfügbar …“; „sestavu monitorů“ = Monitor-Setup. |
| `accountReservationBookedBy`, `accountReservationBookedFor` | Gender-marked source | „Reserviert von {name}“, „Für {name}“. |
| `accountProfileScreenMemberFallback` | Generic masculine source | „Workspace-Mitglied“. |
| `accountReferralsCopyCode`, `accountReferralsCopyLink`, `accountBillingAddPaymentCard`, `accountSecurityPasskeysAdd`, `checkoutEmailCustomerAccessButton`, `accountReservationShowPinCode` | Long compounds on buttons | „Code kopieren“, „Link kopieren“, „Karte hinzufügen“, „Passkey hinzufügen“, „Zugangscode anzeigen“, „PIN anzeigen“. |
| `accountReferralsNavigationBadgeLabel` | Badge with `{discount}` and a long compound | „{discount} Empfehlungsrabatt“; stays within the badge budget. |
| `accountPasskeyPromptPointStorage`, `accountSecurityPasskeyDefaultName`, `accountSignInPasskey` | Czech shortens to „klíč“ | Always „Passkey“: „Dein Passwortmanager oder dieses Gerät speichert den Passkey.“, default name „Passkey“, „Mit Passkey anmelden“. |
| `reservationSignInPrompt`, `accountPasskeyPromptTitle` | Separable verb inside a rich tag; du restructuring | „Du hast schon ein Konto bei uns? <signIn>Melde dich an</signIn>“; „Melde dich nächstes Mal schneller an“. |
| `faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales` | Visitor addresses the venue (vy) | „Habt ihr …?“ or „Gibt es …?“, never „Haben Sie“ or „du“. |
| `checkoutStatusLatePaymentReviewContactMessage`, `checkoutStatusFulfillmentFailedContactMessage`, `checkoutStatusPaymentPendingContactMessage` | Customer's own email to the venue; `{reservationDetails}` block | „Guten Tag,“ + Sie towards the venue; Reservierungsfrist for blokace (K25); keep line breaks and the placeholder on its own line as in Czech. |
| `pricingIntro` | Hand-written currency | „Preise in CZK für alles, was du online reservieren kannst.“ |
| `invoiceNonVatPayerStatement`, `footerVatStatus` | Statutory VAT statement | K19 wording; never Kleinunternehmer. |
| `reservationBillingCompanyIdLabel`, `reservationBillingVatIdLabel`, `accountAresLookupInvalidIco`; `accounting:accountingInvoiceFormCompanyId`, `accounting:accountingInvoiceFormVatId` | IČO/DIČ labels (K20, K21) | „Firmennummer (IČO)“, „USt-IdNr. (optional)“; ARES errors keep „IČO“. |
| `reservationTierPerkProSetup`, `reservationTierPerkFreeCoffee`, `reservationTierBasicPerkWifi`, `reservationTierPerkAllBasic` | Lowercase Czech perks; tier name in perk copy | Capitalise nouns („Profi-Setup“, „Kaffee gratis“, „WLAN“); „Basic“ stays verbatim and uncompounded. |
| `landingOfferingEvents`, `landingSaleBanner*` | akce = event vs sale | Events: Veranstaltungen. Banners: „{title}: <discount>{adjustment}</discount> Rabatt auf …“ (D01). |
| `aiAssistantsChatGptStepFind` | Third-party UI label that may have changed | Pattern `Öffne in ChatGPT „<label>“ und suche nach „Deskohub Workspace“.` with ChatGPT's live German label (I03). |
| `accountMagicLinkEmailSubject` | Email subject length, brand without genitive | „Dein Anmeldelink für Deskohub Workspace“ (≤ 60). |
| `accountSectionMetadataTitle` | Title pattern | „{section} \| Mein Konto \| Deskohub Workspace“ (keep the separators). |
| Plural keys: `accountReferralsHowBenchmark`, `reservationMeetingRoomDurationHours`, `reservationOfficeBasePriceLabel`, `reservationOfficeSeatCountOption`, `checkoutSummaryItemOfficeAccess`, `checkoutSummaryItemOfficeSeatCount`, `checkoutSummaryItemOfficeDayCount`, `reservationValidationOfficeMaximumDuration`, `accountReservationSeats`, `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange`; admin `administration:administrationCustomerTableReservationCount` and the other `countPlural` keys | German needs `one` + `other` only; drop Czech `few` | `accountReferralsHowBenchmark` needs different German forms although all three Czech variants are identical (Empfehlung/Empfehlungen). Seat counts: Platz/Plätze; days Tag/Tage; reservations Reservierung/Reservierungen. |
| `discounts:discountsSalesTitle`, `administration:administrationTableActions` | Same Czech word „Akce“ | „Rabattaktionen“ vs „Aktionen“. |
| `administration:administrationBookingDetailTitle` and other `administrationBooking*` | Dotypos booking vs reservation | Buchung / Tischbuchung only. |
| `administration:administrationProviderOperationType*` | Void vs cancellation | Autorisierung, Belastung, Erstattung, Rücknahme, Autorisierungsstorno (A11, A12). |
| `administrators:administratorsGrantTitle`, `administrators:administratorsGrantSubmit`, `administrators:administratorsRevokeConfirm` | Generic masculine person noun | Build around the role: „Administratorrolle vergeben“, „Rolle vergeben“, „Rolle entziehen“. |
| `email-campaigns:emailCampaignsAudienceDotyposTagsLabel` | Inflected brand in Czech | „Tags in Dotypos“. |
| `email-automation-activation:emailAutomationActivationNextFiresTitle`, `email-automation-flow:emailAutomationFlowPeriodTriggerWindowCountLabel` | fire vs run vs trigger | Ausführung / Durchlauf / Auslöser; keep `{subject}:` at the start. |
| `admin-cli:adminCliAuthenticateClientLabel`, `admin-cli:adminCliAuthenticateApprovingAs` | Klient = software client; self-closing tag | „Client“; „Sie genehmigen als <email/>.“ |
| Mobile `signin_returning_to_app`, `home_signed_in_as`, `update_ready`, `update_ready_restart` | Small screens, du | „Du wirst zur App zurückgeleitet.“, „Angemeldet als {email}“, „Ein App-Update ist bereit. Starte die App neu, um es zu nutzen.“ (shorten if it exceeds the Czech length), „Neu starten“. |
| `contactPhonePlaceholder`, `contactEmailPlaceholder`, `accountSignInEmailPlaceholder` | Example data | +49 151 00000000; max@example.com. |
