# Deskohub Workspace term list

The concept list behind the locale glossaries. Each concept has a stable ID (P01, R05, A09…). [de-DE.md](de-DE.md), [uk-UA.md](uk-UA.md) and [sk-SK.md](sk-SK.md) give the target term for every ID, and [style-guide.md](style-guide.md) sets the shared rules. A new term gets the next free ID in its section and a row in every locale glossary.

Columns:

- **Surface**: C = customer site, account, checkout and customer emails; A = administration; L = legal documents; M = mobile app.
- **Czech**: the source wording; **English**: the `en-US` cross-check.
- **Source key**: one message key that uses the term, to find it in context. `cust:` = customer catalog (`apps/deskohub-workspace/features/i18n/messages/`); `mob:` = mobile catalog (`apps/deskohub-mobile/messages/`); an administration namespace (`administration:`, `discounts:`, `email-campaigns:`…) = `apps/deskohub-workspace/features/administration/i18n/messages/<namespace>/`; `legal` = the Czech legal documents (`apps/deskohub-workspace/features/legal/locales/cs-CZ/`).

## P: Products and spaces

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| P01 | C | coworking | coworking | `cust:landingMetadataTitle` | Generic product family and venue type. Czech inflects it (coworkingu). |
| P02 | C | cowork | cowork | `cust:landingHeroPrimaryCta` | Short form used in CTAs ("Rezervovat cowork"). Same concept as coworking: a cowork day spot. |
| P03 | C | open space / otevřený prostor | open space | `cust:reservationOpenSpaceDescription` | Shared open-plan area. Czech also writes "Open-space místo" (reservationTierBasicBulletDesk). |
| P04 | C | zasedací místnost | meeting room | `cust:meetingRoomMetadataTitle` | Formal product name of the meeting room. |
| P05 | C | zasedačka | meeting room (colloquial) | `cust:landingHeroMeetingRoomCta` | Colloquial everyday word in customer copy and CTAs. Target should use the normal everyday word, not a slangier one. |
| P06 | C | kancelář | office | `cust:landingMetadataDescription` | Office product (days in a private office). |
| P07 | C | soukromá kancelář | private office | `cust:landingNavPrivateOffice` | Navigation label and product name. |
| P08 | C | pracovní stanice | workstation | `cust:reservationTierProfiDescription` | A desk with monitor setup (Profi tier). |
| P09 | C | vyhrazené místo | reserved desk | `cust:reservationReservedDeskTitle` | A desk kept for you for the day. English says "reserved desk". |
| P10 | C | stůl | desk / table | `cust:aiAssistantsChatGptStepAsk` | Desk in cowork; also the Dotypos "table" behind admin bookings. |
| P11 | C | místo | spot / seat / desk | `cust:accountReservationSeatsLabel` | The bookable unit in cowork ("místo" = a place to sit). Count noun in plurals. |
| P12 | C | místnost | room | `cust:reservationTierMeetingRoomDescription` | Generic room. |
| P13 | C | prostor / pracovní prostor | space / workspace (generic) | `cust:workspaceDescription` | Generic "work space". Do not confuse with the brand Workspace. |
| P14 | C | TTRPG místnost | TTRPG room | `cust:ttrpgRoomMetadataTitle` | Room for tabletop role-playing games. TTRPG stays as the acronym. |
| P15 | C | kampaň (TTRPG) | campaign (role-playing) | `cust:ttrpgRoomMetadataDescription` | In customer copy "kampaň" is a role-playing campaign, not marketing. See A23 for email campaigns. |
| P16 | C | one-shot | one-shot | `cust:ttrpgRoomMetadataDescription` | TTRPG jargon, kept as the English loan. |
| P17 | C | bar | bar | `cust:ttrpgRoomHeroLead` | The Deskohub board-game bar next door. |
| P18 | C | provozovna | venue / premises | `cust:footerCompanyAddressLabel` | Business premises (legal/footer sense). |
| P19 | C | nabídka | offering / options | `cust:reservationTierLabel` | Label over the tier picker; also "what we offer". |
| P20 | C | tarif | tier / plan | `cust:reservationTierPerkAllBasic` | Product tier (Basic, Cowork Plus, Profi). Legal "Tarif" is the defined term L10. |
| P21 | C | výhody | perks | `cust:reservationTierPerksLabel` | Tier perk list label. |
| P22 | C | Basic Day Pass | Basic Day Pass | `cust:reservationTierBasicTitle` | Product name. Do not translate. Also "Basic" alone in perk copy. |
| P23 | C | Cowork Plus | Cowork Plus | `cust:reservationTierCoworkTitle` | Product name. Do not translate. |
| P24 | C | Profi Workstation | Profi Workstation | `cust:reservationTierProfiTitle` | Product name. Do not translate. |
| P25 | C | monitorový setup | monitor setup | `cust:reservationTierProfiDescription` | Czech uses the loan "setup"; "profi setup" in reservationTierPerkProSetup. |
| P26 | C | batch brew káva | batch brew coffee | `cust:reservationTierCoworkDescription` | Specialty filter coffee. "batch brew" stays as the loan. |
| P27 | C | káva zdarma | free coffee | `cust:reservationTierPerkFreeCoffee` | Perk. |
| P28 | C | Wi-Fi | Wi-Fi | `cust:reservationTierBasicPerkWifi` | Spelled Wi-Fi. |
| P29 | C | monitor | monitor | `cust:reservationTierProfiBulletDesk` | Workstation accessory. |
| P30 | C | člen Workspace | Workspace member | `cust:accountProfileScreenMemberFallback` | Fallback display name. Czech is grammatically masculine: needs a gender-neutral target. |
| P31 | C | Deskohub Workspace | Deskohub Workspace | `cust:workspaceTitle` | Full brand name. Never translated or inflected. |
| P32 | C | Workspace | Workspace | `cust:accountReferralsDiscountInfo` | Short brand name, uninflected in Czech ("ve Workspace"). |
| P33 | C | Deskohub | Deskohub | `cust:marketingPreferencesFormRowDescription` | Brand. Czech inflects it (Deskohubu, Deskohubem). |

## R: Reservation

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| R01 | C | rezervace | reservation | `cust:accountSectionReservations` | Core noun (223 uses). Customer UI and admin use "reservation"; legal English says "Booking" (L13). |
| R02 | C | rezervovat | book / reserve | `cust:landingHeroPrimaryCta` | CTA verb. English uses "Book". |
| R03 | C | rezervační | booking (adj.) | `cust:reservationSuccessMessage` | Adjective form ("rezervační odkaz", "rezervační formulář"). |
| R04 | C | objednávka | order | `cust:invoiceEmailBody` | The paid order behind a reservation; order ID in support copy. |
| R05 | C | objednat a zaplatit | order and pay | `cust:checkoutPayOrderAndPayButton` | Legally required final checkout button (button solution). Must state the payment obligation. |
| R06 | C | poptávka | inquiry | `cust:landingFooterContactTitle` | Contact-form request for offices/events. |
| R07 | C | termín | date / time slot | `cust:aiAssistantsCapabilityQuote` | A date or slot, not "deadline". |
| R08 | C | datum | date | `cust:accountReservationDate` | Label. |
| R09 | C | začátek | start | `cust:reservationMeetingRoomStartLabel` | Start time label. |
| R10 | C | konec | end | `access-codes:accessCodesEndsLabel` | End time label (admin and customer). |
| R11 | C | délka | duration | `cust:reservationMeetingRoomDurationLabel` | Duration of a meeting-room booking. |
| R12 | C | hodina | hour | `cust:meetingRoomBookingText` | Count noun in plurals (reservationMeetingRoomDurationHours). |
| R13 | C | den | day | `cust:reservationOfficeBasePriceLabel` | Count noun in plurals (dayCount). |
| R14 | C | dostupnost | availability | `cust:reservationAvailabilityError` | Availability check. |
| R15 | C | volný / volno | available / free | `cust:aiAssistantsCapabilityAvailability` | Available slot. Do not render as "free of charge". |
| R16 | C | obsazeno | booked / taken | `cust:bookingWidgetNotAvailable` | Unavailable slot. |
| R17 | C | potvrzení | confirmation | `cust:landingUiHeroFlowStepTwoText` | Booking confirmation (email) and the act of confirming. |
| R18 | C | zrušení / zrušit | cancellation / cancel | `cust:checkoutStatusCancelledTitle` | Reservation or payment cancelled. |
| R19 | C | změna | change | `cust:reservationSelectionChange` | Change of selection or price. |
| R20 | C | Rezervoval(a) {name} | Booked by {name} | `cust:accountReservationBookedBy` | Gender-marked for the named person. Targets must avoid gender marking. |
| R21 | C | přiřazené místo | assigned desk | `cust:accountReservationAssignedDesk` | Seat assigned by staff. |
| R22 | C | platnost / platí | validity / is valid | `cust:marketingPreferencesFormInvalidLinkDescription` | Validity of links, codes and discounts. |
| R23 | C | vypršet | expire | `cust:checkoutPayInvalidStateTitle` | Link or code expired. |

## K: Payment and billing

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| K01 | C | platba | payment | `cust:aiAssistantsPaymentHeading` | Checkout payment. |
| K02 | C | zaplatit | pay | `cust:faqAnswerHowItWorks` | Verb. |
| K03 | C | zaplaceno | paid | `cust:reservationAlreadyPaidMessage` | Status. |
| K04 | C | platební karta / karta | payment card | `cust:accountBillingAddPaymentCard` | Saved card. |
| K05 | C | platební metoda | payment method | `cust:accountBillingPaymentMethodsTitle` | Billing settings. |
| K06 | C | platební brána | payment gateway | `cust:checkoutStatusPendingLead` | Nexi hosted payment page. |
| K07 | C | platební odkaz | payment link | `cust:checkoutPayInvalidStateTitle` | Link to pay later. |
| K08 | C | Nexi | Nexi | `cust:checkoutPayProviderHandoff` | Payment provider brand. Never inflect in targets. |
| K09 | C | cena | price | `cust:aiAssistantsCapabilityQuote` | Price, not "cost". |
| K10 | C | základní cena | base price | `cust:accountReferralsDiscountInfo` | Price before discounts. |
| K11 | C | ceník | price list | `cust:pricingPageTitle` | Pricing page. Legal defined term "Ceník" in L11. |
| K12 | C | částka | amount | `cust:invoiceAmountLabel` | Invoice/payment amount. |
| K13 | C | celkem | total | `cust:invoiceTotalPaidLabel` | Total. |
| K14 | C | měna | currency | `cust:accountBillingCurrency` | Always CZK. |
| K15 | C | Kč | CZK | `cust:pricingIntro` | Currency symbol written in prose. Prefer formatted {price} placeholders; in prose keep CZK in the locale's form (see style guide). |
| K16 | C | faktura | invoice | `cust:invoiceTitle` | Tax document. Workspace issues invoices, not receipts. |
| K17 | C | fakturační údaje | billing details | `cust:accountBillingDetailsTitle` | Billing name/company/address block. |
| K18 | C | DPH | VAT | `cust:footerVatStatus` | Czech VAT. Keep the Czech legal fact; render with the target's VAT abbreviation. |
| K19 | C | neplátce DPH | not a VAT payer | `cust:invoiceNonVatPayerStatement` | Statutory invoice statement: the company is not VAT-registered. |
| K20 | C | IČO | company ID number | `cust:reservationBillingCompanyIdLabel` | Czech company registration number. Label may be localised; the value never. |
| K21 | C | DIČ | VAT ID | `cust:reservationBillingVatIdLabel` | Tax ID label. |
| K22 | C | firma / společnost | company | `cust:contactCompanyLabel` | Company field. Czech mixes firma (everyday) and společnost (formal). |
| K23 | C | PSČ | postal code | `cust:reservationBillingPostalCodeLabel` | Address field label. |
| K24 | C | ulice | street | `cust:accountProfileAddressLine1Label` | Address field label. |
| K25 | C | platba po vypršení blokace rezervace | payment after the reservation hold expired | `cust:checkoutStatusLatePaymentReviewContactMessage` | Late payment case. 'blokace rezervace' = the temporary reservation hold during checkout. The message is a pre-filled support email the customer sends (first person, polite 'Dobrý den'), so it uses the customer's formal voice towards the venue. |

## D: Discounts and referrals

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| D01 | C | sleva | discount | `cust:accountReferralsDiscountTitle` | Generic discount. |
| D02 | C | slevový kód | discount code | `cust:emailContentOfferCodeLabel` | Code typed at checkout. |
| D03 | C | kód | code | `cust:accountReferralsCodeLabel` | Generic code (referral, sign-in, discount). |
| D04 | C | poukaz | voucher | `cust:checkoutVoucherLabel` | Prepaid or promotional voucher. Not "gift card" unless the Czech says dárkový. |
| D05 | C | Sleva, poukaz nebo doporučovací kód | Discount, voucher or referral code | `cust:checkoutDiscountCodeLabel` | Checkout input label; the three concepts must stay distinct. |
| D06 | C | akce (sale) | sale / promotion | `cust:landingSaleBannerAllMeetingRoomProducts` | Time-limited price promotion. Czech "akce" is ambiguous: see D07, A07. |
| D07 | C | akce (event) | event | `cust:landingOfferingEvents` | Company events and workshops in the space. |
| D08 | C | doporučení | referral | `cust:accountSectionReferrals` | Referral programme section. |
| D09 | C | doporučovací kód | referral code | `cust:accountReferralsCodeLabel` | Referral code. |
| D10 | C | doporučovací odkaz | referral link | `cust:accountReferralsLinkLabel` | Referral link. |
| D11 | C | první rezervace | first reservation | `cust:accountReferralsHowInvite` | Referral eligibility condition. |

## U: Account and sign-in

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| U01 | C | účet | account | `cust:accountNavigationLabel` | Customer account. |
| U02 | C | profil | profile | `cust:accountSectionProfile` | Account profile section. |
| U03 | C | přihlásit se / přihlášení | sign in / sign-in | `cust:accountSignInPasskey` | Use "sign in", never "log in" equivalents that differ from the chosen term. |
| U04 | C | odhlásit se | sign out | `cust:accountSignOut` | Sign out. |
| U05 | C | přihlašovací odkaz | sign-in link | `cust:accountMagicLinkEmailSubject` | Magic link. Never call it "magic link" in customer copy. |
| U06 | C | přihlašovací kód | sign-in code | `cust:accountSignInCodeBody` | One-time code by email. |
| U07 | C | přístupový klíč | passkey | `cust:accountSignInPasskey` | WebAuthn passkey. Use the OS vendors' term in the target language (see locale files). Must not collide with access code (A01). |
| U08 | C | správce hesel | password manager | `cust:accountPasskeyPromptPointStorage` | Where passkeys are stored. |
| U09 | C | heslo | password | `cust:accountSignInPasswordTitle` | Password (Wi-Fi password and auth). |
| U10 | C | relace | session | `cust:accountDeletionDescription` | Signed-in session. |
| U11 | C | zařízení | device | `cust:accountPasskeyPromptPointStorage` | Phone or computer. |
| U12 | C | prohlížeč | browser | `cust:accountReferralsCopyUnavailable` | Web browser. |
| U13 | C | ověření / ověřit | verification / verify | `cust:reservationAccountSupportTitle` | Email verification. |
| U14 | C | e-mail | email | `cust:landingAccessStepEmail` | Czech spells e-mail; targets use their standard spelling. |
| U15 | C | zákaznický účet | customer account | `cust:accountDeletedMetadataDescription` | Account after deletion/reactivation. |
| U16 | C | zákazník | customer | `cust:legalScreenMarketingDescription` | Customer (UI). Legal documents use Klient (L03) instead. |
| U17 | C | telefon | phone | `cust:contactPhoneLabel` | Phone field. |

## X: Access and venue

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| X01 | C | přístupový kód | access code | `cust:checkoutEmailCustomerAccessButton` | The door code issued for a reservation. Distinct from passkey (U07). |
| X02 | C | PIN / PIN kód | PIN / PIN code | `cust:accountReservationShowPinCode` | The keypad PIN. Keep "PIN". |
| X03 | C | dveře | door | `cust:landingUiHeroFlowStepThreeText` | Entrance door. |
| X04 | C | klávesnice | keypad | `cust:landingAccessStepKeypad` | Door keypad, not a computer keyboard. |
| X05 | C | vstup | entry / entrance | `cust:landingUiHeroFlowTitle` | Getting in; also a door entry. |
| X06 | C | přístup | access | `cust:aiAssistantsDataBody` | Generic access (data, door, account). |
| X07 | C | otevírací doba | opening hours | `cust:pricingOpeningHoursTitle` | Hours. |
| X08 | C | otevřeno nonstop | open 24/7 | `cust:workspaceMetadataAlwaysOpen` | Always open. |
| X09 | C | adresa provozovny | venue address | `cust:footerCompanyAddressLabel` | Footer label. |
| X10 | C | Palmovka | Palmovka | `cust:workspaceDescription` | Neighbourhood and metro station. Name stays; Czech inflects it (na Palmovce). |
| X11 | C | Praha | Prague | `cust:landingMetadataTitle` | City. Use the target's exonym in prose; keep Czech in postal addresses. |
| X12 | C | Libeň | Libeň | `cust:landingLocationTransport` | District name. Never translate; Ukrainian writes it in Cyrillic in prose (uk-UA.md X10). |
| X13 | C | metro | metro | `cust:landingFaqItemTwoAnswer` | Prague metro. |
| X14 | C | Google Maps | Google Maps | `cust:landingLocationMapCta` | Brand. |
| X15 | C | kontakt | contact | `cust:landingNavContactLabel` | Nav label. |

## G: Consent and privacy

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| G01 | C | souhlas | consent | `cust:legalScreenMarketingDescription` | Consent (marketing, cookies, documents). |
| G02 | C | marketingový souhlas | marketing consent | `cust:legalScreenMarketingTitle` | Consent to marketing messages. |
| G03 | C | marketingová sdělení | marketing messages | `cust:legalScreenMarketingDescription` | What the consent covers. |
| G04 | C | cookies | cookies | `cust:legalScreenPreferencesUnavailable` | Czech keeps the English plural. |
| G05 | C | nezbytné cookies | necessary cookies | `cust:cookieConsentPreferencesNecessaryTitle` | Cookie category. |
| G06 | C | analytické a marketingové cookies | analytics and marketing cookies | `cust:legalScreenAnalyticsDescription` | Cookie categories. |
| G07 | C | nastavení cookies | cookie settings | `cust:footerCookieSettingsLink` | Footer link. |
| G08 | C | osobní údaje | personal data | `cust:footerPrivacyLink` | GDPR term. |
| G09 | C | soukromí | privacy | `cust:accountLegalTitle` | Privacy section. |

## S: Status and errors

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| S01 | C | stav | status | `cust:accountReservationStatus` | Status label. |
| S02 | C | čeká | pending | `cust:checkoutStatusPendingLead` | Waiting status. |
| S03 | C | potvrzeno | confirmed | `cust:checkoutStatusPaidAwaitingDeliveryTitle` | Status. |
| S04 | C | zkusit znovu | try again | `cust:errorPageRetry` | Retry CTA (infinitive in Czech). |
| S05 | C | nepodařilo se | could not | `cust:reservationAvailabilityError` | Error lead-in. |
| S06 | C | načítání / načíst | loading / load | `cust:reservationMeetingRoomStartTimesLoading` | Loading. |
| S07 | C | podpora | support | `cust:checkoutStatusPaymentPendingDelayedLead` | Customer support. |
| S08 | C | pomoc | help | `cust:accountHelpTitle` | Help. |
| S09 | C | neplatný | invalid | `cust:agentToolErrorInvalidInput` | Invalid input. |

## I: AI assistants

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| I01 | C | AI asistent | AI assistant | `cust:aiAssistantsMetadataTitle` | Czech never says "AI agent" in UI. Keep "assistant". |
| I02 | C | konektor | connector | `cust:aiAssistantsCustomConnectorHeading` | Claude custom connector. |
| I03 | C | aplikace (ChatGPT) | app (ChatGPT Apps) | `cust:aiAssistantsChatGptStepFind` | Name of ChatGPT's menu; use ChatGPT's own UI label in the target language. |
| I04 | C | ChatGPT / Claude | ChatGPT / Claude | `cust:aiAssistantsChatGptStepFind` | Third-party product names. |
| I05 | C | MCP | MCP | `cust:aiAssistantsCustomConnectorIntro` | Protocol acronym. |

## M: Mobile app

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| M01 | M | aktualizace | update | `mob:update_ready` | Mobile app update. |
| M02 | M | restartovat | restart | `mob:update_ready_restart` | Restart the app. |
| M03 | M | vrátit se do aplikace | return to the app | `mob:signin_returning_to_app` | Browser-to-app handoff. |

## A: Administration

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| A01 | A | přístupový kód | access code | `access-codes:accessCodesResultName` | Staff-created door code. Same term as X01. |
| A02 | A | administrace | administration | `shell:shellNavigationLabel` | The staff area. |
| A03 | A | administrátor | administrator | `administrators:administratorsGrantTitle` | Staff role. Czech masculine generic; prefer neutral forms in targets. |
| A04 | A | role administrátora | administrator role | `administrators:administratorsGrantSubmit` | Grant / revoke. |
| A05 | A | udělit / odebrat roli | grant / revoke role | `administrators:administratorsRevokeConfirm` | Role actions. |
| A06 | A | zákazník | customer | `administration:administrationCustomerDetailUnavailableTitle` | Staff term for the person (242 uses). |
| A07 | A | akce (actions) | actions | `administration:administrationTableActions` | Table actions column header. Not a sale. |
| A08 | A | akce (sale) | sale | `discounts:discountsSalesTitle` | Discount promotion area. Same Czech word as A07. |
| A09 | A | rezervace stolu | booking (Dotypos) | `administration:administrationBookingDetailTitle` | Dotypos table booking behind a reservation. English distinguishes "booking" from "reservation"; keep the distinction. |
| A10 | A | objednávky | orders | `administration:administrationOrderListTitle` | Payment orders. |
| A11 | A | operace | operations | `administration:administrationOrderOperationsTitle` | Nexi payment operations. |
| A12 | A | storno | void | `administration:administrationProviderOperationTypeVoid` | Payment-provider void operation, not a reservation cancellation. |
| A13 | A | platba nedokončena | payment abandoned | `administration:administrationPaymentTimelineAbandonedTitle` | Timeline event. |
| A14 | A | aktivita rezervací | reservation activity | `administration:administrationReservationActivityTitle` | Calendar heatmap. |
| A15 | A | přístup ke dveřím | door access | `administration:administrationReservationAccessTitle` | Section heading. |
| A16 | A | filtry | filters | `administration:administrationFilterApply` | Table filters. |
| A17 | A | stránkování | pagination | `administration:administrationPaginationLabel` | Pagination landmark. |
| A18 | A | drobečková navigace | breadcrumb | `shell:shellBreadcrumbLabel` | Breadcrumb landmark. |
| A19 | A | export | export | `administration:administrationListExportFailed` | CSV export. |
| A20 | A | odběratel | customer (invoice) | `accounting:accountingInvoiceFormCustomerHeading` | Invoice recipient party (statutory invoice term). |
| A21 | A | položky | line items | `accounting:accountingInvoiceFormLinesHeading` | Invoice lines. |
| A22 | A | datum splatnosti / po splatnosti / k úhradě | due date / overdue / due | `accounting:accountingInvoiceDetailDueDate` | Invoice payment terms. |
| A23 | A | variabilní symbol | variable symbol | `accounting:accountingInvoiceFormVariableSymbol` | Czech bank payment reference. Keep the Czech concept; explain in target. |
| A24 | A | kampaň | campaign | `email-campaigns:emailCampaignsSendConfirmSubmit` | Email campaign. |
| A25 | A | okruh příjemců | audience | `email-campaigns:emailCampaignsAudienceEditorSave` | Segment of customers a campaign targets. |
| A26 | A | uložené publikum | saved audience | `email-automation-flow:emailAutomationFlowSavedAudienceMenuLabel` | Czech uses a second word (publikum) for the same concept; targets should use one word for both. |
| A27 | A | příjemce | recipient | `email-campaigns:emailCampaignsAudienceArchiveConfirm` | Email recipient. |
| A28 | A | automatizace / automatická kampaň | automation / automated campaign | `email-automations:emailAutomationsSectionsLabel` | Triggered email flow. |
| A29 | A | zkušební běh | dry run | `email-automation-activation:emailAutomationActivationPanelTitle` | Preview of who would be emailed. |
| A30 | A | běh | run | `email-automation-runs:emailAutomationRunsCountsTitle` | One customer's pass through an automation. |
| A31 | A | spuštění | fire (scheduled start) | `email-automation-activation:emailAutomationActivationNextFiresTitle` | Scheduled firing time. |
| A32 | A | spouštěcí událost | trigger | `email-automation-flow:emailAutomationFlowPeriodTriggerWindowCountLabel` | Event that starts a run. |
| A33 | A | krok | step | `email-automation-flow:emailAutomationFlowInsertLabel` | Automation step. |
| A34 | A | podmínka | condition | `email-campaigns:emailCampaignsAudienceDateConditionLabel` | Audience rule. |
| A35 | A | vlastnost zákazníka | customer attribute | `email-campaigns:emailCampaignsAudienceConditionAttributeLabel` | Audience rule input. |
| A36 | A | slevová skupina | discount group | `email-campaigns:emailCampaignsAudienceDiscountGroupLabel` | Dotypos discount group. |
| A37 | A | štítky v Dotyposu | Dotypos tags | `email-campaigns:emailCampaignsAudienceDotyposTagsLabel` | Czech inflects Dotypos; whether a target inflects it is set in the locale file (style guide §4). |
| A38 | A | potvrzovací kód | confirmation code | `email-campaigns:emailCampaignsSendConfirmCodeLabel` | Typed to confirm a send. |
| A39 | A | předmět | subject | `emails:emailsEditorSubjectLabel` | Email subject line. |
| A40 | A | text náhledu | preheader | `emails:emailsEditorPreheaderLabel` | Email preheader. |
| A41 | A | šablona | template | `emails:emailsEditorTemplateLabel` | Email template. |
| A42 | A | účel | purpose | `emails:emailsEditorPurposeLabel` | Marketing vs operational purpose. |
| A43 | A | překlad | translation | `emails:emailsEditorTranslationHeading` | Per-language email copy. |
| A44 | A | zveřejnění | publishing | `emails:emailsEditorProblemsHeading` | Publishing an email. |
| A45 | A | archivovat | archive | `email-campaigns:emailCampaignsAudienceArchiveConfirm` | Archive. |
| A46 | A | smazat | delete | `email-campaigns:emailCampaignsAudienceDeleteConfirm` | Delete (permanent). |
| A47 | A | relace CLI | CLI session | `admin-cli:adminCliSessionsTitle` | Signed-in dhw CLI session. |
| A48 | A | schválit | approve | `admin-cli:adminCliApprovalFormSubmit` | Approve a CLI sign-in. |
| A49 | A | odvolat | revoke | `admin-cli:adminCliRevokeTitle` | Revoke a session. |
| A50 | A | klient (CLI) | client | `admin-cli:adminCliAuthenticateClientLabel` | Software client. Not the legal party Klient (L03). |
| A51 | A | sestavení | build | `admin-cli:adminCliAuthenticateBuildLabel` | CLI build version. |
| A52 | A | zrušit | cancel | `admin-cli:adminCliRenameCancel` | Cancel button (dialogs). |
| A53 | A | uložit / vytvořit | save / create | `discounts:discountsCodeSave` | Form buttons. |
| A54 | A | další / předchozí | next / previous | `administration:administrationPaginationNext` | Pagination. |
| A55 | A | název / jméno / příjmení | name / first name / last name | `accounting:accountingInvoiceFormLastName` | Name fields. "Název" for things, "jméno" for people. |
| A56 | A | nepovinné | optional | `accounting:accountingInvoiceFormVatId` | Field suffix. |
| A57 | A | propagační poukaz | promotional voucher | `discounts:discountsVouchersPageTitle` | Admin voucher area. |

## L: Legal documents

| ID | Surface | Czech | English | Source key | Note |
|---|---|---|---|---|---|
| L01 | L | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | legal | Document title and defined abbreviation. |
| L02 | L | Poskytovatel | Provider | legal | Defined party (the company) in the GTC. Capitalised as defined term. |
| L03 | L | Klient | Client | legal | Defined party (the customer) in the GTC. |
| L04 | L | Spotřebitel | Consumer | legal | Statutory consumer. |
| L05 | L | Smlouva | Contract | legal | Contract. |
| L06 | L | Prostory | Premises | legal | Defined term. |
| L07 | L | Služby | Services | legal | Defined term. |
| L08 | L | Sdílený pracovní prostor | shared workspace | legal | Descriptive definition. |
| L09 | L | Provozní řád | House Rules | legal | Document title and defined term. |
| L10 | L | Tarif | Tariff | legal | Defined term. |
| L11 | L | Ceník | Price List | legal | Defined term. |
| L12 | L | Přístupový PIN kód | Access PIN Code | legal | Defined term. |
| L13 | L | Rezervace | Booking | legal | Defined term. The legal English says Booking; targets use the same word as customer UI R01, capitalised where the language allows. |
| L14 | L | Provozovatel | Operator | legal | Defined party in the House Rules. |
| L15 | L | Uživatel | User | legal | Defined term in the House Rules. |
| L16 | L | Storno Rezervace | Booking Cancellation | legal | GTC §8 heading. |
| L17 | L | odstoupení od smlouvy | withdrawal from the contract | legal | Consumer right of withdrawal. |
| L18 | L | vady a reklamace | defects and complaints | legal | GTC §12. |
| L19 | L | mimosoudní řešení spotřebitelských sporů | alternative consumer dispute resolution | legal | GTC §13. |
| L20 | L | Občanský zákoník / zákon č. 89/2012 Sb. | Civil Code / Act No. 89/2012 Coll. | legal | Czech statute. Keep the Czech citation; add the target's standard rendering. |
| L21 | L | obchodní rejstřík | Commercial Register | legal | Company registry. |
| L22 | L | Zásady ochrany osobních údajů | Privacy Policy | `cust:footerPrivacyLink` | Document title. |
| L23 | L | Správce osobních údajů | Controller | legal | GDPR controller. |
| L24 | L | zpracování osobních údajů | processing of personal data | legal | GDPR processing. |
| L25 | L | právní základ | legal basis | legal | Privacy §4 heading. |
| L26 | L | doba uchování | retention period | legal | Privacy §5 heading. |
| L27 | L | předávání mimo EU | transfers outside the EU | legal | Privacy §7 heading. |
| L28 | L | Souhlas s marketingovou komunikací | Marketing Communications Consent | legal | Document title. |
| L29 | L | odvolání souhlasu | withdrawal of consent | legal | Consent §4 heading. |
| L30 | L | Zásady používání cookies | Cookie Policy | `cust:footerCookiePolicyLink` | Document title. |
