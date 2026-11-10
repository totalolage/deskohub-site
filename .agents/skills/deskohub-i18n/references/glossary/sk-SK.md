# Slovak (sk-SK) glossary: Deskohub Workspace

Locale: **sk-SK**. Source: Czech (`cs-CZ`), cross-check: English (`en-US`). Every concept ID in [terms.md](terms.md) appears below at least once.

This file is binding for the sk-SK customer catalog, administration catalogs, legal documents and mobile catalog. The shared rules are in [style-guide.md](style-guide.md): sources and precedence, do-not-translate list, placeholders, plurals and length. Where the two differ, this file wins for Slovak.

Slovak readers understand Czech, so they will compare the copy against Czech they can already read. Copy that is Czech with diacritics swapped reads as careless. Write native Slovak: reorder, pick Slovak verbs and idioms, and check every word in the forbidden-alternatives column.

## Register

| Surface | Register | Examples |
|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | informal **ty** (*ty, tvoj, tebe, ti*), lowercase | *Môžeš si rezervovať…*, *Skús to znova.*, *tvoja rezervácia* |
| Three customer FAQ questions where the visitor addresses the venue (`faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales`) | **vy** (the visitor asks Deskohub) | *Máte súkromné kancelárie?*, *Máte zľavy?* |
| Pre-filled support emails the customer sends (`checkoutStatus*ContactMessage`) | customer's formal voice to the venue: *Dobrý deň,* + **vy** | *…rezerváciu musíte skontrolovať ručne.* |
| Administration (staff UI, staff emails) | formal **vy**, lowercase, plural imperatives | *Vyberte*, *Zadajte*, *Skúste to znova.* |
| Legal documents | formal **vy**, lowercase where the reader is addressed; mostly third person through defined terms | *Klient je povinný…* |

Buttons use the infinitive in every surface (*Uložiť*, *Zrušiť*, *Skúsiť znova*). An infinitive is not informal, so the same button text works in admin.

## Brand inflection rule

- **Deskohub** inflects as a masculine inanimate noun (pattern *dub*): *Deskohub, z Deskohubu, k Deskohubu, s Deskohubom, v Deskohube*. Czech inflects it too (`marketingPreferencesFormRowDescription` "povolíš Deskohubu"). An uninflected *povolíš Deskohub zasielať* is wrong Slovak.
- **Dotypos** inflects the same way: *v Dotypose, z Dotyposu, s Dotyposom* (`email-campaigns:emailCampaignsAudienceDotyposTagsLabel` → *Štítky v Dotypose*). Slovak, like Czech, inflects consonant-final brand names; style guide §4 leaves this to the locale file.
- **Deskohub Workspace**, **Workspace**, **Nexi** never inflect. Put the case on a generic noun or a preposition next to them: *vo Workspace*, *na platobnej stránke Nexi*, *cez Nexi*. Note *vo* (not *v*) before W, as before *v/f*: *vo Workspace*.
- **Deskohub Bar**: only *Bar* inflects (*v Deskohub Bare*, *z Deskohub Baru*).
- Tier names (**Basic Day Pass**, **Cowork Plus**, **Profi Workstation**, **Basic**) never inflect. Attach the case to *tarifa*: *všetky výhody tarify Basic*, *rezervácia tarify {tier}*.
- **Praha** is also the Slovak exonym but inflects in the Slovak way: *v Prahe* (never Czech *v Praze*), *Praha 8* in addresses. **Palmovka**: *na Palmovke* (Czech *na Palmovce*). **Libeň**: *v Libni*.

## Glossary

Columns: concept ID(s) | Czech | English | Slovak (gender: m./f./n., pl.) | Notes and forbidden alternatives. "✗" marks a forbidden form. Bohemisms are forms a Czech-speaking reviewer would let through without noticing.

### P: products and spaces

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| P01, P02 | coworking, cowork | coworking, cowork | **coworking** (m., gen. *coworkingu*, loc. *v coworkingu*; adj. *coworkingový*) | One concept, one word: Czech *cowork* in CTAs also becomes *coworking*: `landingHeroPrimaryCta` → *Rezervovať coworking*. ✗ *cowork* as a stand-alone noun, ✗ *coworkingové miesto* when the Czech just says cowork. Legal *coworkingové vstupy* → *coworkingové vstupy*. |
| P03 | open space / otevřený prostor | open space | **otvorený priestor** (m.); in compact labels **open space** | `reservationTierBasicBulletDesk` "Open-space místo" → *Miesto v open space*. ✗ *otevřený*, ✗ *otvorený prostor* (Bohemism: Slovak is *priestor*). |
| P04, P05 | zasedací místnost, zasedačka | meeting room | **zasadacia miestnosť** (f.) formal/product; **zasadačka** (f., acc. *zasadačku*) everyday | Slovak has the same natural pair, so keep the Czech split: product titles and summaries (`meetingRoomMetadataTitle`, `checkoutSummaryItemMeetingRoom`) use *zasadacia miestnosť*; CTAs and casual copy (`landingHeroMeetingRoomCta` → *Rezervovať zasadačku*) use *zasadačka*. ✗ *zasedačka*, ✗ *zasedacia* (Czech *e*), ✗ *rokovacia miestnosť*, ✗ *meeting room*. |
| P06, P07 | kancelář; soukromá kancelář | office; private office | **kancelária** (f., gen. pl. *kancelárií*); **súkromná kancelária** | ✗ *kancelár* (that is a chancellor). ✗ *soukromá*, ✗ *privátna kancelária*. |
| P08 | pracovní stanice | workstation | **pracovná stanica** (f.) | Profi tier desk with monitors. Keep it distinct from *vyhradené miesto*. ✗ *pracovní*. |
| P09 | vyhrazené místo | reserved desk | **vyhradené miesto** (n.) | ✗ *rezervované miesto* (blurs with the reservation itself). |
| P10 | stůl | desk / table | **stôl** (m., gen. *stola*, loc. *pri stole*) | Same word for the cowork desk and the Dotypos table (A09). ✗ *stůl*, ✗ *stola* as nominative. |
| P11, R21 | místo; přiřazené místo | spot / seat / desk; assigned desk | **miesto** (n.; *1 miesto, 2 miesta, 5 miest*); **pridelené miesto** | The bookable seat and the count noun in plurals. `accountReservationSeatsLabel` "Míst" → *Miesta*. `accountReservationAssignedDesk` → *Pridelené miesto*. ✗ *místo*, ✗ *miest* for 2–4. |
| P12, P14 | místnost; TTRPG místnost | room; TTRPG room | **miestnosť** (f.); **TTRPG miestnosť** | ✗ *pokoj* (Slovak *pokoj* = peace/rest), ✗ *izba* (a room in a home). Acronym stays. |
| P13, L08 | prostor / pracovní prostor; Sdílený pracovní prostor | space / workspace (generic); shared workspace | **priestor** (m.), **pracovný priestor**; **zdieľaný pracovný priestor** | Lowercase generic noun, not the brand. `workspaceDescription` → *Flexibilný pracovný priestor…*. ✗ *prostor* (Czech). ✗ *sdílený*. |
| P15 | kampaň (TTRPG) | campaign (role-playing) | **kampaň** (f.) | Slovak RPG players also say *kampaň*; context (`ttrpgRoomMetadataDescription` "Na kampaň nebo one-shot…") makes it clear. Never add *e-mailová* here. See A24. |
| P16 | one-shot | one-shot | **one-shot** (m.) | Loan stays. |
| P17 | bar | bar | **bar** (m., loc. *v bare*) | Deskohub Bar: see brand rule. `ttrpgRoomBarChoiceText` "drinky, deskovky" → *drinky, spoločenské hry*. ✗ *deskovky*, ✗ *doskovky*. |
| P18, X09 | provozovna; adresa provozovny | venue / premises; venue address | **prevádzka** (f.); **adresa prevádzky** | `footerCompanyAddressLabel` → *Adresa prevádzky*. Legal may use the statutory *prevádzkareň*. ✗ *provozovňa*, ✗ *prevádzkovňa*. |
| P19 | nabídka | offering / options | **ponuka** (f.) | `reservationTierLabel` "Nabídka" → *Ponuka*. `reservationAvailabilityUnavailable` "jinou nabídku" → *inú ponuku*. ✗ *nabídka*, ✗ *nábidka* (Bohemism). |
| P20, P21 | tarif; výhody | tier / plan; perks | **tarifa** (f., gen. *tarify*); **výhody** (f. pl.) | Gender changes: Czech *tarif* is masculine, Slovak *tarifa* feminine. `reservationTierPerkAllBasic` → *všetky výhody tarify Basic*. ✗ *tarif*, ✗ *tarifu Basic* as genitive. Legal defined term L10. `reservationTierPerksLabel` → *Výhody*. |
| P22, P23, P24 | Basic Day Pass, Cowork Plus, Profi Workstation | same | **Basic Day Pass**, **Cowork Plus**, **Profi Workstation** (and **Basic**) | Never translate or inflect. ✗ *denný pas*, ✗ *celodenná permanentka*. |
| P25, P29 | monitorový setup; monitor | monitor setup; monitor | **setup s monitormi** / **monitorový setup** (m., instr. *s monitorovým setupom*); **monitor** (m., pl. *monitory*) | Slovak tech copy keeps the loan *setup* as Czech does. Czech *sestava monitorů* (`reservationAvailabilityUnavailable`) → *zostava monitorov*. ✗ *sestava*. |
| P26, P27 | batch brew káva; káva zdarma | batch brew coffee; free coffee | **batch brew káva**; **káva zadarmo** | `reservationTierPerkFreeCoffee` → *káva zadarmo*. ✗ *zdarma* (the commonest Bohemism in this catalog), ✗ *bezplatná káva* in perk lists. |
| P28 | Wi-Fi | Wi-Fi | **Wi-Fi** (f./n., *pripojenie k Wi-Fi*) | Spelling stays. Wi-Fi password: *heslo k Wi-Fi*. |
| P30 | člen Workspace | Workspace member | **Účet vo Workspace** | `accountProfileScreenMemberFallback`: a display-name fallback. Slovak *člen* (m.) / *členka* (f.) is gendered and *osoba* reads oddly as a name, so use the neutral thing the name stands for. ✗ *Člen Workspace*, ✗ *Člen/ka*, ✗ *Člen(ka)*, ✗ *Používateľ Workspace* (masculine). |
| P31, P32, P33 | Deskohub Workspace, Workspace, Deskohub | same | **Deskohub Workspace**, **Workspace** (uninflected), **Deskohub** (inflected) | See the brand inflection rule above. `accountReferralsDiscountInfo` "ve Workspace" → *vo Workspace*. ✗ *ve Workspace*, ✗ *v Workspace*. |

### R: reservation and time

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| R01, D11 | rezervace; první rezervace | reservation; first reservation | **rezervácia** (f., gen. *rezervácie*, gen. pl. *rezervácií*); **prvá rezervácia** | The core noun in customer UI and admin. Plurals: *1 rezervácia, 2 rezervácie, 5 rezervácií*. Czech has one = few (*rezervace*), Slovak doesn't (see Watch keys). ✗ *rezervace*, ✗ *booking*, ✗ *rezervácií* for 2–4. Legal: L13. |
| R02 | rezervovat | book / reserve | **rezervovať** (imp. *rezervuj*, admin *rezervujte*) | `landingHeroPrimaryCta` → *Rezervovať coworking*. ✗ *zarezervovať* on buttons (fine in prose), ✗ *bookovať*. |
| R03 | rezervační | booking (adj.) | **rezervačný** (*rezervačný formulár*, *rezervačný dopyt*) | `reservationSuccessMessage` "Rezervační poptávka" → *Rezervačný dopyt*. ✗ *rezervační*. |
| R04, A10 | objednávka; objednávky | order; orders | **objednávka** (f., pl. *objednávky*, gen. pl. *objednávok*) | Same word as Czech, and correct. Order ID: *číslo objednávky*. |
| R05 | objednat a zaplatit | order and pay | **Objednať s povinnosťou platby**; with amount: **Objednať s povinnosťou platby ({amount})** | Final checkout button (`checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton`). Slovak Act No. 108/2024 Z. z. on consumer protection, **§ 17 ods. 4**, requires the order button to be labelled *„objednávka s povinnosťou platby"* or an equivalent unambiguous wording that payment follows (it transposes Art. 8(2) of Directive 2011/83/EU). Quote the statute from slov-lex.sk when legal text cites it. Czech law governs, and Rome I Art. 6 does not import Slovak law here (Art. 6(4)(a): services supplied only in Prague). The Czech rule (§ 1826a OZ) implements the same Directive article, and the Slovak statutory phrase is the wording Slovak readers know, so it is the safest unambiguous form (the same reasoning as [de-DE.md](de-DE.md) R05). The verb-first form keeps the infinitive button style. It is ~29 characters, over the 20-character budget: an accepted legal exception. Check that it wraps on mobile. ✗ *Objednať a zaplatiť* (likely enough, but not the statutory wording), ✗ *Pokračovať*, ✗ *Odoslať*, ✗ *Zaplatiť* alone. |
| R06 | poptávka | inquiry | **dopyt** (m., gen. *dopytu*) | Contact-form request. `landingFooterContactTitle` → *Dopyt* / *Pošli dopyt*. ✗ *poptávka*, ✗ *poptávka → popyt* (Polish). |
| R07, R08 | termín; datum | date / time slot; date | **termín** (m.); **dátum** (m.!, gen. *dátumu*) | Same word, same meaning (a slot). Not a deadline. Gender changes: Czech *datum* is neuter, Slovak *dátum* masculine: *tento dátum*, *zvolený dátum*. ✗ *datum*, ✗ *toto dátum*, ✗ *zvolené dátum*. |
| R09, R10 | začátek; konec | start; end | **začiatok** (m.); **koniec** (m.) | `reservationMeetingRoomStartLabel` → *Začiatok*; `access-codes:accessCodesEndsLabel` → *Koniec*. ✗ *začátek*, ✗ *konec*. |
| R11 | délka | duration | **dĺžka** (f.) | `reservationMeetingRoomDurationLabel` → *Dĺžka*. Note *ĺ*. ✗ *délka*, ✗ *dlžka*. |
| R12, R13 | hodina; den | hour; day | **hodina** (f.): *1 hodina, 2 hodiny, 5 hodín, 1,5 hodiny*; **deň** (m.): *1 deň, 2 dni, 5 dní, 1,5 dňa*; *celý deň* | Count noun in `reservationMeetingRoomDurationHours`, `reservationValidationOfficeMaximumDuration`. ✗ *hodin* (Czech gen. pl.). `reservationMeetingRoomDurationWholeDay` → *celý deň*. ✗ *den*, ✗ *dny* (Czech few), ✗ *2 dní*. |
| R14, R15, R16 | dostupnost; volný / volno; obsazeno | availability; available / free; booked / taken | **dostupnosť** (f.); **voľný / voľné** (adj.), **dostupné**; **obsadené** | `reservationAvailabilityError` → *Nepodarilo sa overiť dostupnosť.* ✗ *dostupnost*. Free slot. Slovak *voľno* means time off (*mám voľno*), so don't use it as a noun for availability. ✗ *volný*, ✗ *voľno* as "free slot", ✗ *zadarmo* (that is free of charge). `bookingWidgetNotAvailable` "Vypadá to, že je obsazeno" → *Vyzerá to, že je obsadené.* ✗ *vypadá* (Czech *vypadat*; Slovak *vypadnúť* = to fall out). |
| R17, S03 | potvrzení; potvrzeno | confirmation; confirmed | **potvrdenie** (n.); **potvrdené** | ✗ *potvrzení*, ✗ *potvrzené*. |
| R18, L16 | zrušení / zrušit; Storno Rezervace | cancellation / cancel; Booking Cancellation | **zrušenie** (n.) / **zrušiť**; **Zrušenie Rezervácie** | `checkoutStatusCancelledTitle` "Platba byla zrušena." → *Platba bola zrušená.* Legal heading L16 uses *Zrušenie Rezervácie*. ✗ *stornovať* in customer copy. GTC §8 heading. Keeps *storno* exclusive to the admin void (A12). |
| R19 | změna | change | **zmena** (f.) | ✗ *změna*. |
| R20 | Rezervoval(a) {name} | Booked by {name} | **Rezervujúca osoba: {name}** | `accountReservationBookedBy`. *osoba* is grammatically feminine but neutral about the person, and the colon keeps `{name}` in the nominative. Sibling `accountReservationBookedFor` "Pro {name}" → *Pre {name}* (an uninflected name after *pre* is tolerated in UI, as in Czech). ✗ *Rezervoval(a)*, ✗ *Rezervoval/a*, ✗ *Rezervoval/-a*, ✗ *Rezerváciu vytvoril*, ✗ *Rezervované od {name}* (forces genitive on the name). |
| R22, R23 | platnost / platí; vypršet | validity / is valid; expire | **platnosť** (f.) / **platí**; **vypršať**; preferred phrasing **platnosť … vypršala** | `accountSignInCodeBody` "Platí 10 minut." → *Platí 10 minút.* ✗ *platnost*, ✗ *minut*. `checkoutPayInvalidStateTitle` → *Platnosť tohto platobného odkazu vypršala.* ✗ *vypršel*, ✗ *expiroval*. |
| K25 | blokace rezervace (hold) | reservation hold | **dočasná blokácia rezervácie** (f.) | `checkoutStatusLatePaymentReviewContactMessage`: *moja platba prišla až po uplynutí dočasnej blokácie rezervácie*. Formal voice to the venue (*Dobrý deň,* … *musíte skontrolovať*, *Prosím, potvrďte mi…*). ✗ *dorazila* (Slovak *doraziť* = to finish off), ✗ *blokace*. `bookingWidgetHeld` "Rezervaci ti držíme" → *Rezerváciu ti držíme do {expiresAt}.* |

### K: payment and billing

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| K01, K02, K03 | platba; zaplatit; zaplaceno | payment; pay; paid | **platba** (f.); **zaplatiť** (*zaplatíš*); **zaplatené** | `reservationAlreadyPaidMessage` → *…je už zaplatená.* ✗ *zaplacené*, ✗ *platit* (Czech infinitive). |
| K04, K05 | platební karta / karta; platební metoda | payment card; payment method | **platobná karta** (f.) / **karta**; **spôsob platby** (m.) | `accountBillingAddPaymentCard` → *Pridať platobnú kartu*. ✗ *platební*. Slovak payment UIs say *spôsob platby*. `accountBillingPaymentMethodsTitle` → *Spôsoby platby*. ✗ *platební metoda*, ✗ *platobná metóda* (understandable, less native). |
| K06, K07, K08 | platební brána; platební odkaz; Nexi | payment gateway; payment link; Nexi | **platobná brána** (f.); **platobný odkaz** (m.); **Nexi** (uninflected) | Nexi hosted page. `checkoutPayProviderHandoff` → *na zabezpečenej platobnej stránke Nexi, ktorá sa otvorí na novej karte* (Slovak browser tab = *karta*). ✗ *záložka* (that is a bookmark in Slovak browser UI). ✗ *platební*, ✗ *platobný link*. *cez Nexi*, *platobná stránka Nexi*. ✗ *Nexiu*, ✗ *v Nexi* (prefer *na stránke Nexi*). |
| K09, K10, K11 | cena; základní cena; ceník | price; base price; price list | **cena** (f.); **základná cena**; **cenník** (m.) | `accountReferralsDiscountInfo` → *Táto zľava platí na základnú cenu akejkoľvek rezervácie vo Workspace.* ✗ *základní*, ✗ *jakékoli* → *akejkoľvek*. `pricingPageTitle` → *Cenník*. Legal L11. ✗ *ceník* (single *n* is Czech). |
| K12, K13 | částka; celkem | amount; total | **suma** (f.); **Spolu** | `invoiceAmountLabel` → *Suma*. Slovak *čiastka* exists but sounds Czech-flavoured in a payment context. ✗ *částka*. Invoice/summary total label. ✗ *Celkem*, ✗ *Celkom* on totals (means "quite" too). |
| K14, K15 | měna; Kč | currency; CZK | **mena** (f.); prose currency **CZK** | `accountBillingCurrency` "Měna: CZK (Kč)" → *Mena: CZK* (drop the Czech symbol, per style guide §6). `pricingIntro` "Ceny v Kč" → *Ceny v CZK*. ✗ *Kč*, ✗ *korún*, ✗ *českých korún* in labels, ✗ EUR or any EUR approximation. |
| K16, K17 | faktura; fakturační údaje | invoice; billing details | **faktúra** (f.); **fakturačné údaje** (m. pl.) | The only tax document. `invoiceTitle` → *Faktúra*. ✗ *faktura*, ✗ *doklad*, ✗ *účtenka*, ✗ *bloček* (receipts don't exist here). `accountBillingDetailsTitle` → *Fakturačné údaje*. ✗ *fakturační*. |
| K18, K19 | DPH; neplátce DPH | VAT; not a VAT payer | **DPH** (daň z pridanej hodnoty); **nie je platiteľom DPH** | Slovak calls a VAT-registered person *platiteľ DPH*, not *plátca*. `footerVatStatus` → *spoločnosť nie je platiteľom DPH*; `invoiceNonVatPayerStatement` → *Nie sme platiteľmi DPH.* ✗ *plátca DPH*, ✗ *neplátca DPH*, ✗ *plátce*. |
| K20, K21 | IČO; DIČ | company ID number; VAT ID | **IČO**; **IČ DPH** | Slovakia uses three identifiers: *IČO* (company number), *DIČ* (tax number, not a VAT number) and *IČ DPH* (VAT ID, `SK…`). The Czech field labelled *DIČ* holds the VAT ID: the company lookup fills it from the Czech ARES `dic` (`CZ…`), and the English twin says "VAT ID". So `reservationBillingVatIdLabel` / `accounting:accountingInvoiceFormVatId` "DIČ (nepovinné)" → **IČ DPH (nepovinné)**, and IČO stays *IČO*. The company lookup only searches the Czech ARES registry (8-digit Czech IČO), so in `accountAresLookup*` keys write *český register firiem* / *ARES* where the Czech says *registr firem*. Don't imply a Slovak registry. The company's own identifiers in footer/legal (*IČO 24531596*) are Czech values: never relabel or reformat them. ✗ *DIČ* for the VAT field, ✗ *IČ DPH* for the Czech company's own number. |
| K22 | firma / společnost | company | **firma** (f., everyday) / **spoločnosť** (f., formal) | Keep the Czech register split. `reservationBillingCompanyNameLabel` → *Oficiálny názov firmy*. ✗ *společnosť*, ✗ *spoločnost*. |
| K23, K24 | PSČ; ulice | postal code; street | **PSČ**; **ulica** (f.) | Address block: *Ulica*, *Mesto* (Czech *Město*), *PSČ*, *Krajina* (Czech *Země*). ✗ *Zem*/*Země* for country (Slovak *zem* = soil/earth), ✗ *ulice*, ✗ *Město*. |

### D: discounts and referrals

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| D01 | sleva | discount | **zľava** (f., gen. pl. *zliav*) | `faqQuestionSales` "Máte slevy?" → *Máte zľavy?* `accountReferralsHowCompound` "Slevy se skládají!" → *Zľavy sa sčítavajú!* ✗ *sleva*, ✗ *zlava* (missing ľ), ✗ *rabat*. |
| D02, D03 | slevový kód; kód | discount code; code | **zľavový kód** (m.); **kód** (m.) | ✗ *slevový*, ✗ *kupón* (blurs with voucher). Generic code. |
| D04, D05 | poukaz; Sleva, poukaz nebo doporučovací kód | voucher; Discount, voucher or referral code | **poukážka** (f.); **Zľava, poukážka alebo odporúčací kód** | Slovak retail calls vouchers *poukážka* (*darčeková / zľavová poukážka*). *poukaz* is valid Slovak but reads as the Czech word, so don't use it. The three concepts in `checkoutDiscountCodeLabel` stay distinct. `checkoutVoucherLabel` → *Poukážka*. ✗ *poukaz*, ✗ *voucher*, ✗ *kupón*, ✗ *darčeková karta* (the Czech doesn't say *dárkový*). |
| D06 | akce (sale) | sale / promotion | **akcia** (f.), **zľavová akcia**; banners usually just **zľava** | Time-limited price promotion. `landingSaleBannerAllMeetingRoomProducts` → *{title}: zľava <discount>{adjustment}</discount> na rezervácie zasadačky!* Admin area: A08. ✗ *výpredaj* (a clearance sale), ✗ *akce*. |
| D07 | akce (event) | event | **podujatie** (n., pl. *podujatia*) | `landingOfferingEvents` "Firemní akce a jiné eventy" → *Firemné podujatia a iné eventy organizujeme po dohode.* Legal GTC §14 "akce" → *podujatie*. ✗ *akcia* for an event (in Slovak it suggests a sale), ✗ *na domluvu* → *po dohode*. |
| D08, D09, D10 | doporučení; doporučovací kód; doporučovací odkaz | referral; referral code; referral link | **odporúčanie** (n.; *1 odporúčanie, 2 odporúčania, 5 odporúčaní*); **odporúčací kód**; **odporúčací odkaz** (m.) | `accountSectionReferrals` → *Odporúčania*. Czech *doporučení* doesn't change across plurals; Slovak does (see Watch keys). ✗ *doporučenie*: a classic Bohemism, written exactly like Czech plus *-ie*. ✗ *doporučovací*, ✗ *odporúčací link*. |

### U: account and sign-in

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| U01, U15, U02 | účet; zákaznický účet; profil | account; customer account; profile | **účet** (m., gen. *účtu*); **zákaznícky účet**; **profil** (m.) | ✗ *zákaznický*. |
| U03, U04 | přihlásit se / přihlášení; odhlásit se | sign in / sign-in; sign out | **prihlásiť sa** / **prihlásenie** (n.); **odhlásiť sa** | Imp. *prihlás sa*; admin *prihláste sa*. `reservationSignInPrompt` → *Už u nás máš účet? <signIn>Prihlás sa</signIn>*. Mobile `home_signed_in_as` "Přihlášeno jako {email}" → *Prihlásený účet: {email}* (avoids the gendered *prihlásený/á ako*). ✗ *přihlásit*, ✗ *zalogovať sa*, ✗ *login*, ✗ *vstúpiť*. `accountSignOut` → *Odhlásiť sa*. ✗ *odlogovať*. |
| U05, U06 | přihlašovací odkaz; přihlašovací kód | sign-in link; sign-in code | **prihlasovací odkaz** (m.); **prihlasovací kód** | `accountMagicLinkEmailSubject` → *Prihlasovací odkaz do Deskohub Workspace*. ✗ *magický odkaz*, ✗ *magic link*. `accountSignInCodeBody` "šestimístný kód" → *šesťmiestny kód*. ✗ *šestimiestny*. |
| U07 | přístupový klíč | passkey | **prístupový kľúč** (m., pl. *prístupové kľúče*) | Apple (iOS/macOS Slovak), Google Account and Windows Slovak UIs all say *prístupový kľúč*, so readers know it from their OS. Check the current OS strings before release. `accountSignInPasskey` → *Prihlásiť sa prístupovým kľúčom*. Don't shorten it to *kľúč* where an access code (X01) is on the same screen. ✗ *passkey*, ✗ *heslový kľúč*, ✗ *prístupový klíč*, ✗ *kluč* (missing ľ). |
| U08, U09 | správce hesel; heslo | password manager; password | **správca hesiel** (m.); **heslo** (n., gen. pl. *hesiel*) | `accountPasskeyPromptPointStorage` → *Kľúč si uloží tvoj správca hesiel alebo toto zariadenie.* ✗ *správce*, ✗ *hesel*. Same as Czech. |
| U10, A47 | relace; relace CLI | session; CLI session | **relácia** (f.); **relácia CLI** | IT sense (*aktívne relácie*). Czech *relace* has one = few in admin plurals; Slovak doesn't. ✗ *relace*, ✗ *sedenie*. |
| U11, U12 | zařízení; prohlížeč | device; browser | **zariadenie** (n.); **prehliadač** (m.) | ✗ *zařízenie*. ✗ *prohlížeč*, ✗ *browser*. |
| U13 | ověření / ověřit | verification / verify | **overenie** (n.) / **overiť** | ✗ *ověrenie*. |
| U14 | e-mail | email | **e-mail** (m.), **e-mailová adresa** | Slovak spelling is *e-mail*. `accountSignInCodeResendCooldown` → *Nový e-mail môžeš poslať o {seconds} s* (see Watch keys: *o*, not *za*). ✗ *email*, ✗ *mail*. |
| U16, A06 | zákazník | customer | **zákazník** (m.) | Customer UI and admin. Legal uses *Klient* (L03). Generic masculine is accepted in admin data labels (*ID zákazníka v Dotypose*). |
| U17 | telefon | phone | **telefón** (m.) | `contactPhonePlaceholder` example → *+421 900 000 000* (style guide §6). ✗ *telefon*, ✗ copying the Czech number. |

### X: access and venue

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| X01, A01 | přístupový kód | access code | **prístupový kód** (m.) | The door code for a reservation and the staff-created code. `checkoutEmailCustomerAccessButton` → *Zobraziť prístupový kód*. It must stay *kód*, never *kľúč* (U07). ✗ *vstupný kód*, ✗ *prístupový kľúč*. |
| X02, L12 | PIN / PIN kód; Přístupový PIN kód | PIN / PIN code; Access PIN Code | **PIN** / **PIN kód** (m.); legal **Prístupový PIN kód** | `accountReservationShowPinCode` → *Zobraziť PIN kód*. ✗ *PIN-kód*, ✗ *pin*. |
| X03 | dveře | door | **dvere** (pl. tantum, gen. *dverí*, dat. *dverám*) | *pri hlavných dverách*. ✗ *dveře*, ✗ *dvere* + singular verb. |
| X04 | klávesnice | keypad | **klávesnica** (f.) at the door: **klávesnica pri dverách** | `landingAccessStepKeypad` → *PIN zadáš na klávesnici pri hlavných dverách. Aplikáciu nepotrebuješ.* The door context marks it as a keypad. Where it could be read as a computer keyboard, write *číselná klávesnica*. ✗ *klávesnice*, ✗ *u dverí* (Slovak *pri dverách*). |
| X05, X06, A15 | vstup; přístup; přístup ke dveřím | entry / entrance; access; door access | **vstup** (m.); **prístup** (m.); **prístup k dverám** | `landingUiHeroFlowTitle`. Also the legal *coworkingový vstup* (a cowork entry). Section heading `administration:administrationReservationAccessTitle` → *Prístup k dverám*. ✗ *ke dverám*, ✗ *ku dverám* (*ku* only before k/g). |
| X07, X08 | otevírací doba; otevřeno nonstop | opening hours; open 24/7 | **otváracie hodiny** (f. pl.); **otvorené nonstop** | `pricingOpeningHoursTitle` → *Otváracie hodiny*. ✗ *otváracia doba* (literal Bohemism), ✗ *otevírací*. `workspaceMetadataAlwaysOpen` → *Otvorené nonstop*. ✗ *otevřené*. |
| X10, X12, X13 | Palmovka; Libeň; metro | Palmovka; Libeň; metro | **Palmovka** (*na Palmovke*); **Libeň** (*v Libni*); **metro** (n., *stanica metra*) | Names stay; Slovak case endings. `landingLocationTransport` → *Nájdeš nás v Libni na Turnovskej ulici, dve minúty pešo od stanice metra B Palmovka. Na Palmovke zastavujú aj električky.* ✗ *na Palmovce*, ✗ *tramvaje* (Slovak tram = *električka*), ✗ *pěšky*. |
| X11 | Praha | Prague | **Praha** (*v Prahe*, *do Prahy*); addresses **Praha 8** | ✗ *v Praze*. |
| X14 | Google Maps | Google Maps | **Google Maps** | Kept verbatim per style guide §4, as the Czech does (Google's own Slovak name is *Mapy Google*; don't switch). `landingLocationMapCta` → *Otvoriť v Google Maps*. |
| X15 | kontakt | contact | **kontakt** (m.); verb **kontaktuj nás** | `accountHelpContact` "kontaktuj nás" → *kontaktuj nás*. |

### G: consent and privacy

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| G01, G02, G03 | souhlas; marketingový souhlas; marketingová sdělení | consent; marketing consent; marketing messages | **súhlas** (m.); **marketingový súhlas**; **marketingové správy** (f. pl.) | ✗ *souhlas*. `legalScreenMarketingDescription`. `marketingPreferencesFormRowDescription` "marketingová a komunitní sdělení" → *marketingové a komunitné správy*. ✗ *sdelenia* (Czech calque), ✗ *zprávy*. Legal document title: L28. |
| G04, G05, G06 | cookies; nezbytné cookies; analytické a marketingové cookies | cookies; necessary cookies; analytics and marketing cookies | **cookies** (pl., uninflected); **nevyhnutné cookies**; **analytické a marketingové cookies** | `cookieConsentPreferencesNecessaryTitle` → *Nevyhnutné cookies*. Legal prose may introduce *súbory cookies* once. ✗ *nezbytné* (Slovak *nevyhnutné*), ✗ *koláčiky*, ✗ *sušienky*. |
| G07 | nastavení cookies | cookie settings | **nastavenia cookies** | Slovak settings are plural: *Nastavenia*. `footerCookieSettingsLink` → *Nastavenia cookies*. ✗ *nastavenie cookies* (Czech singular). |
| G08, L24, G09 | osobní údaje; zpracování osobních údajů; soukromí | personal data; processing of personal data; privacy | **osobné údaje** (m. pl.); **spracúvanie osobných údajov**; **súkromie** (n.) | The Slovak GDPR text and Act 18/2018 Z. z. say *spracúvanie*, not *spracovanie*. ✗ *osobní*, ✗ *spracovanie osobných údajov*. `accountLegalTitle`. ✗ *soukromie*, ✗ *privátnosť*. |

### S: status and errors

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| S01, S02 | stav; čeká | status; pending | **stav** (m.); **čaká sa** / **čaká na platbu** (status label **Čaká**) | `checkoutStatusPendingLead`. ✗ *čeká*. |
| S04 | zkusit znovu | try again | **Skúsiť znova** (button); in sentences **Skús to znova.** / admin **Skúste to znova.** | `errorPageRetry`, `accountAresLookupRetry`, `shell:shellErrorRetry`. Slovak dictionaries allow *znovu* too. Use *znova* everywhere for consistency: *znovu* looks like unedited Czech. ✗ *Zkusiť*, ✗ *Skúsiť znovu*. |
| S05 | nepodařilo se | could not | **nepodarilo sa** | `reservationAvailabilityError` → *Nepodarilo sa overiť dostupnosť. Skús to, prosím, znova.* ✗ *nepodařilo*, ✗ *nepodarilo se*. |
| S06, S09 | načítání / načíst; neplatný | loading / load; invalid | **načítava sa** / **načítať**; **neplatný** | `reservationMeetingRoomStartTimesLoading` "Načítáme…" → *Načítavame…*. ✗ *načítání*, ✗ *načítáme*. `agentToolErrorInvalidInput`. |
| S07, S08 | podpora; pomoc | support; help | **podpora** (f.); **pomoc** (f.) |  |

### I: AI assistants

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| I01, I04, I05 | AI asistent; ChatGPT / Claude; MCP | AI assistant; same | **AI asistent** (m., pl. *AI asistenti*); **ChatGPT**, **Claude**, **MCP** | ✗ *AI agent*, ✗ *UI asistent*. Uninflected. |
| I02 | konektor | connector | **konektor** (m.) | Claude's custom connector. Check the label in Claude's Slovak UI if one ships. |
| I03 | Aplikace (ChatGPT) | Apps | **Aplikácie** | Use ChatGPT's Slovak menu label. *Aplikácie* is the expected form, but unverified against the live ChatGPT Slovak UI: check before release. `aiAssistantsChatGptStepFind` → *V ChatGPT otvor Aplikácie a vyhľadaj „Deskohub Workspace“.* ✗ *vyhledej*. |

### M: mobile

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| M01 | aktualizace | update | **aktualizácia** (f.) | `update_ready` → *Aktualizácia aplikácie je pripravená. Prejaví sa po reštarte.* ✗ *aktualizace*, ✗ *update*. |
| M02, M03 | restartovat; vrátit se do aplikace | restart; return to the app | **reštartovať** (button **Reštartovať**); **vrátiť sa do aplikácie** | Slovak spells *š*. ✗ *restartovať*. `signin_returning_to_app` → *Vraciame ťa do aplikácie.* `native_update_download` → *Stiahnuť*. ✗ *vrátit*, ✗ *Stáhnuť*. |

### A: administration (formal vy)

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| A02 | administrace | administration | **administrácia** (f.) | `shell:shellNavigationLabel`. |
| A03, A04, A05 | administrátor; role administrátora; udělit / odebrat roli | administrator; administrator role; grant / revoke role | **administrátor** (m.); **rola administrátora** (f., acc. *rolu*); **udeliť / odobrať rolu** | Prefer role phrasing to gendered person nouns: `administrators:administratorsGrantTitle` "Přidat administrátora" → *Udeliť rolu administrátora*; `administratorsRevokeConfirm` → *Odobrať rolu*. ✗ *roľa* (Slovak *roľa* = farmland), ✗ *roli* (Czech acc.), ✗ *administrátorka/administrátor* pairs. |
| A07 | akce (actions) | actions | **Akcie** | Table actions column header `administration:administrationTableActions`. |
| A08 | akce (sale) | sale | **Zľavové akcie** | Discount-promotion area `discounts:discountsSalesTitle`. Czech uses *Akce* for both A07 and A08; in Slovak, A08 must say *Zľavové akcie* so the two never show the same word. Singular in prose: *zľavová akcia*. ✗ *Akcie* for sales, ✗ *Výpredaje*. |
| A09 | rezervace stolu | booking (Dotypos) | **rezervácia stola** (always with *stola*) | The Dotypos table booking behind a reservation. Czech separates it from *rezervace* only by the qualifier *stolu*, and Dotypos's own UI uses *rezervácia* for tables. So Slovak keeps the qualifier on every use and never shortens it to bare *rezervácia*: `administrationBookingDetailTitle` → *Podrobnosti rezervácie stola*. ✗ *booking*, ✗ *rezervácia* alone in a booking context, ✗ *objednávka stola* (collides with A10). |
| A11, A13 | operace; platba nedokončena | operations; payment abandoned | **operácie** (f. pl.); **Platba nedokončená** | Nexi payment operations. Plural `administrationOperationCount` (see Watch keys). ✗ *nedokončena*. |
| A12 | storno | void | **Storno** | The payment-provider void (`administrationProviderOperationTypeVoid`). Slovak banking says *storno* too. Never use it for a reservation cancellation (that's *zrušenie*). |
| A14, A16, A17, A18 | aktivita rezervací; filtry; stránkování; drobečková navigace | reservation activity; filters; pagination; breadcrumb | **Aktivita rezervácií**; **filtre** (m. pl.); **stránkovanie** (n.); **navigačná cesta** (f.) | `shell:shellBreadcrumbLabel` → *Navigačná cesta* (accessible landmark name). ✗ *filtry*, ✗ *drobčeková navigácia* (a calque no Slovak UI uses), ✗ *omrvinky*. |
| A19 | export | export | **export** (m.) / **exportovať** | |
| A20, A21 | odběratel; položky | customer (invoice); line items | **odberateľ** (m.); **položky** (f. pl.) | Statutory invoice party, as in Slovak invoicing. `accounting:accountingInvoiceFormCustomerHeading` → *Odberateľ*. ✗ *odběratel*, ✗ *zákazník* here. |
| A22, A23 | datum splatnosti / po splatnosti / k úhradě; variabilní symbol | due date / overdue / due; variable symbol | **dátum splatnosti** / **po splatnosti** / **na úhradu**; **variabilný symbol** (m., abbr. *VS*) | ✗ *k úhrade*. Slovak banking uses the same concept and term, so no gloss needed. ✗ *variabilní*. |
| A24, A28 | kampaň; automatizace / automatická kampaň | campaign; automation / automated campaign | **kampaň** (f.), **e-mailová kampaň** where TTRPG copy could be confused; **automatizácia** (f.) / **automatická kampaň** | Admin context is always email. ✗ *automatizace*. |
| A25, A26, A27 | okruh příjemců; uložené publikum; příjemce | audience; saved audience; recipient | **publikum** (n., gen. *publika*, pl. *publiká*); **uložené publikum**; **príjemca** (m., gen. pl. *príjemcov*) | One Slovak word for both Czech words (style guide §1). `email-campaigns:emailCampaignsAudienceEditorSave` → *Uložiť publikum*. ✗ *okruh príjemcov* (mixes two words for one concept), ✗ *segment*, ✗ *cieľová skupina*. ✗ *příjemce*. |
| A29, A30, A31 | zkušební běh; běh; spuštění | dry run; run; fire | **skúšobný beh**; **beh** (m., pl. *behy*); **spustenie** (n.) | `emailAutomationRunsCountsTitle` "Běhy podle stavu" → *Behy podľa stavu*; `emailAutomationActivationNextFiresTitle` → *Najbližšie spustenia*. ✗ *zkúšobný*, ✗ *běh*, ✗ *podle*. |
| A32 | spouštěcí událost | trigger | **spúšťacia udalosť** (f.) | ✗ *spouštěcí*, ✗ *trigger*. |
| A33, A34, A35 | krok; podmínka; vlastnost zákazníka | step; condition; customer attribute | **krok** (m.); **podmienka** (f.); **vlastnosť zákazníka** (f.) |  |
| A36, A37 | slevová skupina; štítky v Dotyposu | discount group; Dotypos tags | **zľavová skupina** (f.); **Štítky v Dotypose** | Dotypos discount group. Inflected per the brand rule. |
| A38 | potvrzovací kód | confirmation code | **potvrdzovací kód** | ✗ *potvrzovací*. |
| A39, A40, A41 | předmět; text náhledu; šablona | subject; preheader; template | **predmet** (m.); **text náhľadu**; **šablóna** (f.) | ✗ *náhledu* (Slovak has *ľ*). ✗ *šablona*. |
| A42, A43, A44, A45, A46 | účel; překlad; zveřejnění; archivovat; smazat | purpose; translation; publishing; archive; delete | **účel** (m.); **preklad** (m.); **zverejnenie** (n.); **Archivovať**; **Odstrániť** (permanent: *natrvalo odstrániť*) | ✗ *Smazať*, ✗ *Zmazať* on buttons (colloquial). |
| A48, A49, A52, A53 | schválit; odvolat; zrušit; uložit / vytvořit | approve; revoke; cancel; save / create | **Schváliť**; **Odvolať**; **Zrušiť**; **Uložiť** / **Vytvoriť** | `admin-cli:adminCliRevokeTitle` → *Odvolať*. Infinitive buttons. ✗ *Zrušit*, ✗ *Uložit*. |
| A50 | klient (CLI) | client | **klient** (m.; label **Klient**) | Software client in `admin-cli` only. Never in legal text, where *Klient* is the defined party (L03). |
| A51 | sestavení | build | **zostava** (f.) | `adminCliAuthenticateBuildLabel` "Sestavení CLI" → *Zostava CLI*. ✗ *zostavenie*, ✗ *build*. |
| A54 | další / předchozí | next / previous | **Ďalšia** / **Predchádzajúca** (*strana* f.) | Pagination. ✗ *Další*, ✗ *Předchozí*. |
| A55, A56 | název / jméno / příjmení; nepovinné | name / first name / last name; optional | **názov** (things) / **meno** (first name) / **priezvisko**; **nepovinné** | `accounting:accountingInvoiceFormLastName` → *Priezvisko*. ✗ *jméno*, ✗ *příjmení*, ✗ *volitelné*. |
| A57 | propagační poukaz | promotional voucher | **propagačná poukážka** (f., pl. *propagačné poukážky*) | `discounts:discountsVouchersPageTitle` → *Propagačné poukážky*. Same word as D04. |

### L: legal (formal; Czech law, Slovak defined terms)

Defined terms are capitalised in every inflected form, exactly like the Czech (*Klient, Klienta, Klientovi*). The first definition uses *(ďalej len „…“)*, the Slovak equivalent of *(dále jen „…“)*. Never write *dále*. Legal defined terms that share a row with UI terms: L08 → P13, L11 → K09, L12 → X02, L16 → R18, L24 → G08.

| ID(s) | Czech | English | Slovak | Notes / forbidden alternatives |
|---|---|---|---|---|
| L01 | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | **Všeobecné obchodné podmienky (VOP)** | Slovak uses the same abbreviation. ✗ *obchodní podmínky*. |
| L02, L03, L04 | Poskytovatel; Klient; Spotřebitel | Provider; Client; Consumer | **Poskytovateľ**; **Klient**; **Spotrebiteľ** | *Poskytovateľ* = Desktechub s.r.o.; *Klient* = the contracting customer in the GTC, different from A50 (software client); *Spotrebiteľ* = statutory consumer (*Klient, ktorý koná mimo rámca svojej podnikateľskej činnosti*). ✗ *Poskytovatel*, ✗ *Spotřebitel*, ✗ *Zákazník* in legal text. |
| L05 | Smlouva | Contract | **Zmluva** (f.) | ✗ *Smluva*, ✗ *Kontrakt*. |
| L06, L07 | Prostory; Služby | Premises; Services | **Priestory** (m. pl.); **Služby** (f. pl.) | ✗ *Prostory*. |
| L09 | Provozní řád | House Rules | **Prevádzkový poriadok** | The checkout consent links it as *Prevádzkový poriadok*. ✗ *Prevádzkový rád*, ✗ *Domový poriadok*. |
| L10 | Tarif | Tariff | **Tarifa** (f.) | Gender changes from Czech (see P20): *2.5 Tarifou sa rozumie…*. |
| L11 | Ceník | Price List | **Cenník** | |
| L12 | Přístupový PIN kód | Access PIN Code | **Prístupový PIN kód** | Shared row with X02. |
| L13 | Rezervace | Booking | **Rezervácia** | Same root as UI R01, capitalised as a defined term. |
| L14, L23 | Provozovatel; Správce osobních údajů | Operator; Controller | **Prevádzkovateľ** (House Rules); **prevádzkovateľ** (privacy: the GDPR controller) | The Slovak GDPR text calls the controller *prevádzkovateľ* (and the processor *sprostredkovateľ*). Slovak readers of a privacy policy expect that word. Both refer to Desktechub s.r.o., in different documents, so the shared word causes no confusion. ✗ *správca osobných údajov* (a Bohemism in data-protection Slovak), ✗ *Provozovateľ*. |
| L15 | Uživatel | User | **Používateľ** | Slovak standard prefers *používateľ*. ✗ *Uživatel*, ✗ *Užívateľ*. |
| L17 | odstoupení od smlouvy | withdrawal from the contract | **odstúpenie od zmluvy** | Also in `checkoutPayConsent` (see Watch keys). ✗ *odstoupení*. |
| L18 | vady a reklamace | defects and complaints | **vady a reklamácie** | Slovak civil law also says *vady* (*zodpovednosť za vady*). ✗ *chyby a sťažnosti*. |
| L19 | mimosoudní řešení spotřebitelských sporů | alternative consumer dispute resolution | **mimosúdne riešenie spotrebiteľských sporov** | The ADR body stays Czech (ČOI). Don't name Slovak *alternatívne riešenie sporov* bodies. |
| L20 | Občanský zákoník / zákon č. 89/2012 Sb. | Civil Code / Act No. 89/2012 Coll. | **zákon č. 89/2012 Sb., občanský zákoník** (Czech citation kept); once glossed **(zákon č. 89/2012 Zb., Občiansky zákonník)** | Czech law. Never substitute Slovak Act 40/1964 Zb. |
| L21 | obchodní rejstřík | Commercial Register | **obchodný register** (m.) | Court stays *Městský soud v Praze*; an optional gloss *(Mestský súd v Prahe)* is allowed in legal only. ✗ *rejstřík*. |
| L22, L30 | Zásady ochrany osobních údajů; Zásady používání cookies | Privacy Policy; Cookie Policy | **Zásady ochrany osobných údajov**; **Zásady používania cookies** | `footerPrivacyLink`. `footerCookiePolicyLink`. |
| L25, L26, L27 | právní základ; doba uchování; předávání mimo EU | legal basis; retention period; transfers outside the EU | **právny základ**; **doba uchovávania**; **prenos mimo EÚ** | ✗ *právní*, ✗ *doba uchování*. Slovak abbreviation is *EÚ*. ✗ *EU*, ✗ *predávanie* (Slovak *predávať* = to sell). |
| L28, L29 | Souhlas s marketingovou komunikací; odvolání souhlasu | Marketing Communications Consent; withdrawal of consent | **Súhlas s marketingovou komunikáciou**; **odvolanie súhlasu** | |

## Grammar and typography: Slovak differences a Czech-speaking reviewer would miss

- **Rhythmic law (rytmický zákon).** Two long syllables in a row get shortened: *krásny* (✗ *krásný*), *rýchly* (✗ *rýchlý*), *chválime* (✗ *chválíme*), *píšu* (✗ *píšú*). Exceptions that are correct as written: genitive plurals in *-ií* (*rezervácií*, *operácií*, *kancelárií*) and the diphthong *ia* after a long syllable (*rezervácia*). Czech never shortens, so a reviewer reading through Czech won't spot *-ý/-í* after a long vowel.
- **Letters Czech lacks.** *ä* (*päť*, *záväzný*, *zväčša*); *ô* (*stôl*, *môžeš*, *pôvodná cena*); *ľ* (*zľava*, *voľný*, *ďalší*, *používateľ*, *náhľad*, *vyhľadaj*); *ĺ* (*dĺžka*); *ŕ* (*vŕba*; none of this domain's vocabulary uses it, so it should not appear); *dz* (*medzi*, *cudzí*); *dž* (*džús*). No *ě*, *ř*, *ů*: *změna* → *zmena*, *přihlásit* → *prihlásiť*, *stůl* → *stôl*. A missing *ľ* (*zlava*, *vyhladaj*) is the commonest typo in Slovak UIs; search for it.
- **Infinitive ends in -ť**: *uložiť, zrušiť, rezervovať, zaplatiť, prihlásiť sa, skúsiť*. Buttons use the bare infinitive (*Uložiť*, *Zobraziť*, *Stiahnuť*).
- **Reflexive *sa / si*** (Czech *se / si*) sits in second position in the clause: *Nepodarilo sa načítať…*, *Prihlás sa*, *Rezervácia sa nepodarila*, *Vyber si dátum*. ✗ *se* anywhere. Czech *Pospěš si* → *Ponáhľaj sa*.
- **Informal *ty* forms.** Present tense 2nd person ends in *-š*: *môžeš, nájdeš, zaplatíš, dokončíš, uvidíš*. Imperatives differ from Czech in length and vowels: *zadaj, vyber, skús, otvor, napíš* (✗ *napiš*), *pozri* (Czech *podívej se*), *zvoľ* (Czech *zvol*), *pošli*. Possessives *tvoj, tvoja, tvoje*; dative *ti*, accusative *ťa* (*Vraciame ťa do aplikácie*). Formal admin: *Vyberte, Zadajte, Skontrolujte, Skúste*.
- **False friends in this domain.**
  - *voľno* = time off, not a free slot (use *voľné / dostupné*).
  - *pokladňa* = cash desk. The Czech source never says *pokladna*, so don't introduce *pokladňa* for the online checkout.
  - *doklad* = receipt/document; the only tax document is *faktúra*.
  - *platiť* also means "be valid" (*Kód platí 10 minút*), as in Czech. Keep the sentence unambiguous next to prices.
  - *obsadený*: same meaning as Czech, but Czech *vypadá to* → *vyzerá to* (Slovak *vypadnúť* = fall out).
  - *doraziť* = finish off. Czech *platba dorazila* → *platba prišla*.
  - *záložka* = bookmark. A browser tab is *karta*.
  - *zem* = earth/soil. Country is *krajina*.
  - *roľa* = farmland. Role is *rola*.
  - *pokoj* = peace/rest. Room is *miestnosť*.
  - *predávať* = sell. Data transfer is *prenos*.
  - *brzy* doesn't exist in Slovak: *čoskoro*. Czech *dopředu* → *vopred*, *pouze* → *iba / len*, *nejvýše* → *najviac / maximálne*, *kdykoli* → *kedykoľvek*, *na domluvu* → *po dohode*, *pěšky* → *pešo*, *tramvaj* → *električka*, *zdarma* → *zadarmo*, *hledat* → *hľadať*, *zpráva* → *správa* (note: *správa* also means administration; *správca* = manager).
- **Nouns whose gender differs from Czech**: *dátum* (m.; Czech *datum* n.), *tarifa* (f.; Czech *tarif* m.), *dvere* (pl. tantum, *tie dvere*), *téma* (f. in Slovak). Check agreement in adjectives and past participles (*zvolený dátum*, *zvolená tarifa*).
- **Vocalised prepositions** follow Slovak rules, not Czech *ve/se/ze/ke*:
  - *v* → *vo* before *v, f, w* and some clusters: *vo Workspace*, *vo formulári*, *vo vašom účte*.
  - *s* → *so* before *s, z, š, ž* and clusters: *so zľavou*, *so zasadačkou*, *so štítkom*, *so mnou*.
  - *z* → *zo* before *s, z, š, ž* and clusters: *zo zoznamu*, *zo služby*.
  - *k* → *ku* only before *k, g*: *ku kódu*, *ku Google* (but *k dverám*, *k účtu*).
  - Time "in X from now" is *o*, not *za*: *o 5 minút*, *o chvíľu*. Slovak *za* means "within" or "per".
- **One-letter prepositions at line end** (*k, s, v, z, o, u, a, i*): Slovak typography (STN 01 6910) avoids them at line end in print. The Czech catalog has no non-breaking spaces (0 in `cs-CZ.json`), and style guide §9 forbids layout characters by default. So **don't insert NBSP** into catalog strings.
- **Quotation marks**: *„…“* (U+201E … U+201C), as in Czech: `aiAssistantsChatGptStepFind` → *vyhľadaj „Deskohub Workspace“*. Apostrophe: *’*. Definitions: *(ďalej len „VOP“)*. Dashes: keep the Czech dash characters; spaced en dash *–* in new prose.
- **Number words and plurals** (CLDR sk: `one` = 1, `few` = 2–4, `many` = fractions, `other` = 0 and 5+):

  | | one (1) | few (2–4) | many (1,5) | other (0, 5+) |
  |---|---|---|---|---|
  | hodina | 1 hodina | 2 hodiny | 1,5 hodiny | 5 hodín |
  | deň | 1 deň | 2 dni | 1,5 dňa | 5 dní |
  | miesto | 1 miesto | 2 miesta | 1,5 miesta | 5 miest |
  | rezervácia | 1 rezervácia | 2 rezervácie | 1,5 rezervácie | 5 rezervácií |
  | odporúčanie | 1 odporúčanie | 2 odporúčania | 1,5 odporúčania | 5 odporúčaní |

  The `many` text (genitive singular for fractions, usually the `few` text) has no Czech counterpart to follow. Message structure and plural categories: [../catalogs.md](../catalogs.md).
- **Button style**: infinitive, no object when the context is clear: *Uložiť*, *Zrušiť*, *Skúsiť znova*, *Kopírovať kód*. Legal exception: R05.

## Watch keys

Customer catalog (`apps/deskohub-workspace/features/i18n/messages/cs-CZ.json`) unless an area is named.

| Key | Slovak risk | Rule |
|---|---|---|
| `checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton` | Statutory button wording (R05); length over budget | *Objednať s povinnosťou platby* / *Objednať s povinnosťou platby ({amount})*. Check mobile wrap. |
| `checkoutPayConsent`, `checkoutPaymentRetryConsent` | First-person consumer declaration with the withdrawal waiver; three tags | *Súhlasím s dokumentmi <terms>Všeobecné obchodné podmienky</terms>, <operatingRules>Prevádzkový poriadok</operatingRules>.<earlyPerformance> Keďže služba sa začína počas zákonnej lehoty na odstúpenie od zmluvy, výslovne žiadam o jej poskytnutie v rezervovanom termíne a beriem na vedomie, že po úplnom poskytnutí služby moje právo odstúpiť od zmluvy zaniká.</earlyPerformance>* Retry: *Znova potvrdzujem, že súhlasím…*. Czech *lhůta* → *lehota*, *beru* → *beriem*, *mé* → *moje*. Keep the leading space inside `<earlyPerformance>`. Needs legal review. |
| `accountHelpBody` + `accountHelpContact` | `{contact}` is a linked clause (*kontaktuj nás*) placed after a comma | *Ak potrebuješ pomoc s účtom alebo rezerváciami, {contact}.* + *kontaktuj nás*. Keep `{contact}` clause-final. ✗ *Pokiaľ* (Czech *pokud*; Slovak *pokiaľ* = as far as). |
| `accountReferralsHowCompound` | `{duration}` is Intl-formatted (*30 dní*) after a preposition that forces a case | *Za každého pozvaného, ktorý nás navštívil za posledných {duration}, získaš ďalšiu zľavu {discount}. Zľavy sa sčítavajú!* This works because the window is `referralVisitWindowDays = 30` (`features/referrals/program.ts`), and *posledných* + *30 dní* agree for any value ≥ 5. If the window ever drops to 2–4 days, the sentence breaks (*posledné 2 dni*): rephrase with a colon. ✗ *počas posledných {duration}*, ✗ *během*. |
| `checkoutSummaryItemMeetingRoom`, `pricingMeetingRoomProduct`, `reservationValidationMeetingRoomDuration` | `{duration}` / `{durations}` hold the `reservationMeetingRoomDurationHours` plural or *celý deň* | Keep them after a dash, comma or colon (case-neutral): *Zasadacia miestnosť - {duration}*; *…musí byť jedna z týchto možností: {durations}.* |
| `reservationAvailabilityUnavailable` | `{tier}` is a product name that can't inflect | *Rezervácia tarify {tier} v zvolenej konfigurácii nie je {date} dostupná. Skús, prosím, inú ponuku alebo dátum — alebo, ak máš vybranú pracovnú stanicu, inú zostavu monitorov!* (*v zvolenej*, not *vo*). |
| `accountReservationBookedBy`, `accountReservationBookedFor` | Gender (R20) | *Rezervujúca osoba: {name}*; *Pre {name}*. |
| `accountProfileScreenMemberFallback` | Gender (P30) | *Účet vo Workspace*. |
| `accountReferralsHowBenchmark` | Czech one = few = other (*doporučení*); Slovak differs | one *1 odporúčanie*, few *2 odporúčania*, many *1,5 odporúčania* (unreachable but required), other *5 odporúčaní*: *To znamená, že stačí len {count} odporúčaní a máš zľavu viac ako {benchmark}!* |
| `reservationMeetingRoomDurationHours`, `reservationValidationOfficeMaximumDuration` (`hoursPlural`), `reservationOfficeBasePriceLabel`, `checkoutSummaryItemOfficeAccess`, `checkoutSummaryItemOfficeDayCount` (`dayCountPlural`), `reservationOfficeSeatCountOption`, `accountReservationSeats`, `checkoutSummaryItemOfficeSeatCount` | Add `many`; Czech few *dny* → *dni*, *hodin* → *hodín*, *míst* → *miest* | See the plural table. *Rezervácia kancelárie nesmie presiahnuť {hours} hodín.* |
| `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange` (`maxPlural`) | `one` text is fixed *1*; *Zvol* → *Zvoľ* | *Zvoľ 1 deň.* / *Zvoľ 1 až {max} dni.* / *Zvoľ 1 až {max} dní.*; seats *miesto / miesta / miest*. |
| `publicOfferingOfficeUsage` | Plain string with a count: *{hours} hodin* (not a plural message) | Value is a large number in practice (*672 hodín*). Write *{hours} hodín* and flag the key as "needs plural" (style guide §8). Czech *měsíc dopředu* → *mesiac vopred*. |
| Admin plurals where Czech one = few: `admin-cli:adminCliSessionsCount`, `administration:administrationReservationActivityDay`, `administrationReservationActivityYearTotal`, `administrationCustomerListItemSummary`, `administrationCustomerTableReservationCount`, `administrationOperationCount`, `administrationOverviewMoreCustomers`, `administrationReservationListCount`, `discounts:discountsSalesCount`, `email-automations:emailAutomationsFrequencyBannerBody`, `email-campaigns:emailCampaignsAudiencePeriodLast` | Czech *rezervace/relace/operace/akce* are the same for 1 and 2–4; Slovak isn't | one *rezervácia / relácia / operácia / zľavová akcia*, few *-ie*, other *-ií*. Don't copy the Czech one into few. Add `many`. |
| `accountSignInCodeResendCooldown`, `checkoutSummaryDiscountEnds`, `checkoutDiscountCountdownBanner` | Czech *za {seconds} s* / *končí za {remaining}* | Slovak *o*: *Nový e-mail môžeš poslať o {seconds} s*; *Končí o {remaining}*; *Ponáhľaj sa — {discount} končí o {remaining}*. |
| `accountBillingCurrency`, `pricingIntro` | Czech prints *Kč* in prose | *Mena: CZK*; *Ceny v CZK za všetko, čo si môžeš rezervovať online.* |
| `reservationBillingVatIdLabel`, `accounting:accountingInvoiceFormVatId`, `accountAresLookup*` | DIČ vs IČ DPH; the registry is Czech | *IČ DPH (nepovinné)*; *český register firiem*; *Zadaj platné IČO: presne osem číslic so správnou kontrolnou číslicou.* |
| `footerVatStatus`, `invoiceNonVatPayerStatement` | *plátce* → *platiteľ* | *spoločnosť nie je platiteľom DPH*; *Nie sme platiteľmi DPH.* |
| `checkoutDiscountCodeLabel`, `checkoutVoucherLabel` | Three concepts; voucher word | *Zľava, poukážka alebo odporúčací kód*; *Poukážka*. |
| `checkoutStatusLatePaymentReviewContactMessage`, `checkoutStatusFulfillmentFailedContactMessage`, `checkoutStatusPaymentPendingContactMessage` | Customer writes to the venue: formal; *dorazila* trap | *Dobrý deň,* … *vy*; *moja platba prišla až po…*; keep `\n\n` and `{reservationDetails}`. |
| `landingOfferingEvents`, `discounts:discountsSalesTitle`, `administration:administrationTableActions` | Three meanings of *akce* | *podujatia*; *Zľavové akcie*; *Akcie*. |
| `landingLocationTransport`, `workspaceDescription`, `meetingRoomMetadataTitle` | Place-name case endings; tram | *v Libni*, *na Palmovke*, *električky*; *Zasadacia miestnosť Praha 8 na Palmovke*. |
| `marketingPreferencesFormRowDescription`, `ttrpgRoomBarChoiceText`, mobile `signin_error_unavailable`, `signin_error_reauth_storage` | Deskohub inflection | *povolíš Deskohubu zasielať ti…*; *v hernej atmosfére Deskohubu*; *Nepodarilo sa spojiť s Deskohubom.* |
| `checkoutPayProviderHandoff` | Browser tab word; Nexi uninflected | *…na zabezpečenej platobnej stránke Nexi, ktorá sa otvorí na novej karte. … Na tejto karte potom uvidíš stav rezervácie.* |
| `faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales` | Keep *vy* (visitor asks venue) | *Máte súkromné kancelárie?* |
| `contactPhonePlaceholder`, `contactEmailPlaceholder`, `accountSignInEmailPlaceholder` | Real-looking contact data | Phone *+421 900 000 000*; email *jana@example.com*. Never reuse the Czech values. |
| mobile `home_signed_in_as` | Gendered *Prihlásený/á ako* | *Prihlásený účet: {email}* (agrees with *účet*). |
