# Deskohub Workspace glossary: Hindi (`hi-IN`)

Binding Hindi terminology for the customer catalog, administration catalogs, legal documents, customer emails and mobile catalog (Czech → Hindi). It applies together with the shared [style-guide.md](style-guide.md). Where the two disagree, this file wins for `hi-IN`. Concept IDs are defined in [terms.md](terms.md); every ID appears below at least once.

| Surface | Register | Example |
|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | polite **आप** (*आप, आपका/आपकी/आपके, आपको*); never **तुम** or **तू**; warm and plain | “फिर से कोशिश करें।”, “आपकी बुकिंग की पुष्टि हो गई है।” |
| Administration (staff UI, staff-facing copy) | formal **आप**, neutral official tone, shorter sentences, no warmth markers | “ग्राहक चुनें।”, “छूट सहेजी नहीं जा सकी। फिर से कोशिश करें।” |
| Legal documents | formal; mostly third person through defined terms (*प्रदाता*, *ग्राहक*); **आप** only where the Czech text addresses the reader directly | “ग्राहक को … का अधिकार है।”, “आप किसी भी समय सहमति वापस ले सकते हैं।” |

Czech customer copy is informal *ty*. Polite *आप* is a register change, not a mistranslation: convert every *ty* form (zkus, zadej, tvoje, máš) to the *आप* form (कोशिश करें, दर्ज करें, आपका, आपके पास है). Customer and administration use the same pronoun; they differ in tone, not in grammar.

Script: Hindi in Devanagari. Western (Latin) digits only (“2 घंटे”, never “२ घंटे”). Brand and product names, protocol and technical acronyms, and the loanwords the audience reads in Latin stay in Latin: **Wi-Fi**, **email**, **QR**, **PIN**, **VAT**, **CZK**, **IČO**, **DIČ**, **CLI**, **CSV**, **AI**, **MCP**, **TTRPG**, **URL**.

## Key decisions

- **Reservation = बुकिंग** (f.; invariant: “1 बुकिंग”, “5 बुकिंग”, oblique “बुकिंग में”), verb **बुक करना** (“बुक करें”), participle **बुक किया गया / बुक की गई**. It is what Indian booking, travel, cinema and coworking services say to customers. **आरक्षण** sounds like railway or quota language. The same word is the legal defined term **बुकिंग** (L13), so UI and terms match. The admin Dotypos “rezervace stolu” (A09) gets the other root, **टेबल आरक्षण**, so staff never confuse the two.
- **Coworking = कोवर्किंग** (m.; “कोवर्किंग स्पेस” only where Czech names the space). The short Czech “cowork” (P02) maps to the same word: “कोवर्किंग बुक करें”.
- **Meeting room = मीटिंग रूम** (m.) for both *zasedací místnost* and *zasedačka*. Hindi has no natural formal/everyday pair here (“बैठक कक्ष” reads like a government office), so one word everywhere (style guide §1).
- **Passkey = पासकी** (f.; pl. पासकी), as in Google's and Microsoft's Hindi UIs. The door code is **प्रवेश कोड** (X01). The distinction is the noun: *पासकी* vs *कोड*. Never “प्रवेश कुंजी” or “एक्सेस की” for either.
- **Sign in = साइन इन करना** (button “साइन इन करें”, noun **साइन-इन**: “साइन-इन लिंक”, “साइन-इन कोड”). Sign out = **साइन आउट करें**. Forbidden in customer copy: “लॉग इन”, “प्रवेश करें” (= physical entry X05), “लॉगिन करें”.
- **Invoice = इनवॉइस** (m.; pl. इनवॉइस). It is the tax document issued after payment, the word Indian businesses and payment apps use. “बिल” is a request to pay or a restaurant check; “चालान” also means a traffic fine; “बीजक” is unfamiliar. No receipts or credit notes exist: never “रसीद”.
- **IČO / DIČ / DPH** are Czech facts. Keep the Czech acronym as the label core and add a Hindi gloss where a hint fits: **IČO (कंपनी पंजीकरण संख्या)**, **DIČ (VAT पहचान संख्या)**. DPH → **VAT** (the generic name of the tax, Latin). Never the Indian ids GSTIN, PAN, CIN, or “GST”.
- **Voucher = वाउचर** (m.). “गिफ़्ट वाउचर” only where Czech says *dárkový poukaz*.
- **Discount = छूट** (f.); **sale (akce) = ऑफ़र** (m.); **event (akce) = कार्यक्रम** (m.); **actions column = कार्रवाइयाँ** (f. pl.). Three target words for *akce*.
- **Final checkout button (R05) = “ऑर्डर करें और भुगतान करें”** / with amount **“ऑर्डर करें और {amount} का भुगतान करें”**. The button must name the payment obligation (EU “order with obligation to pay”). Never “जारी रखें”, “पुष्टि करें”, “आगे बढ़ें” or “हो गया”.
- **Legal parties:** Poskytovatel → **प्रदाता** (full form at definition: “सेवा प्रदाता”); Klient → **ग्राहक**; Spotřebitel → **उपभोक्ता**; Provozovatel → **संचालक**; Uživatel → **उपयोगकर्ता**. Devanagari has no capitals: mark each defined term once at its definition with bold quotation (“**प्रदाता**”) as the Czech defines it, then use the exact same word every time. Never swap in a synonym (*सेवाप्रदाता*, *क्लाइंट*, *खरीदार*).
- **Gender-neutral fallbacks:** Hindi verbs agree with the subject's gender in many tenses (“आप आए/आईं”, “आप कर सकते/सकती हैं”). The Czech never genders the reader, so use these constructions, in this order: (1) imperative / polite subjunctive (“चुनें”, “दर्ज करें”); (2) dative “आपको …” (“आपको email मिलेगा”); (3) ergative perfective “आपने … किया” (verb agrees with the object); (4) passive or impersonal (“बुक किया जा सकता है”, “… उपलब्ध है”); (5) a noun phrase or label (“बुक करने वाले: {name}”). Only where none of these reads naturally may the polite masculine plural (“आप … कर सकते हैं”) stand, as Hindi's unmarked generic form; never slash or bracket forms (“सकते/सकती”, “गए(ईं)”). P30 “Člen Workspace” → **“Workspace प्रोफ़ाइल”**. R20 “Rezervoval(a) {name}” → **“बुक करने वाले: {name}”** (honorific plural participle noun, label + colon, so nothing agrees with {name}); its pair “Pro {name}” → **“किसके लिए: {name}”**.

## Glossary

Gender: m./f.; pl. = plural form. “Forbidden” lists wrong or competing forms, including Urdu-Persian formalisms that read as off-register and over-Sanskritised coinages a customer would not recognise.

### P · Products and spaces

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| P01, P02 | coworking; cowork | coworking; cowork | **कोवर्किंग** (m.) | CTA “Rezervovat cowork” → “कोवर्किंग बुक करें”. Forbidden: “को-वर्किंग”, “सह-कार्य”, Latin “cowork” in Hindi text. |
| P03 | open space / otevřený prostor; Open-space místo | open space | **ओपन स्पेस** (m.); “ओपन स्पेस में सीट” | Product title “Sdílené místo” (EN “Open Space”) → **“साझा सीट”** everywhere (titles, CTAs, prose); “sdílený stůl” → “साझा डेस्क”. Forbidden: “खुला स्थान” (= an empty plot), “साझा स्पेस में सीट”. |
| P04, P05 | zasedací místnost; zasedačka | meeting room | **मीटिंग रूम** (m.) | One word for both (Key decisions). CTA “मीटिंग रूम बुक करें”. Forbidden: “बैठक कक्ष”, “कॉन्फ़्रेंस हॉल”, “सभाकक्ष”. |
| P06, P07 | kancelář; soukromá kancelář | office; private office | **ऑफ़िस** (m.); **निजी ऑफ़िस** | Forbidden: “दफ़्तर” (dated), “कार्यालय” (government office), “प्राइवेट ऑफ़िस” (mixing). |
| P08 | pracovní stanice | workstation | **वर्कस्टेशन** (m.) | The Profi desk with monitors. Keep it distinct from “सीट” and “डेस्क”. Forbidden: “कार्य-स्टेशन”. |
| P09, P11, R21 | vyhrazené místo; místo; přiřazené místo | reserved desk; spot/seat; assigned desk | **तय डेस्क** (m.; “दिन भर के लिए तय डेस्क” at first mention); **सीट** (f.; pl. सीटें); **निर्धारित सीट** | “सीट” is the bookable seat and the count noun (1 सीट / 2 सीटें). Forbidden: “आरक्षित डेस्क” (आरक्षण root is A09), “कुर्सी”, “जगह” for the bookable unit. |
| P10 | stůl | desk / table | **डेस्क** (m.) customer; **टेबल** (f.) admin Dotypos (A09) | “खाली डेस्क”. Forbidden: “मेज़”. |
| P12, P14 | místnost; TTRPG místnost | room; TTRPG room | **रूम** (m.) in product names, **कमरा** (m.) in prose; **TTRPG रूम** | TTRPG stays Latin. Forbidden: “परिसर” for a room (reserved for legal L06), “हॉल”. |
| P13 | prostor / pracovní prostor | space / workspace (generic) | **जगह** (f.); **काम करने की जगह** | Lowercase generic, never the brand. Forbidden: “वर्कस्पेस” for the generic noun. |
| P15, P16 | kampaň (TTRPG); one-shot | campaign; one-shot | **कैंपेन** (m.; “गेम कैंपेन” at first mention); **वन-शॉट** (m.) | The role-playing sense, as Indian TTRPG players say it. First mention of “वन-शॉट” may add “(एक ही सत्र का एडवेंचर)”. The email campaign is A24 (other word). Forbidden: “अभियान” here. |
| P17 | bar (Deskohub Bar) | bar | **बार** (m.); “Deskohub बार”, “Deskohub बार में” | Czech inflects “Deskohub Baru”, so *Bar* is generic: translate it. |
| P18, X09 | provozovna; adresa provozovny | venue / premises; venue address | **स्थान** (m.); **स्थान का पता** | Footer label “स्थान का पता”. Forbidden: “परिसर” (legal L06), “शाखा”, “दुकान”. |
| P19 | nabídka | offering / options | **विकल्प** (m. pl.) | Label over the tier picker: “विकल्प”. Forbidden: “ऑफ़र” (= sale D06), “प्रस्ताव”. |
| P20, L10 | tarif; Tarif | tier / plan; Tariff | **प्लान** (m.); legal defined term **प्लान** | “Basic प्लान के सभी लाभ”. Forbidden: “टैरिफ़”, “पैकेज”, “स्तर”. |
| P21 | výhody | perks | **लाभ** (m., pl. same) | Forbidden: “फ़ायदे” (mixing), “बेनिफ़िट्स”, “बोनस”. |
| P22, P23, P24 | Basic Day Pass; Cowork Plus; Profi Workstation; Basic | product names | **Basic Day Pass**, **Cowork Plus**, **Profi Workstation**, **Basic** | Never translate or transliterate. Attach grammar to “प्लान”: “Cowork Plus प्लान का”. Don't invent “डे पास”. |
| P25 | monitorový setup; profi setup; sestava monitorů | monitor setup | **मॉनिटर सेटअप** (m.); perk “प्रोफ़ेशनल मॉनिटर सेटअप” | Forbidden: “मॉनिटर व्यवस्था”. |
| P26 | batch brew káva | batch brew coffee | **batch brew फ़िल्टर कॉफ़ी** | “batch brew” stays a Latin loan. Forbidden: “बैच ब्रू”. |
| P27 | káva zdarma | free coffee | **मुफ़्त कॉफ़ी** | Forbidden: “फ़्री कॉफ़ी”, “निःशुल्क कॉफ़ी” (customer copy). Legal may say “निःशुल्क”. |
| P28 | Wi-Fi | Wi-Fi | **Wi-Fi** (m.) | “Wi-Fi पासवर्ड”. Forbidden: “वाई-फ़ाई”, “WiFi”. |
| P29 | monitor | monitor | **मॉनिटर** (m.) | Forbidden: “स्क्रीन”, “डिस्प्ले” for the device. |
| P30 | Člen Workspace | Workspace member | **Workspace प्रोफ़ाइल** | Fallback display name (`accountProfileScreenMemberFallback`). Forbidden: “Workspace सदस्य” (masc. agreement follows), “सदस्य/सदस्या”. |
| P31, P33 | Deskohub Workspace; Deskohub | brand | **Deskohub Workspace**; **Deskohub** | Latin, exact capitalisation. Hindi postpositions attach after a space: “Deskohub Workspace में”, “Deskohub की ओर से”. Forbidden: “डेस्कोहब”, “Deskohub-में”. |
| P32 | Workspace (brand) | Workspace | **Workspace** | Short brand: “Workspace में बुकिंग”. Lowercase generic “workspace” = P13. |

### R · Reservation

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| R01, L13 | rezervace; Rezervace (legal) | reservation; Booking (legal EN) | **बुकिंग** (f., invariant); legal **बुकिंग** | See Key decisions. Forbidden: “आरक्षण” (reserved for A09), “रिज़र्वेशन”. |
| R02, R03 | rezervovat; rezervační | book / reserve; booking (adj.) | **बुक करना** (“बुक करें”); adj. → “बुकिंग”: “बुकिंग लिंक”, “बुकिंग फ़ॉर्म” | CTA “बुक करें”. Forbidden: “आरक्षित करें” (customer), “रिज़र्व करें”. |
| R04, A10 | objednávka; Objednávky | order; orders | **ऑर्डर** (m.; pl. ऑर्डर) | “ऑर्डर नंबर”. Forbidden: “आदेश” (= command), “क्रयादेश”. |
| R05 | Objednat a zaplatit | Order and pay | **ऑर्डर करें और भुगतान करें**; with amount **ऑर्डर करें और {amount} का भुगतान करें** | Legally required final button; must name the payment. Forbidden: “जारी रखें”, “खरीदें”, “पुष्टि करें”. |
| R06 | poptávka | inquiry | **पूछताछ** (f.) | Contact-form request for offices/events. Forbidden: “अनुरोध” (use for *žádost*), “इन्क्वायरी”. |
| R07, R08 | termín; datum | date / time slot; date | **तारीख़** (f.) or **समय** (m.) by context; label “तारीख़” | “बुक किए गए समय पर”, “तारीख़ चुनें”. Forbidden: “दिनांक” in customer copy (fine in legal and invoices), “स्लॉट”. |
| R09, R10 | začátek; konec | start; end | **शुरुआत**; **समाप्ति** | Labels. In running text “{startsAt} से {endsAt} तक”. Forbidden: “स्टार्ट”, “अंत” (as label). |
| R11 | délka | duration | **अवधि** (f.) | Forbidden: “लंबाई” (physical length), “समयावधि” (mixing). |
| R12, R13 | hodina; den | hour; day | **घंटा** (m.; pl. घंटे) · **दिन** (m., pl. same) | Plural sets: 1 घंटा / 2 घंटे; 1 दिन / 5 दिन. Abbrev. “घं.”, “मि.”, “से.” only where Czech abbreviates. Forbidden: “घण्टा”, “रोज़”. |
| R14, R15, R16 | dostupnost; volný / volno; obsazeno | availability; available; booked / taken | **उपलब्धता** (f.); **उपलब्ध** / **खाली**; **भरा हुआ** (“यह समय भरा हुआ है”) | “उपलब्धता की जाँच नहीं हो सकी।” Forbidden: “फ़्री” for *volný* (= free of charge), “बुक्ड”. |
| R17, S03 | potvrzení; potvrzeno | confirmation; confirmed | **पुष्टि** (f.); **पुष्टि हो गई** / label **पुष्ट** | “पुष्टि वाला email”, “बुकिंग की पुष्टि हो गई”. Forbidden: “कन्फ़र्मेशन”, “स्वीकृत” (= approved, A48). |
| R18, A52, L16 | zrušení / zrušit; Zrušit (dialog); Storno Rezervace | cancellation / cancel; Booking Cancellation | **रद्द करना** / noun **रद्दीकरण** (m.); button “रद्द करें”; legal heading “बुकिंग का रद्दीकरण” | Forbidden: “कैंसल”, “निरस्त” (reserved for A12), “स्टॉर्नो”. |
| R19 | změna | change | **बदलाव** (m.) / **बदलना** | “कीमत बदल गई है।” Forbidden: “परिवर्तन” in customer copy (fine in legal), “संशोधन”. |
| R20 | Rezervoval(a) {name} | Booked by {name} | **बुक करने वाले: {name}** | Gender-neutral label; nothing agrees with {name}. Pair `accountReservationBookedFor` “Pro {name}” → “किसके लिए: {name}”. Forbidden: “{name} ने बुक किया/की”, “बुककर्ता”. |
| R22, R23 | platnost / platí; vypršet | validity / is valid; expire | **वैधता** (f.) / **मान्य है**; **समाप्त होना** (“लिंक की वैधता समाप्त हो गई है”) | Documents/laws: “लागू”. Forbidden: “एक्सपायर”, “अवधि-पार” except A22. |

### K · Payment and billing

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| K01, A13 | platba; Platba nedokončena | payment; payment abandoned | **भुगतान** (m.) for both the act and one transaction; “भुगतान पूरा नहीं हुआ” | “भुगतान पर जाएँ”, “Nexi भुगतान …”. Forbidden: “पेमेंट” (mixing), “अदायगी”. |
| K02, K03 | zaplatit; zaplaceno | pay; paid | **भुगतान करना**; **भुगतान हो गया** / label **भुगतान किया गया** | “बुकिंग का भुगतान करें”. “कार्ड से भुगतान करें”. Forbidden: “पे करें”, “चुकाना” (= settle a debt). |
| K04, K05 | platební karta / karta; platební metoda | payment card; payment method | **पेमेंट कार्ड** (m.), short **कार्ड**; **भुगतान का तरीका** (m.) | Forbidden: “क्रेडिट कार्ड” unless Czech says so, “भुगतान विधि”. |
| K06, K07, K08 | platební brána; platební odkaz; Nexi | payment gateway; payment link; Nexi | **पेमेंट गेटवे** (m.); **भुगतान लिंक** (m.); **Nexi** | Customer copy: “Nexi का सुरक्षित भुगतान पेज”. Forbidden: “नेक्सी”, “भुगतान द्वार”. |
| K09, K10 | cena; základní cena | price; base price | **कीमत** (f.); **मूल कीमत** | Forbidden: “दाम” (colloquial), “मूल्य” in customer copy (legal L11 only). |
| K11, L11 | ceník; Ceník (legal) | price list; Price List | UI page/nav **कीमतें**; legal defined term **मूल्य सूची** | Legal first mention may add “(वेबसाइट का “कीमतें” पेज)”. Forbidden: “रेट लिस्ट”, “प्राइस लिस्ट”. |
| K12 | částka | amount | **राशि** (f.) | Forbidden: “रकम”, “मात्रा” (= quantity). |
| K13 | celkem | total | **कुल** | Invoice/summary label. Forbidden: “टोटल”, “योग”. |
| K14, K15 | měna; Kč | currency; CZK | **मुद्रा** (f.); prose **CZK** | Money always CZK via `Intl`. “CZK में कीमतें”. Forbidden: “Kč”, “क्राउन”, “कोरुना”, “₹”, “रुपये”, EUR. |
| K16 | faktura | invoice | **इनवॉइस** (m.) | See Key decisions. Forbidden: “बिल”, “चालान”, “बीजक”, “रसीद”. |
| K17 | fakturační údaje | billing details | **बिलिंग विवरण** (m.) | Section title. Forbidden: “बैंक विवरण”, “इनवॉइस डिटेल्स”. |
| K18, K19 | DPH; neplátce DPH | VAT; not a VAT payer | **VAT**; **VAT के लिए पंजीकृत नहीं** | Footer “कंपनी VAT के लिए पंजीकृत नहीं है”. It is Czech VAT: never GST. |
| K20 | IČO | company ID number | **IČO (कंपनी पंजीकरण संख्या)**; form label “IČO” with that hint | Value never changes. Forbidden: “CIN”, “GSTIN”, “PAN”. |
| K21 | DIČ | VAT ID | **DIČ (VAT पहचान संख्या)** | `reservationBillingVatIdLabel` “DIČ (वैकल्पिक)”. Forbidden: “GSTIN”, “TIN”. |
| K22 | firma / společnost | company | **कंपनी** (f.) | One word for both Czech terms. “Desktechub s.r.o.” stays. Forbidden: “फ़र्म” (mixing). |
| K23, K24 | PSČ; ulice | postal code; street | **पोस्टल कोड**; **सड़क** | Labels only; Czech address values stay as written. Forbidden: “पिन कोड” (collides with PIN X02), “ZIP”. |
| K25 | platba po vypršení blokace rezervace | payment after the reservation hold expired | “**बुकिंग की अस्थायी होल्ड** समाप्त होने के बाद भुगतान” | `checkoutStatusLatePaymentReviewContactMessage` is a pre-filled email the customer sends: first person, “नमस्ते”, polite to the venue. Forbidden: “ब्लॉक”, “लॉक”. |

### D · Discounts and referrals

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| D01 | sleva | discount | **छूट** (f.) | “20 % छूट” (the number comes formatted). Forbidden: “डिस्काउंट”, “रियायत”. |
| D02 | slevový kód | discount code | **छूट कोड** (m.) | Forbidden: “प्रोमो कोड”, “कूपन”. |
| D03 | kód | code | **कोड** (m.) | Generic. |
| D04, A57 | poukaz; propagační poukaz | voucher; promotional voucher | **वाउचर** (m.); **प्रमोशनल वाउचर** | “गिफ़्ट वाउचर” only for *dárkový poukaz*. Forbidden: “कूपन”, “टोकन”. |
| D05 | Sleva, poukaz nebo doporučovací kód | Discount, voucher or referral code | **छूट, वाउचर या रेफ़रल कोड** | Three distinct things; keep all three nouns. |
| D06, A08 | akce (sale); Akce (discounts area) | sale / promotion | **ऑफ़र** (m.); admin area “ऑफ़र” | Sale banners, `discounts:discountsSalesTitle`. Forbidden: “सेल” (clearance), “प्रचार”. |
| D07 | akce (event) | event | **कार्यक्रम** (m.; pl. same) | “कॉर्पोरेट कार्यक्रम और वर्कशॉप” (`landingOfferingEvents`, GTC §14). Forbidden: “इवेंट”, “ऑफ़र”, “घटना”. |
| D08, D09, D10 | doporučení; doporučovací kód; doporučovací odkaz | referral; referral code; referral link | **रेफ़रल** (m.; pl. same); **रेफ़रल कोड**; **रेफ़रल लिंक** | Invitee *pozvaný* → “आमंत्रित व्यक्ति” (gender-neutral). Section `accountSectionReferrals` → “रेफ़रल”. Where the count means qualifying referrals (`accountReferralsCountSummary`, `accountReferralsHowBenchmark`), say “मान्य रेफ़रल”. Forbidden: “सिफ़ारिश”, “अनुशंसा”, “रेफ़रेंस”. |
| D11 | první rezervace | first reservation | **पहली बुकिंग** | Referral eligibility condition. |

### U · Account and authentication

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| U01, U15 | účet; zákaznický účet | account; customer account | **खाता** (m.); **ग्राहक खाता** | “अपने Deskohub Workspace खाते में”. Forbidden: “अकाउंट” (mixing), “बैंक खाता” sense. |
| U02 | profil | profile | **प्रोफ़ाइल** (f.) | Forbidden: “परिचय”. |
| U03 | přihlásit se / přihlášení | sign in | **साइन इन करना**; noun **साइन-इन** | “पासकी से साइन इन करें”, “खाते में साइन इन करें”. Forbidden: “लॉग इन”, “प्रवेश करें”. |
| U04 | odhlásit se | sign out | **साइन आउट करें** | Forbidden: “लॉग आउट”, “बाहर निकलें”. |
| U05, U06 | přihlašovací odkaz; přihlašovací kód | sign-in link; sign-in code | **साइन-इन लिंक** (m.); **साइन-इन कोड** (m.) | Subject `accountMagicLinkEmailSubject` “Deskohub Workspace के लिए आपका साइन-इन लिंक”. Forbidden: “मैजिक लिंक”, “OTP”. |
| U07 | přístupový klíč | passkey | **पासकी** (f.) | See Key decisions. Forbidden: “प्रवेश कुंजी”, “पास-की”, Latin “passkey”. |
| U08, U09 | správce hesel; heslo | password manager; password | **पासवर्ड मैनेजर** (m.); **पासवर्ड** (m.) | “Wi-Fi पासवर्ड”. Forbidden: “कूटशब्द”. |
| U10, A47 | relace; Relace CLI | session; CLI session | **सेशन** (m.); “CLI सेशन” | Forbidden: “सत्र” in UI (legal may use it), “सेसन”. |
| U11, U12 | zařízení; prohlížeč | device; browser | **डिवाइस** (m.); **ब्राउज़र** (m.) | Forbidden: “उपकरण”, “यंत्र”. |
| U13 | ověření / ověřit | verification / verify | **पुष्टि करना** (email address); **जाँच / जाँचना** (checks, e.g. availability, IČO lookup) | “अपने email पते की पुष्टि करें।” Forbidden: “वेरिफ़ाई”, “सत्यापन” in customer copy (fine in legal). |
| U14 | e-mail | email | **email** (m., Latin); **email पता** (the address) | Field label “email”. Example value “priya@example.com”. Forbidden: “ईमेल”, “ई-मेल”, “मेल”. Sentence-initial: “Email …” (capital E). |
| U16, A06, L03 | zákazník; zákazník (admin); Klient (legal) | customer; Client | **ग्राहक** (m.); legal defined term **ग्राहक** | Generic; in customer prose prefer “आप”, “व्यक्ति”. Forbidden: “कस्टमर”, “क्लाइंट” (= software client A50), “खरीदार” (reserved for A20). |
| U17 | telefon | phone | **फ़ोन** (m.) | Placeholder example “+91 90000 00000”. |

### X · Access and venue

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| X01, A01 | přístupový kód | access code | **प्रवेश कोड** (m.) | Door code for a reservation, staff-created in admin (`access-codes:*`). Forbidden: “पासकी” (= passkey), “दरवाज़े का पासवर्ड”. |
| X02, L12 | PIN / PIN kód; Přístupový PIN kód | PIN; Access PIN Code | **PIN** (m.), **PIN कोड**; legal **प्रवेश PIN कोड** | Latin PIN. Forbidden: “पिन”, “पिन कोड”. |
| X03, X04 | dveře; klávesnice | door; keypad | **दरवाज़ा** (m.); **कीपैड** (m.) | “मुख्य दरवाज़े के पास कीपैड पर PIN दर्ज करें।” Forbidden: “कीबोर्ड”, “इंटरकॉम”. |
| X05 | vstup | entry / entrance | **प्रवेश** (m.) | Physical entry. Forbidden: “एंट्री”, “प्रवेश करें” for sign-in. |
| X06, A15 | přístup; Přístup ke dveřím | access; door access | **पहुँच** (f.); “दरवाज़े तक पहुँच” | Generic (data, door, account). Forbidden: “एक्सेस”. |
| X07, X08 | otevírací doba; Otevřeno nonstop | opening hours; open 24/7 | **खुलने का समय** (m.); **24 घंटे खुला** | Forbidden: “नॉन-स्टॉप”, “कार्य समय”. |
| X10, X12 | Palmovka; Libeň | Palmovka; Libeň | **पाल्मोव्का** (f.), **लिबेन** (m.) | As uk-UA X10: place names in Devanagari in prose; in directions keys (`landingLocationTransport`, `faqAnswerTransport`) add the Latin signage form once: “पाल्मोव्का मेट्रो स्टेशन (Palmovka, लाइन B)”. Street names and postal addresses stay Latin and Czech (Turnovská 430/10, 180 00 Praha 8 – Libeň). |
| X11 | Praha | Prague | **प्राग** (m.) | Prose and titles “प्राग 8”; postal addresses keep “Praha 8”. Forbidden: “प्राहा”. |
| X13 | metro | metro | **मेट्रो** (f.) | “मेट्रो से दो मिनट”. |
| X14 | Google Maps | Google Maps | **Google Maps** | “Google Maps में रास्ता खोलें”. |
| X15 | kontakt | contact | **संपर्क** (nav); “हमसे संपर्क करें” | Forbidden: “कॉन्टैक्ट”. |

### G · Consent and privacy

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| G01, L29 | souhlas; odvolání souhlasu | consent; withdrawal of consent | **सहमति** (f.); **सहमति वापस लेना** | Forbidden: “अनुमति” (permission), “कंसेंट”. |
| G02, G03, L28 | marketingový souhlas; marketingová sdělení; Souhlas s marketingovou komunikací | marketing consent; marketing messages; Marketing Communications Consent | **मार्केटिंग संदेशों के लिए सहमति**; **मार्केटिंग संदेश** (m. pl.); title **मार्केटिंग संदेशों के लिए सहमति** | Forbidden: “स्पैम”, “विज्ञापन” for the consent object. |
| G04, G07, L30 | cookies; nastavení cookies; Zásady používání cookies | cookies; cookie settings; Cookie Policy | **कुकीज़** (f. pl.; sg. कुकी); **कुकी सेटिंग**; title **कुकी नीति** | Cookie name `cc_cookie` untouched. Forbidden: “बिस्कुट”, Latin “cookies”. |
| G05, G06 | nezbytné cookies; analytické a marketingové cookies | necessary; analytics and marketing cookies | **ज़रूरी कुकीज़**; **एनालिटिक्स और मार्केटिंग कुकीज़** | UI (banner, settings) says **ज़रूरी**; legal documents say **आवश्यक**. Never mix within one surface. |
| G08, L24 | osobní údaje; zpracování osobních údajů | personal data; processing of personal data | **व्यक्तिगत डेटा** (m.); **व्यक्तिगत डेटा की प्रोसेसिंग** (UI) / **व्यक्तिगत डेटा का प्रसंस्करण** (legal) | GDPR terms. Forbidden: “निजी जानकारी” for the defined concept. |
| G09, L22 | soukromí; Zásady ochrany osobních údajů | privacy; Privacy Policy | **गोपनीयता** (f.); title **गोपनीयता नीति** | Forbidden: “प्राइवेसी”, “निजता” (mixing). |

### S · Status and errors

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| S01, S02 | stav; čeká | status; pending | **स्थिति** (f.); **लंबित** (“भुगतान लंबित है”) | Forbidden: “स्टेटस”, “पेंडिंग”. |
| S04 | Zkusit znovu; Zkus to znovu | try again | button **फिर से कोशिश करें**; sentence **फिर से कोशिश करें।** | Forbidden: “दोबारा प्रयास करें” (mixing), “पुनः प्रयास करें”. |
| S05 | nepodařilo se | could not | **… नहीं हो सका / नहीं की जा सकी** (passive/intransitive, gender of the object) | “बुकिंग लोड नहीं की जा सकी।” Forbidden: “असफल रहा” as a lead-in, “त्रुटि:”. |
| S06 | načítání / načíst; Načítáme | loading / load | **लोड हो रहा है…**; verb **लोड करना** | Ellipsis character “…”. Forbidden: “प्रतीक्षा करें…” for loading. |
| S07, S08 | podpora; pomoc | support; help | **सहायता टीम** (f.) / **सहायता**; **मदद** (f.) | Forbidden: “सपोर्ट”, “हेल्प”. |
| S09 | neplatný | invalid | **अमान्य** (codes, links, sessions); **गलत** (typed input format: “IČO का फ़ॉर्मेट गलत है”) | Forbidden: “इनवैलिड”. |

### I · AI assistants

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| I01 | AI asistent | AI assistant | **AI असिस्टेंट** (m.) | Czech never says “agent” in UI. Forbidden: “AI एजेंट”, “बॉट”, “कृत्रिम बुद्धि सहायक”. |
| I02 | konektor | connector | **कनेक्टर** (m.) | Claude custom connector; follow Claude's hi UI label if it differs. |
| I03 | Aplikace (ChatGPT menu); aplikace | Apps; app | ChatGPT menu: **use ChatGPT's own hi label** (default “ऐप्स”); generic **ऐप** (m.) | Forbidden: “एप्लिकेशन”, “अनुप्रयोग”. |
| I04, I05 | ChatGPT / Claude; MCP | ChatGPT / Claude; MCP | **ChatGPT**, **Claude**, **MCP** | Latin: “ChatGPT में”, “MCP प्रोटोकॉल के ज़रिए”. Forbidden: “चैटजीपीटी”, “क्लॉड”. |

### M · Mobile app

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| M01, M02 | aktualizace; restartovat | update; restart | **अपडेट** (m.); **रीस्टार्ट करें** | `update_ready_restart` “रीस्टार्ट करें”. Forbidden: “अद्यतन”, “पुनः आरंभ”. |
| M03 | vrátit se do aplikace | return to the app | **ऐप पर वापस जाना** | `signin_returning_to_app` “आपको ऐप पर वापस ले जा रहे हैं…” (the verb agrees with “हम”, not the reader). |

### A · Administration

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| A02 | administrace | administration | **प्रशासन** (m.) | Nav/shell name. Forbidden: “एडमिन पैनल”, “एडमिन”. |
| A03, A04 | administrátor; role administrátora | administrator; administrator role | **व्यवस्थापक** (m.); **व्यवस्थापक की भूमिका** | Prefer role phrasing over the person noun: “व्यवस्थापक की भूमिका दें”. Forbidden: “एडमिन”, “प्रशासक” (mixing). |
| A05, A49 | udělit / odebrat roli; odvolat | grant / revoke role; revoke | **भूमिका देना** / **भूमिका वापस लेना**; **वापस लें** (session) | English uses “revoke” for both; one Hindi verb. Forbidden: “छीनें”, “भूमिका हटाएँ”, “निरस्त करें” (A12). |
| A07 | Akce (table column) | actions | **कार्रवाइयाँ** (f. pl.) | Not a sale (D06) and not an event (D07). Forbidden: “ऑफ़र”, “क्रियाएँ”. |
| A09 | rezervace stolu | booking (Dotypos table booking) | **टेबल आरक्षण** (m.) | Must stay distinct from R01 “बुकिंग”: “Dotypos में टेबल आरक्षण”. Forbidden: “टेबल बुकिंग”. |
| A11 | operace | operations | **ऑपरेशन** (m. pl.) | Nexi payment operations. Forbidden: “लेन-देन” (mixing with K01). |
| A12 | Storno | void | **निरस्तीकरण** (m.); verb **निरस्त करना** | Payment-provider void, not a reservation cancellation (R18). Forbidden: “रद्दीकरण”, “रिफ़ंड” (= refund, “धनवापसी”). |
| A14 | aktivita rezervací | reservation activity | **बुकिंग गतिविधि** | Calendar heatmap title. |
| A16, A17, A54 | filtry; stránkování; další / předchozí | filters; pagination; next / previous | **फ़िल्टर**; landmark **पेज नेविगेशन**; **अगला** / **पिछला** (पेज) | Buttons “फ़िल्टर लागू करें”, “रीसेट करें”. |
| A18 | drobečková navigace | breadcrumb | **नेविगेशन पथ** (m.) | Landmark label. Forbidden: “ब्रेडक्रंब”. |
| A19 | export | export | **एक्सपोर्ट** (m.); verb **एक्सपोर्ट करें** | “CSV में एक्सपोर्ट करें”. Forbidden: “निर्यात” (trade export). |
| A20 | Odběratel | customer (invoice party) | **खरीदार** (m.) | Invoice-form heading. Issuer side: “विक्रेता”. Forbidden: “प्राप्तकर्ता” (reserved for A27). |
| A21 | Položky | line items | **मदें** (f. pl.; sg. मद) | Forbidden: “आइटम”, “पंक्तियाँ”. |
| A22 | datum splatnosti; po splatnosti; k úhradě | due date; overdue; due | **देय तिथि**; **देय तिथि बीत गई** / badge **अतिदेय**; **देय राशि** | Forbidden: “ड्यू डेट”, “बकाया” (mixing). |
| A23 | variabilní symbol | variable symbol | **वेरिएबल सिंबल (VS)** | Czech bank payment reference. First mention: “वेरिएबल सिंबल (VS, चेक बैंकों में भुगतान की पहचान संख्या)”. Forbidden: “परिवर्तनशील प्रतीक”. |
| A24 | kampaň | campaign (email) | **अभियान** (m.) | Other word than P15. “email अभियान” only where Czech says e-mailová. Forbidden: “कैंपेन” here. |
| A25, A26, A27 | okruh příjemců; uložené publikum; příjemce | audience; saved audience; recipient | **ऑडियंस** (f.); **सहेजी गई ऑडियंस**; **प्राप्तकर्ता** (m.) | One word for both Czech audience terms. Forbidden: “दर्शक”, “सेगमेंट” (mixing). |
| A28 | automatizace; automatická kampaň | automation; automated campaign | **ऑटोमेशन** (m.); **स्वचालित अभियान** | Forbidden: “फ़्लो”. |
| A29, A30 | zkušební běh; běh | dry run; run | **टेस्ट रन**; **रन** (m.) | One customer's pass through an automation. Forbidden: “परीक्षण”, “लॉन्च” (A31). |
| A31, A32 | spuštění; spouštěcí událost | fire (scheduled start); trigger | **शुरुआत** (f.; “अगली शुरुआतें”); **ट्रिगर इवेंट** (m.) | Forbidden: “फ़ायर”. |
| A33, A34 | krok; podmínka | step; condition | **चरण** (m.); **शर्त** (f.) | Flow builder. Forbidden: “स्टेप”, “नियम” (for podmínka). |
| A35, A36, A37 | vlastnost zákazníka; slevová skupina; štítky v Dotyposu | customer attribute; discount group; Dotypos tags | **ग्राहक गुण** (m.); **छूट समूह**; **Dotypos टैग** | Forbidden: “एट्रिब्यूट”, “लेबल”. |
| A38 | potvrzovací kód | confirmation code | **पुष्टि कोड** (m.) | Typed to confirm a send. Distinct from U06 “साइन-इन कोड”. |
| A39, A40 | předmět; text náhledu | subject; preheader | **विषय** (m.); **प्रीव्यू टेक्स्ट** (m.) | Email editor labels. Forbidden: “सब्जेक्ट”, “प्रीहेडर”. |
| A41 | šablona | template | **टेम्पलेट** (m.) | Forbidden: “साँचा”. |
| A42 | účel | purpose | **उद्देश्य** (m.) | Marketing vs operational. Forbidden: “लक्ष्य” (goal). |
| A43, A44 | překlad; zveřejnění | translation; publishing | **अनुवाद** (m.); **प्रकाशन** (m.) / **प्रकाशित करें** | Forbidden: “पब्लिश करें”. |
| A45, A46 | archivovat; smazat | archive; delete | **संग्रहित करें**; **हटाएँ** | Forbidden: “आर्काइव करें”, “डिलीट करें”, “मिटाएँ”. |
| A48 | schválit | approve | **स्वीकृत करें** | CLI sign-in approval. Forbidden: “अप्रूव करें”, “मंज़ूर करें”. |
| A50, A51 | klient (CLI); sestavení | client (software); build | **क्लाइंट प्रोग्राम** (m.); **बिल्ड** (m.) | Not the legal party “ग्राहक”. |
| A53 | uložit / vytvořit | save / create | **सहेजें** / **बनाएँ** | Polite-imperative buttons. Forbidden: “सेव करें”, “क्रिएट करें”. |
| A55 | název / jméno / příjmení | name / first name / last name | **नाम** (things and people) / **पहला नाम** / **उपनाम** | Forbidden: “सरनेम”, “कुलनाम”. |
| A56 | nepovinné | optional | **वैकल्पिक** | Field suffix “(वैकल्पिक)”. Forbidden: “ऑप्शनल”. |

### L · Legal documents

| ID(s) | Czech | English | Hindi | Notes / forbidden alternatives |
|---|---|---|---|---|
| L01 | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | **सामान्य नियम और शर्तें**; defined short form **“नियम और शर्तें”** | Also the checkout link text in `checkoutPayConsent`. Don't coin an abbreviation. Forbidden: “उपयोग की शर्तें”, “सेवा शर्तें”. |
| L02 | Poskytovatel | Provider | **प्रदाता** (m.; full “सेवा प्रदाता” at definition) | Forbidden: “आपूर्तिकर्ता”, “विक्रेता”, “प्रोवाइडर”. |
| L04 | Spotřebitel | Consumer | **उपभोक्ता** (m.) | Statutory consumer under Czech law; never cite the Indian Consumer Protection Act. |
| L05 | Smlouva | Contract | **अनुबंध** (m.) | Forbidden: “करार”, “समझौता” (for this defined term), “कॉन्ट्रैक्ट”. |
| L06, L08 | Prostory; Sdílený pracovní prostor | Premises; shared workspace | **परिसर** (m.); **साझा कार्यस्थल** | “परिसर” only as the legal defined term. |
| L07 | Služby | Services | **सेवाएँ** (f. pl.) | Defined term. |
| L09 | Provozní řád | House Rules | **परिसर नियमावली** (f.) | Also the `<operatingRules>` link text in checkout. Forbidden: “घर के नियम”, “संचालन नियम”. |
| L14, L15 | Provozovatel; Uživatel | Operator; User | **संचालक** (m.); **उपयोगकर्ता** (m.) | House Rules parties. A GDPR processor (*zpracovatel*), if it appears, is “प्रोसेसर”, never “संचालक”. |
| L17 | odstoupení od smlouvy | withdrawal from the contract | **अनुबंध से हटना**; “अनुबंध से हटने का अधिकार” | Consumer withdrawal right. Forbidden: “अनुबंध समाप्ति” (= termination), “रद्दीकरण”. |
| L18 | vady a reklamace | defects and complaints | **दोष और शिकायतें** | GTC §12. Forbidden: “खराबी”. |
| L19 | mimosoudní řešení spotřebitelských sporů | alternative consumer dispute resolution | **उपभोक्ता विवादों का न्यायालय के बाहर समाधान** | Czech ADR body stays in Czech with an optional gloss. |
| L20 | občanský zákoník / zákon č. 89/2012 Sb. | Civil Code / Act No. 89/2012 Coll. | **zákon č. 89/2012 Sb., občanský zákoník** + once “(चेक गणराज्य की नागरिक संहिता, अधिनियम सं. 89/2012 Sb.)” (संहिता is feminine) | Never cite Indian law. |
| L21 | obchodní rejstřík | Commercial Register | **वाणिज्यिक रजिस्टर** (m.) | “Městský soud v Praze (प्राग नगर न्यायालय) द्वारा रखे गए वाणिज्यिक रजिस्टर में पंजीकृत, oddíl C, vložka 442830”. Forbidden: “ROC”, “कंपनी रजिस्ट्रार”. |
| L23 | Správce osobních údajů | Controller | **व्यक्तिगत डेटा नियंत्रक** (m.) | GDPR term. Forbidden: “डेटा फ़िड्यूशियरी” (Indian DPDP Act term). |
| L25, L26, L27 | právní základ; doba uchování; předávání mimo EU | legal basis; retention period; transfers outside the EU | **कानूनी आधार**; **संग्रहण अवधि**; **EU के बाहर हस्तांतरण** | Privacy §4/§5/§7 headings. Forbidden: “ट्रांसफ़र”. |

## Grammar and typography notes

### Latin-script names in running text

Brand and third-party names stay in Latin script and take Hindi postpositions after a space: “Deskohub Workspace में”, “Nexi के सुरक्षित भुगतान पेज पर”, “ChatGPT में”, “Dotypos टैग”, “Cowork Plus प्लान का”. Never transliterate (*डेस्कोहब*, *नेक्सी*) and never glue a postposition or suffix to the name (*Deskohubका*). Place names are different: Palmovka, Libeň and Praha are written in Devanagari in prose (X10, X11).

Grammatical gender of Latin names follows the generic noun they stand for: Workspace / Deskohub (the coworking space) are masculine (“Deskohub Workspace का”); Nexi (payment system) is masculine; ChatGPT, Claude are masculine.

### Punctuation, quotes, numbers

- Sentence end: the danda **।** in Devanagari prose (“फिर से कोशिश करें।”). Question mark **?** and exclamation mark **!** as in Czech. When a sentence ends with a Latin token, URL, placeholder or number, the danda still ends it (“… {email} पर भेजा गया है।”). Labels, buttons and titles without a full stop in Czech get none.
- Quotes: “…” outside, ‘…’ inside. Convert Czech „…“ to “…”.
- Dash: spaced en dash “ – ” in prose; the Czech spaced hyphen in summary lines (`checkoutSummaryItemMeetingRoom` “Zasedací místnost - {duration}”) becomes “ – ”.
- Ellipsis: the single character “…”.
- Digits: Western only. Numbers, dates, money: never hand-format (style guide §6). `Intl` for hi-IN groups digits in the Indian system (1,00,000); that comes from the formatter, not from us.
- Spelling: use the nukta for loan sounds (फ़, ज़, ऑ in ऑफ़िस, ज़रूरी, फ़ोन). Use chandrabindu where no vowel sign rises above the headline (“जाएँ”, “सेवाएँ”, “यहाँ”, “हूँ”) and anusvara where one does (“करें”, “में”, “हैं”, “नहीं”). Write “कोशिश”, “ज़रूरत”, “तारीख़”, “ख़त्म” → prefer “समाप्त”.
- Word order: Hindi puts the verb last. When a placeholder holds a phrase, keep it in a slot the postposition can follow (“{duration} के लिए”) or after a colon/label.

### Polite आप and imperatives

- Instructions, buttons and CTAs use the polite subjunctive-imperative in **-ें / -एँ**: *चुनें, दर्ज करें, कोशिश करें, जाँचें, क्लिक करें, संपर्क करें, ध्यान दें, बुक करें*. Never the *तुम* forms (*चुनो, करो*) and never the bare *तू* stem. Avoid the extra-ceremonial *-इए* forms (*चुनिए*) on buttons; they may appear in warm customer prose, but not mixed within one screen. Default: **-ें** everywhere.
- “कृपया” (please) only where Czech has *prosím* or the sentence would sound abrupt in an error; don't add it to buttons.
- Prefer “चुनें” to “सेलेक्ट करें”, “दर्ज करें” to “डालें” for typed values, “क्लिक करें” only where Czech says *klikni*.

### Gender-neutral techniques

See Key decisions. Practical patterns:

1. “आप … कर सकते हैं” → “आप … कर सकें, इसके लिए …” or “… किया जा सकता है” or “आप चाहें तो … करें”.
2. “आप आए / आईं” → “आपकी विज़िट …”, “आपने हमें विज़िट किया”.
3. “आप साइन इन हैं” → “आपका खाता साइन इन है” / “साइन इन: {email}”.
4. Invitee or person nouns: “व्यक्ति” (m. grammatically, semantically neutral), “आमंत्रित व्यक्ति”, “टीम”, “प्रोफ़ाइल”.
5. Names after a colon in a label (“बुक करने वाले: {name}”, “किसके लिए: {name}”).
6. Never slash forms, “(ी)” suffixes or masculine-plus-feminine doublets.

### Plurals

Hindi CLDR categories are `one` (i = 0 or n = 1, so 0 and 1) and `other`. Provide exactly `{selector}=one` and `{selector}=other`, keep `declarations` and `selectors` byte-identical, and use **each key's own selector name** (`countPlural`, `dayCountPlural`, `seatCountPlural`, `hoursPlural`, `maxPlural`…). Drop the Czech `few` and `many` variants. Copy-ready `reservationMeetingRoomDurationHours`:

```json
  "reservationMeetingRoomDurationHours": [
    {
      "declarations": ["input count", "local countPlural = count: plural"],
      "selectors": ["countPlural"],
      "match": {
        "countPlural=one": "{count} घंटा",
        "countPlural=other": "{count} घंटे"
      }
    }
  ],
```

Renders: 1 घंटा · 2 घंटे · 1.5 घंटे. Days: “{dayCount} दिन” in both; seats: “{count} सीट” / “{count} सीटें”; reservations “बुकिंग” in both; referrals “रेफ़रल” in both. Where the noun doesn't change, both variants carry the same text (as Czech `accountReferralsHowBenchmark` does).

### Buttons and length

- Buttons use the polite imperative without an object where context is clear: “सहेजें”, “रद्द करें”, “बुक करें”, “साइन इन करें”, “फिर से कोशिश करें”, “कॉपी करें” (next to the code; not “रेफ़रल कोड कॉपी करें”).
- Hindi runs about 10–25 % longer than Czech in characters, and Devanagari needs more vertical space (vowel signs above and below). Buttons, tabs, nav items, table headers and badges: Czech length +20 % or about 20 characters, whichever is larger. Page titles ≤ 40 characters before “ | Deskohub Workspace”; meta descriptions ≤ 155; customer email subjects ≤ 60, key fact first.
- Shortening tools: drop “अपना/आपका” where obvious; “कीमतें” instead of “मूल्य सूची” in UI.

## Watch keys

| Key(s) | Risk | Rule |
|---|---|---|
| All 11 customer plural keys (`accountReferralsHowBenchmark`, `reservationMeetingRoomDurationHours`, `reservationOfficeBasePriceLabel`, `reservationOfficeSeatCountOption`, `checkoutSummaryItemOfficeAccess`, `checkoutSummaryItemOfficeSeatCount`, `checkoutSummaryItemOfficeDayCount`, `reservationValidationOfficeMaximumDuration`, `accountReservationSeats`, `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange`) and the administration plural keys | Czech has one/few/many/other | Exactly `one` and `other`; drop `few` and `many`. |
| `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange` | Czech `one` = “Zvol 1 den.” for max = 1; Hindi `one` also fires for 0 | `other`: “दिनों की संख्या: 1 से {max} तक।” / “सीटों की संख्या: 1 से {max} तक।”; `one` follows Czech without `{max}`: “1 दिन चुनें।” / “1 सीट चुनें।” (placeholders stay identical to each Czech variant). |
| `accountHelpBody` + `accountHelpContact` | `{contact}` is the linked clause “kontaktuj nás” | Translate together: “अगर आपको अपने खाते या बुकिंग में मदद चाहिए, तो {contact}।” + “हमसे संपर्क करें”. |
| `accountReferralsHowCompound` | `{duration}` is `Intl` output (“30 दिन”) | “पिछले {duration} में हमें विज़िट करने वाले हर आमंत्रित व्यक्ति के लिए आपको {discount} की अतिरिक्त छूट मिलती है। छूटें जुड़ती जाती हैं!” |
| `checkoutSummaryItemMeetingRoom`, `pricingMeetingRoomProduct`, `reservationValidationMeetingRoomDuration` | `{duration}` / `{durations}` hold phrases | “मीटिंग रूम – {duration}”, “… इनमें से एक होनी चाहिए: {durations}।” |
| `reservationAvailabilityUnavailable` | `{tier}` in a genitive slot | “{date} को चुने गए सेटअप में {tier} प्लान उपलब्ध नहीं है। कोई दूसरा विकल्प या तारीख़ आज़माएँ – या अगर आपने वर्कस्टेशन चुना है, तो दूसरा मॉनिटर सेटअप!” |
| `checkoutSummaryDiscountDetailsTrigger`, `pricingReserveLabel`, `checkoutEmailAuthorHeading` | `{product}` / `{customer}` | Label + colon: “छूट दिखाएँ: {product}”, “बुक करें: {product}”, “बुक किया गया: {product}। किसके लिए: {customer}”. |
| `accountReservationBookedBy`, `accountReservationBookedFor`, `accountProfileScreenMemberFallback`, `accountProfileReferralCodeHint` | Gender marking | “बुक करने वाले: {name}”, “किसके लिए: {name}”, “Workspace प्रोफ़ाइल”, “क्या आपके पास किसी दूसरे Workspace ग्राहक का रेफ़रल कोड है? उसे यहाँ दर्ज करें…”. |
| `checkoutPayConsent`, `checkoutPaymentRetryConsent` | First-person declaration carrying the withdrawal waiver; tag link texts are document titles; leading space inside `<earlyPerformance>` | “मैं इन दस्तावेज़ों से सहमत हूँ: <terms>सामान्य नियम और शर्तें</terms>, <operatingRules>परिसर नियमावली</operatingRules>।<earlyPerformance> चूँकि सेवा अनुबंध से हटने की वैधानिक अवधि के भीतर शुरू होती है, मेरा स्पष्ट अनुरोध है कि सेवा बुक किए गए समय पर दी जाए, और मुझे जानकारी है कि सेवा पूरी तरह दिए जाने के बाद अनुबंध से हटने का मेरा अधिकार समाप्त हो जाता है।</earlyPerformance>”. First-person verbs are gendered in Hindi (“करता/करती हूँ”), so the waiver uses noun constructions (“मेरा अनुरोध है”, “मुझे जानकारी है”); “सहमत हूँ” is gender-neutral. Keep the leading space inside the tag. Native-speaker check required. |
| `checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton` | Legal button wording | “ऑर्डर करें और भुगतान करें”, “ऑर्डर करें और {amount} का भुगतान करें”. |
| `marketingPreferencesFormRowDescription`, `ttrpgRoom*` bar keys, `landingFaqItemThreeAnswer` | Czech inflects *Deskohubu*, *Deskohub Baru* | “Deskohub को आपको … भेजने की अनुमति देते हैं” → neutral: “आप Deskohub को … भेजने की सहमति देते हैं”; “Deskohub बार के माहौल में”. |
| `checkoutPayProviderHandoff`, `checkoutStatusPendingLead` | Nexi in an oblique slot | “Nexi के सुरक्षित भुगतान पेज पर”, “Nexi का भुगतान टैब”. |
| Palmovka/Libeň/Praha keys (`landingMetadataTitle`, `landingHeroTitle`, `coworkingHeroTitle`, `coworkingMetadataTitle`, `meetingRoomMetadataTitle`, `reservationCoworkMetadataTitle`, `galleryMetadataTitle`, `faqMetadataTitle`, `landingLocationTransport`, `faqAnswerTransport`, `workspaceDescription`, `landingUiHeroFlowStepThreeText`) | Titles ≤ 40 characters | “पाल्मोव्का, प्राग 8 में कोवर्किंग”, “लिबेन में Turnovská सड़क पर”, “पाल्मोव्का मेट्रो स्टेशन (Palmovka, लाइन B)”. |
| `pricingIntro` | Czech writes “Kč” in prose | “ऑनलाइन बुक की जा सकने वाली हर चीज़ की कीमतें CZK में।” |
| `checkoutDiscountCodeLabel` | Three distinct concepts | “छूट, वाउचर या रेफ़रल कोड”. |
| `accountSignInPasskey`, `landingAccessStepKeypad` | Passkey vs access code; keypad vs keyboard | “पासकी से साइन इन करें”; “मुख्य दरवाज़े के पास कीपैड पर PIN दर्ज करें। किसी ऐप की ज़रूरत नहीं।” |
| `footerVatStatus`, `invoiceNonVatPayerStatement`, `reservationBillingCompanyIdLabel`, `reservationBillingVatIdLabel` | Czech tax ids | “कंपनी VAT के लिए पंजीकृत नहीं है”, “हम VAT के लिए पंजीकृत नहीं हैं।”, “IČO”, “DIČ (वैकल्पिक)”. |
| `faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales` | Visitor asks the venue (Czech *vy*) | “क्या आपके यहाँ निजी ऑफ़िस हैं?” — *आप* here addresses the venue. |
| `checkoutStatus*ContactMessage` | Pre-filled email from the customer to the venue | First person, “नमस्ते”, polite; keep `{reservationDetails}` on its own line; avoid gendered first-person verbs (“मैं … चाहता/चाहती हूँ” → “मेरा अनुरोध है कि …”). |
| Font coverage (all surfaces) | Devanagari glyphs, conjuncts and matras may be missing in the web and mobile fonts, falling back mid-word, and line height may clip vowel signs | Registry/fonts stream: check on the preview before sign-off. |

## Terms settled during translation

Recurring terms the translation slices chose that the tables above don't cover. They are binding like the rest of this file.

| Czech | English | Hindi | Notes |
|---|---|---|---|
| blokace rezervace; držíme | reservation hold; held | **होल्ड** (f.); “बुकिंग की अस्थायी होल्ड”, “होल्ड पर” | Also a discount claim held by a pending checkout (“होल्ड पर”). Never आरक्षण. |
| zámek (Igloohome) | (smart) lock | **लॉक** (m.) | Forbidden: “ताला”. |
| přístupový odkaz; přístupová stránka | access link; access page | **प्रवेश लिंक**; **बुकिंग का प्रवेश पेज** | Button “प्रवेश कोड दिखाएँ”. |
| přístupový údaj (provider) | credential | **क्रेडेंशियल** (m.); CLI “साइन-इन क्रेडेंशियल” | Assistant access credentials in legal: “पहुँच क्रेडेंशियल”. |
| vrácení peněz | refund | **धनवापसी** (f.); verb “भुगतान वापस करना” | Not निरस्तीकरण (A12 void). |
| obnova | recovery | **बहाली** (f.); “बहाल करना” | |
| párování / sladění | reconciliation | **मिलान** (m.) | |
| tabulka (data grid) | table | **तालिका** (f.) | **टेबल** stays the physical / Dotypos table. |
| produkt | product | **प्रोडक्ट** (m.) | Legal documents may say “उत्पाद”. |
| provozní (purpose) | operational | **संचालन संबंधी** | Customer email footer: “सेवा संदेश”. Admin nav “Provoz” = “संचालन”. |
| koncept | draft | **ड्राफ़्ट** (m.) | |
| verze | version | **वर्ज़न** (m.) | Forbidden: “वर्शन”. |
| obrázek; fotka | image; photo | **इमेज** (f.); **फ़ोटो** (f.) | Forbidden: “तस्वीर”. |
| doplňky | add-ons | **ऐड-ऑन** (m.) | |
| recenzní účet; recenzent | (app-store) review account; reviewer | **रिव्यू खाता**; **समीक्षक** | Manual payment review stays “समीक्षा”. |
| odhlásit odběr | unsubscribe | **सदस्यता छोड़ना** (link “सदस्यता छोड़ें”) | Forbidden: “अनसब्सक्राइब”. |
| událost (automation, Google Calendar) | event | **इवेंट** (m.) | Hosted events (akce) stay **कार्यक्रम** (D07). |
| scénář; plán; plánovač | flow; schedule; planner | **वर्कफ़्लो**; **शेड्यूल**; **शेड्यूलर** | |
| uplatnit (kód) | redeem / apply a code | **इस्तेमाल करना** (claim); **लागू करना** (a discount applies) | |
| preference (marketing) | preference | **सेटिंग** (f.) | Cookie category “प्राथमिकता कुकीज़”. |
| spravovat | manage | **मैनेज करना** | |
| připojit / odpojit (asistenta) | connect / disconnect | **कनेक्ट करना** / **डिस्कनेक्ट करना**; “कनेक्ट किए गए असिस्टेंट” | |
| Nebezpečná zóna | danger zone | **जोखिम क्षेत्र** | |
| Globální sleva | global discount | **सभी बुकिंग पर छूट** | |
| deaktivovat (profil); přihlašování | deactivate; sign-in methods | **निष्क्रिय करना**; **साइन-इन के तरीके** | |
| jednorázový odkaz | single-use link | **एक बार इस्तेमाल होने वाला लिंक** | |
| d / h / min / s (countdown) | — | **दि. / घं. / मि. / से.** | Only where Czech abbreviates. |
| jazyk (in sentences) | language | “**चेक भाषा**”, “अंग्रेज़ी भाषा” | Bare names (चेक, अंग्रेज़ी, जर्मन, यूक्रेनी, स्लोवाक) in lists and labels; “चेक” alone can read as “cheque” in prose. |
| ustanovení; odpovědnost; škoda / újma | provision; liability; damage / harm | **प्रावधान**; **उत्तरदायित्व**; **क्षति** / **हानि** | Legal documents. |
| sídlo; provozovna (legal); doručovací adresa | registered office; establishment; delivery address | **पंजीकृत कार्यालय**; **प्रतिष्ठान**; **पत्राचार का पता** | Legal documents; the venue in UI stays “स्थान” (P18). |
| oprávněný zájem | legitimate interest | **वैध हित** | Privacy policy. |

## Notes for the owner

- **Place names:** follows the uk-UA precedent (native script in prose, Latin signage once in directions). If the owner prefers Latin place names for Hindi, it is a mechanical change in the keys listed under Watch keys and in `content.tsx`.
- **email in Latin** is the owner's decision for this locale (brief, 2026-11-10); Google's Hindi UI writes “ईमेल”. Applied everywhere.
- **First-person legal declarations** (`checkoutPayConsent`, consent checkboxes, pre-filled contact emails) avoid gendered first-person verbs with noun constructions; a native speaker should confirm they read naturally.
