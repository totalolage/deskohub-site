# Deskohub Workspace glossary: Ukrainian (`uk-UA`)

Binding Ukrainian terminology for the customer catalog, administration catalogs, legal documents and mobile catalog (Czech → Ukrainian). It applies together with the shared [style-guide.md](style-guide.md). Where the two disagree, this file wins for `uk-UA`. Concept IDs are defined in [terms.md](terms.md).

| Surface | Register | Example |
|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | polite **ви**, always lowercase (*ви, ваш, вам, вас*); never **ти** | «Спробуйте ще раз.», «Ваше бронювання підтверджено.» |
| Administration (staff UI, staff-facing copy) | formal **ви**, lowercase, neutral official tone | «Оберіть клієнта.», «Не вдалося зберегти знижку. Спробуйте ще раз.» |
| Legal documents | formal; capitalised **Ви / Ваш / Вам** only where the text addresses the reader directly; otherwise third person through defined terms (*Клієнт*, *Надавач*) | «Клієнт має право…», «Ви можете відкликати згоду…» |

Czech customer copy is informal *ty*. Polite *ви* is a register change, not a mistranslation: convert every *ty* form (zkus, zadej, tvoje, máš) to the *ви* form (спробуйте, введіть, ваш, у вас є). With *ви*, past tense and short adjectives take the plural form (*ви забронювали*, *ви впевнені?*), so second-person copy is gender-neutral automatically.

## Key decisions

- **Reservation = бронювання** (n., same form in nom. sg/pl; gen. pl. *бронювань*), verb **забронювати / бронювати**, participle **заброньовано**. It is what Ukrainian booking, travel and restaurant services say. «Резервація» means a reserve or a reservation territory in Ukrainian and reads as a calque. «Бронь» is colloquial. The same root is the legal defined term **Бронювання** (L13), so UI and terms match. The admin Dotypos "rezervace stolu" (A09) gets a different root, **резервування столу**, so staff never confuse the two.
- **Coworking = коворкінг** (m., gen. *коворкінгу*, loc. *у коворкінгу*). It is the established loan, used by UA coworkings and media. It declines like any m. noun in *-інг* (маркетинг). The short Czech "cowork" (P02) maps to the same word.
- **Meeting room = переговорна кімната** (formal, page and product titles) / **переговорна** (everyday, CTAs and running copy; substantivised adj. f., *у переговорній*). This is a natural formal/everyday pair with one root, which mirrors *zasedací místnost / zasedačka* (style guide §1). «Кімната для переговорів» is also correct but too long for CTAs. «Конференц-зал» is a larger hall. «Переговорка» is slang.
- **Passkey = ключ доступу** (m.). Google's and Microsoft's Ukrainian UIs and the Ukrainian tech press use it. Apple's Ukrainian label wasn't verified, and its Russian UI says «ключи входа». If Apple's uk UI says «ключ входу», keep **ключ доступу** anyway: one term on our side. The door code is **код доступу** (X01). Czech has the same near-pair (*přístupový klíč* / *přístupový kód*), so the distinction is the noun: *ключ* vs *код*. Never write «код доступу» for the passkey or «ключ» for the door code.
- **Sign in = увійти** (button «Увійти», noun **вхід**: *посилання для входу*, *код для входу*). Sign out = **вийти**. «Вхід в систему», «залогінитися», «авторизуватися» are forbidden in customer copy.
- **Invoice = рахунок-фактура** (m.; both parts decline: *рахунку-фактури*, pl. *рахунки-фактури*). Czech *faktura* is the tax document issued after payment. Bare «рахунок» in Ukrainian commerce usually means a request to pay (and also a bank account), so it misdescribes the document. «Інвойс» is business jargon.
- **IČO / DIČ / DPH** are Czech facts. Keep the Czech acronym as the label core and add a Ukrainian gloss: **IČO (реєстраційний номер компанії)**, **DIČ (номер платника ПДВ)**. **ПДВ** is the generic Ukrainian word for VAT, so DPH → **ПДВ** is a translation, not a localisation. Never use the Ukraine-specific registry ids ЄДРПОУ, ІПН, РНОКПП, or Russian ИНН.
- **Voucher = ваучер** (m.). Czech *poukaz* covers prepaid and promotional vouchers. «Подарунковий сертифікат» narrows it to a gift, so use it only where Czech says *dárkový poukaz*.
- **Final checkout button (R05) = «Замовити й оплатити»** / with amount «Замовити й оплатити {amount}». *Оплатити* states the payment obligation as explicitly as the Czech (EU "order with obligation to pay"). Never «Продовжити», «Оформити», «Підтвердити» or «Готово».
- **Legal parties:** Poskytovatel → **Надавач** (full form at definition: «Надавач послуг»); Klient → **Клієнт**; Spotřebitel → **Споживач**; Provozovatel → **Оператор**; Uživatel → **Користувач**. All are capitalised as defined terms. «Постачальник» suggests goods. «Виконавець» is the Ukrainian Civil Code's services party and would invite a Ukrainian-law reading of a Czech-law contract.
- **Gender-neutral fallbacks:** P30 "Člen Workspace" → **«Профіль Workspace»** (a neutral noun instead of a person noun). R20 "Rezervoval(a) {name}" → **«Ким заброньовано: {name}»**: an impersonal participle, with the name in the nominative after a colon. Its pair "Pro {name}" → **«Для кого: {name}»**. Both follow the Ukrainian form-label pattern («Ким видано:»), so the name stays nominative after the colon. «На імʼя {name}» is wrong here: it takes the genitive («на імʼя Олени»). Never «Забронював(-ла)», «Учасник(-ця)» or slash forms.

## Glossary

Gender: m./f./n., pl. = plural-only. "Forbidden" lists wrong or competing forms, including Russianisms and surzhyk.

### P · Products and spaces

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| P01, P02 | coworking; cowork | coworking; cowork | **коворкінг** (m., gen. коворкінгу, loc. у коворкінгу) | CTA "Rezervovat cowork" → «Забронювати коворкінг». Prefer «у коворкінгу» to the adjective «коворкінговий». Forbidden: «коворкинг» (Russian spelling), «ко-воркінг», Latin «cowork» in Ukrainian text. |
| P03 | open space / otevřený prostor; Open-space místo | open space | **відкритий простір** (m.); «місце у відкритому просторі» | Product title "Sdílené místo" (EN "Open Space") → «Місце у спільному просторі». Forbidden: «опенспейс», «open space» in Latin. |
| P04, P05 | zasedací místnost; zasedačka | meeting room | **переговорна кімната** (f., formal) / **переговорна** (f. substantivised adj., everyday) | Titles and product names use the formal form, CTAs and running text the everyday one: «Забронювати переговорну». Forbidden: «переговорка», «конференц-зал», «зала засідань», «мітинг-рум». |
| P06, P07 | kancelář; soukromá kancelář | office; private office | **офіс** (m.); **приватний офіс** | Forbidden: «кабінет» (also used for "account area"), «контора». |
| P08 | pracovní stanice | workstation | **робоча станція** (f.) | The Profi desk with monitors. Keep it distinct from «робоче місце» (any desk). |
| P09, P11, R21 | vyhrazené místo; místo; přiřazené místo | reserved desk; spot/seat; assigned desk | **закріплене місце**; **місце** (n.); **призначене місце** | «Місце» is the bookable seat and the plural count noun (1 місце / 2 місця / 5 місць / 1,5 місця). Titles and first mentions use «закріплене місце на день» (UA coworkings use bare «закріплене місце» for a monthly fixed desk); bare «закріплене місце» only where the day is already stated. Forbidden: «посадкове місце», «сидіння», «фіксоване місце». |
| P10 | stůl | desk / table | **стіл** (m., gen. столу) | «Вільний стіл», «робочий стіл». In admin Dotypos context see A09. Forbidden: «парта». |
| P12, P14 | místnost; TTRPG místnost | room; TTRPG room | **кімната** (f.); **кімната для TTRPG** | TTRPG stays Latin, uninflected. Forbidden: «приміщення» for a room (reserved for legal L06), «зала». |
| P13 | prostor / pracovní prostor | space / workspace (generic) | **простір** (m.); **робочий простір** | Lowercase generic, never the brand. Forbidden: «приміщення», «воркспейс». |
| P15, P16 | kampaň (TTRPG); one-shot | campaign; one-shot | **кампанія** (f.; «ігрова кампанія» at first mention); **ваншот** (m.) | The role-playing sense, as UA TTRPG communities say it. First mention of «ваншот» may add «(пригода на одну ігрову сесію)». The email campaign is A24 (same word, other surface). Forbidden: «компанія» (company, frequent typo), Latin «one-shot» in running text. |
| P17 | bar (Deskohub Bar) | bar | **бар** (m.); «бар Deskohub», «у барі Deskohub» | Czech inflects "Deskohub Baru", so *Bar* is generic: translate it. Forbidden: «Deskohub Бар», «Дескохаб». |
| P18, X09 | provozovna; adresa provozovny | venue / premises; venue address | **заклад** (m.); **адреса закладу** | Footer label «Адреса закладу». Legal text may gloss it once as «місце провадження діяльності». Forbidden: «точка», «філія». |
| P19 | nabídka | offering / options | **пропозиція** (f.) | Label over the tier picker: «Пропозиція». Forbidden: «оферта» (legal public offer), «асортимент». |
| P20, L10 | tarif; Tarif | tier / plan; Tariff | **тариф** (m.); legal **Тариф** | «усі переваги тарифу Basic». Forbidden: «план», «пакет», «рівень». |
| P21 | výhody | perks | **переваги** (pl.) | Forbidden: «плюшки», «бонуси», «бенефіти». |
| P22, P23, P24 | Basic Day Pass; Cowork Plus; Profi Workstation; Basic | product names | **Basic Day Pass**, **Cowork Plus**, **Profi Workstation**, **Basic** | Never translate, transliterate or inflect. Attach case to «тариф»: «тарифу Cowork Plus». Don't invent a Ukrainian "денний абонемент". |
| P25 | monitorový setup; profi setup; sestava monitorů | monitor setup | **конфігурація моніторів** (f.); perk «професійна конфігурація моніторів» | Forbidden: «сетап», «сет-ап», «збірка моніторів». |
| P26 | batch brew káva | batch brew coffee | **фільтр-кава batch brew** | "batch brew" stays a Latin loan. Forbidden: «батч-брю». |
| P27 | káva zdarma | free coffee | **безкоштовна кава** | Forbidden: «халявна кава», «кава в подарунок», «бесплатна». |
| P28 | Wi-Fi | Wi-Fi | **Wi-Fi** (n., indeclinable) | «пароль від Wi-Fi». Forbidden: «вайфай», «WiFi», «вай-фай». |
| P29 | monitor | monitor | **монітор** (m.) | Forbidden: «дисплей», «екран» for the device. |
| P30 | Člen Workspace | Workspace member | **Профіль Workspace** | Fallback display name (`accountProfileScreenMemberFallback`). Neutral noun instead of a gendered person noun. Forbidden: «Учасник Workspace», «Учасник(-ця)», «Член Workspace». |
| P31, P33 | Deskohub Workspace; Deskohub | brand | **Deskohub Workspace**; **Deskohub** | Latin, exact capitalisation, never inflected. Attach case to a generic noun: «у коворкінгу Deskohub Workspace», «від команди Deskohub». Forbidden: «Дескохаб», «Deskohubу», «Deskohub-у». |
| P32 | Workspace (brand) | Workspace | **Workspace** | Short brand. «бронювання у Workspace» is acceptable in short labels. In sentences prefer «у коворкінгу Workspace». Lowercase generic "workspace" = P13. |

### R · Reservation

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| R01, L13 | rezervace; Rezervace (legal) | reservation; Booking (legal EN) | **бронювання** (n.; pl. бронювання, gen. pl. бронювань); legal **Бронювання** | See Key decisions. Forbidden: «резервація», «бронь», «резерв», «букінг». Admin A09 must differ. |
| R02, R03 | rezervovat; rezervační | book / reserve; booking (adj.) | **забронювати** (pf.) / **бронювати** (impf.); adj. → genitive noun: «посилання для бронювання», «форма бронювання» | CTA «Забронювати». Forbidden: «зарезервувати» (customer), «резерваційний», «бронювальний». |
| R04, A10 | objednávka; Objednávky | order; orders | **замовлення** (n.; pl. замовлення, gen. pl. замовлень) | «номер замовлення». Forbidden: «заказ» (Russianism), «ордер». |
| R05 | Objednat a zaplatit | Order and pay | **Замовити й оплатити** | Legally required final button; must name the payment. «й» between vowels (euphony). Forbidden: «Продовжити», «Оформити», «Купити», «Підтвердити», «Нажати…». |
| R06 | poptávka | inquiry | **запит** (m.) | Contact-form request for offices/events. Forbidden: «заявка» (use only if Czech says žádost), «запрос» (Russian). |
| R07, R08 | termín; datum | date / time slot; date | **дата** (f.) or **час** (m.) by context; label «Дата» | Czech *termín* is a false friend: Ukrainian «термін» = term/deadline. «у заброньований час», «Оберіть дату». Forbidden: «термін» for a slot, «слот». |
| R09, R10 | začátek; konec | start; end | **Початок**; **Кінець** | Labels. In running text «з {startsAt} до {endsAt}». Forbidden: «Старт», «Закінчення» (as label). |
| R11 | délka | duration | **тривалість** (f.) | Forbidden: «довжина» (physical length), «протяжність». |
| R12, R13 | hodina; den | hour; day | **година** (f.) · **день** (m.) | Plural sets: 1 година / 2 години / 5 годин / 1,5 години; 1 день / 2 дні / 5 днів / 1,5 дня. Abbrev. «год», «хв», «с» without a dot. Forbidden: «часів», «сутки» (Russian). |
| R14, R15, R16 | dostupnost; volný / volno; obsazeno | availability; available; booked / taken | **наявність вільних місць** (f.; bare «наявність» only in a short label); **вільний**; **зайнято** | «Не вдалося перевірити наявність вільних місць.» Forbidden: «доступність» (= accessibility), «безкоштовний» for "volný", «заброньовано» for an unavailable slot. |
| R17, S03 | potvrzení; potvrzeno | confirmation; confirmed | **підтвердження** (n.); **підтверджено** | «лист із підтвердженням», «Бронювання підтверджено». Forbidden: «конфірмація», «затверджено». |
| R18, A52, L16 | zrušení / zrušit; Zrušit (dialog); Storno Rezervace | cancellation / cancel; Booking Cancellation | **скасування** (n.) / **скасувати**; button «Скасувати»; legal heading «Скасування Бронювання» | Forbidden: «відміна», «відмінити» (Russianism «отмена»), «анулювати» (reserved for A12), «сторно». |
| R19 | změna | change | **зміна** (f.) / **змінити** | «Ціна змінилася.» Forbidden: «правка», «модифікація». |
| R20 | Rezervoval(a) {name} | Booked by {name} | **Ким заброньовано: {name}** | Gender-neutral impersonal form; {name} nominative after a colon. Pair `accountReservationBookedFor` "Pro {name}" → «Для кого: {name}». Forbidden: «Забронював(-ла) {name}», «Автор бронювання» (masc.), «від {name}», «на імʼя {name}» (needs genitive). |
| R22, R23 | platnost / platí; vypršet | validity / is valid; expire | **термін дії** / **діє**, **дійсний**; **минути** («термін дії минув») | Here «термін» is correct (period of validity). «Посилання більше не дійсне.» Documents/laws: «чинний». Forbidden: «протермінований», «прострочений» (only for A22 overdue invoices), «експірувати». |

### K · Payment and billing

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| K01, A13 | platba; Platba nedokončena | payment; payment abandoned | **оплата** (f., the act of paying, customer); **платіж** (m., one transaction, admin lists and timeline); «Оплату не завершено» | One Czech word, two Ukrainian senses: «перейти до оплати» vs «платіж Nexi № …». Forbidden: «плата» for checkout payment, «пеймент». |
| K02, K03 | zaplatit; zaplaceno | pay; paid | **оплатити** (pf., transitive); **оплачено** | «оплатити бронювання», never «оплатити за». «заплатити» only in the idiom «заплатити карткою». Forbidden: «уплатити», «проплатити». |
| K04, K05 | platební karta / karta; platební metoda | payment card; payment method | **платіжна картка** (f.), short **картка**; **спосіб оплати** (m.) | Forbidden: «карта» (Russianism; Ukrainian «карта» = map), «кредитка», «платіжний метод», «метод оплати». |
| K06, K07, K08 | platební brána; platební odkaz; Nexi | payment gateway; payment link; Nexi | **платіжний шлюз** (m.); **посилання для оплати** (n.); **Nexi** | Customer copy: «захищена платіжна сторінка Nexi», «через платіжну систему Nexi». Nexi never inflected. Forbidden: «Нексі», «лінк на оплату», «платіжна брама». |
| K09, K10 | cena; základní cena | price; base price | **ціна** (f.); **базова ціна** | Forbidden: «вартість» as a label for *cena* (fine in prose «скільки коштує»), «прайс». |
| K11, L11 | ceník; Ceník (legal) | price list; Price List | UI page/nav **Ціни**; legal defined term **Прейскурант** | Legal first mention may add «(сторінка «Ціни» на вебсайті)». Forbidden: «прайс», «прайс-лист», «тарифна сітка». |
| K12 | částka | amount | **сума** (f.) | Forbidden: «кількість» (count), «розмір оплати». |
| K13 | celkem | total | **Разом** | Invoice/summary label. Forbidden: «Всього» as a label, «Підсумок» (heading only). |
| K14, K15 | měna; Kč | currency; CZK | **валюта** (f.); prose **CZK** | Money always CZK via `Intl` (uk prints "CZK"). «Ціни в CZK». Forbidden: «крон», «чеських крон», «Kč», «грн», «€», EUR, UAH. |
| K16 | faktura | invoice | **рахунок-фактура** (m.) | See Key decisions. No receipts or credit notes exist. Forbidden: «рахунок» alone, «інвойс», «квитанція», «чек», «накладна». |
| K17 | fakturační údaje | billing details | **дані для рахунку-фактури** (pl.) | Section title. Forbidden: «платіжні реквізити» (= bank details), «білінг». |
| K18, K19 | DPH; neplátce DPH | VAT; not a VAT payer | **ПДВ** (m., indeclinable); **не є платником ПДВ** | Footer «компанія не є платником ПДВ»; invoice «Ми не є платниками ПДВ.» It is Czech VAT: never cite Ukrainian tax law. |
| K20 | IČO | company ID number | **IČO (реєстраційний номер компанії)**; form label «IČO» with that hint, or «Реєстраційний номер (IČO)» | Value never changes. Forbidden: «ЄДРПОУ», «код ЄДРПОУ», «ІКО». |
| K21 | DIČ | VAT ID | **DIČ (номер платника ПДВ)** | `reservationBillingVatIdLabel` «DIČ (необовʼязково)». Forbidden: «ІПН», «РНОКПП», «ИНН», «ДІЧ». |
| K22 | firma / společnost | company | **компанія** (f.) | One word for both Czech terms. «Desktechub s.r.o.» stays. Forbidden: «фірма» (mixing), «кампанія» (typo = campaign). |
| K23, K24 | PSČ; ulice | postal code; street | **Поштовий індекс**; **Вулиця** | Labels only; Czech address values stay as written. Forbidden: «ZIP», «Індекс» alone. |
| K25 | platba po vypršení blokace rezervace | payment after the reservation hold expired | «оплата після завершення **тимчасового утримання бронювання**» | `checkoutStatusLatePaymentReviewContactMessage` is a pre-filled email the customer sends: first person, «Добрий день», polite to the venue. Forbidden: «блокування», «холд», «резерв». |

### D · Discounts and referrals

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| D01 | sleva | discount | **знижка** (f.) | «знижка 20 %» (the number comes formatted). Forbidden: «скидка» (Russian), «дисконт», «уцінка». |
| D02 | slevový kód | discount code | **код знижки** (m.) | Forbidden: «промокод», «купон», «знижковий код». |
| D03 | kód | code | **код** (m.) | Generic. |
| D04, A57 | poukaz; propagační poukaz | voucher; promotional voucher | **ваучер** (m.); **рекламний ваучер** | See Key decisions. «подарунковий сертифікат» only for *dárkový poukaz*. Forbidden: «купон», «талон», «сертифікат» alone. |
| D05 | Sleva, poukaz nebo doporučovací kód | Discount, voucher or referral code | **Знижка, ваучер або код запрошення** | Three distinct things; keep all three nouns. |
| D06, A08 | akce (sale); Akce (discounts area) | sale / promotion | **акція** (f.); admin area «Акції» | Sale banners, `discounts:discountsSalesTitle`. Forbidden: «розпродаж» (clearance), «sale», «промо». |
| D07 | akce (event) | event | **захід** (m.; pl. заходи) | «корпоративні заходи та воркшопи» (`landingOfferingEvents`, GTC §14). Forbidden: «акція», «івент», «мероприятие», «подія» for a hosted event. |
| D08, D09, D10 | doporučení; doporučovací kód; doporučovací odkaz | referral; referral code; referral link | **запрошення** (n.; 1/2 запрошення, 5 запрошень); **код запрошення**; **посилання-запрошення** | Invitee *pozvaný* → «запрошена людина» (gender-neutral). Section `accountSectionReferrals` → «Запрошення». Where the count means qualifying referrals (`accountReferralsCountSummary`, `accountReferralsHowBenchmark`), say «зараховані запрошення» or make the condition explicit. Forbidden: «реферал», «реферальний код», «рекомендація», «промокод». |
| D11 | první rezervace | first reservation | **перше бронювання** | Referral eligibility condition. |

### U · Account and authentication

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| U01, U15 | účet; zákaznický účet | account; customer account | **обліковий запис** (m.); **обліковий запис клієнта** | «до свого облікового запису Deskohub Workspace». Forbidden: «рахунок» (bank account/invoice), «акаунт», «аккаунт», «особистий кабінет». |
| U02 | profil | profile | **профіль** (m.) | Forbidden: «анкета». |
| U03 | přihlásit se / přihlášení | sign in | **увійти**; noun **вхід** | «Увійти з ключем доступу», «Увійти до облікового запису». Forbidden: «вхід в систему», «залогінитися», «авторизуватися», «зайти», «логін» (as action). |
| U04 | odhlásit se | sign out | **вийти**; button «Вийти» | Forbidden: «розлогінитися», «вихід із системи», «вилогуватися». |
| U05, U06 | přihlašovací odkaz; přihlašovací kód | sign-in link; sign-in code | **посилання для входу** (n.); **код для входу** (m.) | Subject `accountMagicLinkEmailSubject` «Посилання для входу в Deskohub Workspace». Forbidden: «магічне посилання», «magic link», «одноразовий пароль». |
| U07 | přístupový klíč | passkey | **ключ доступу** (m.; pl. ключі доступу) | See Key decisions. Must not collide with X01 «код доступу». Forbidden: «пасскі», «passkey» in Latin, «ключ входу», «ключ-пароль». |
| U08, U09 | správce hesel; heslo | password manager; password | **менеджер паролів** (m.); **пароль** (m.) | «пароль від Wi-Fi». Forbidden: «диспетчер паролів», «зберігач паролів». |
| U10, A47 | relace; Relace CLI | session; CLI session | **сеанс** (m.); «сеанси CLI» | Forbidden: «сесія» (mixing; also an exam session). |
| U11, U12 | zařízení; prohlížeč | device; browser | **пристрій** (m.); **браузер** (m.) | Forbidden: «девайс», «гаджет», «оглядач» (purist, unfamiliar), «броузер». |
| U13 | ověření / ověřit | verification / verify | **підтвердження / підтвердити** (email); **перевірка / перевірити** (checks, e.g. availability, IČO lookup) | «Підтвердьте електронну адресу.» Forbidden: «верифікація» (customer copy), «валідація». |
| U14 | e-mail | email | **електронна пошта** (f., field/service); **електронна адреса** (the address); **лист** (a message) | Field label «Електронна пошта». Example value «olena@example.com». Forbidden: «мейл», «імейл», «емейл», «е-мейл», Latin «e-mail» in Ukrainian text. |
| U16, A06, L03 | zákazník; zákazník (admin); Klient (legal) | customer; Client | **клієнт** (m.); legal defined term **Клієнт** | UI and admin lowercase, legal capitalised. Generic masculine is the standard UA label; in customer prose prefer «людина», «ви». Forbidden: «замовник» (except legal quotes of the Czech law), «кастомер», «покупець» (reserved for A20). |
| U17 | telefon | phone | **телефон** (m.) | Placeholder example «+380 50 000 0000». |

### X · Access and venue

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| X01, A01 | přístupový kód | access code | **код доступу** (m.; pl. коди доступу) | Door code for a reservation, staff-created in admin (`access-codes:*`). Forbidden: «ключ доступу» (= passkey), «пароль від дверей». |
| X02, L12 | PIN / PIN kód; Přístupový PIN kód | PIN; Access PIN Code | **PIN-код** (m.), short **PIN**; legal **PIN-код доступу** | Latin PIN, hyphen, Cyrillic «код». Forbidden: «пін», «ПІН-код», «пін-код». |
| X03, X04 | dveře; klávesnice | door; keypad | **двері** (pl.; gen. дверей); **кодова панель** (f.) | «Введіть PIN на кодовій панелі біля вхідних дверей.» Forbidden: «клавіатура» (computer keyboard), «кейпад», «домофон». |
| X05 | vstup | entry / entrance | **вхід** (m.) | Physical entry. Same noun as sign-in «вхід»; context separates them. Forbidden: «вʼїзд» (vehicle entry), «доступ всередину». |
| X06, A15 | přístup; Přístup ke dveřím | access; door access | **доступ** (m.); «Доступ до дверей» | Generic (data, door, account). Forbidden: «допуск». |
| X07, X08 | otevírací doba; Otevřeno nonstop | opening hours; open 24/7 | **години роботи** (pl.); **Відчинено цілодобово** | Premises are «відчинені», not «відкриті». Forbidden: «часи роботи», «графік відкриття», «нон-стоп», «відкрито 24/7». |
| X10, X12 | Palmovka; Libeň | Palmovka; Libeň | **Пальмовка** (f.; на Пальмовці), **Лібень** (m.; у Лібені) | Style guide §4: place names go into Cyrillic in prose, as Google Maps uk does. In directions keys (`landingLocationTransport`, `faqAnswerTransport`) add the Latin signage form once: «станція метро Пальмовка (Palmovka, лінія B)». Street names and postal addresses stay Latin and Czech (Turnovská 430/10, 180 00 Praha 8 – Libeň). Forbidden: «на Palmovce», «Пальмовкa» with Latin letters, Latin place names in prose. |
| X11 | Praha | Prague | **Прага** (f.; у Празі) | Prose and titles «Прага 8»; postal addresses keep «Praha 8». Forbidden: «Praha» in prose, «Прагa 8» with Latin letters. |
| X13 | metro | metro | **метро** (n., indeclinable) | «дві хвилини від метро». |
| X14 | Google Maps | Google Maps | **Google Maps** | Per style guide §4 (Google's own uk name is «Google Карти»; not used). «Відкрити маршрут у Google Maps». |
| X15 | kontakt | contact | **Контакти** (nav, pl.); «звʼязатися з нами» | Forbidden: «Контакт» as nav label, «Зворотний звʼязок» for the page. |

### G · Consent and privacy

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| G01, L29 | souhlas; odvolání souhlasu | consent; withdrawal of consent | **згода** (f.); **відкликання згоди** | Forbidden: «консент», «дозвіл» (permission), «відмова від згоди». |
| G02, G03, L28 | marketingový souhlas; marketingová sdělení; Souhlas s marketingovou komunikací | marketing consent; marketing messages; Marketing Communications Consent | **згода на маркетингові повідомлення**; **маркетингові повідомлення** (pl.); title **Згода на маркетингові повідомлення** | Forbidden: «спам», «розсилка» (for the consent object), «маркетингова комунікація» (calque). |
| G04, G07, L30 | cookies; nastavení cookies; Zásady používání cookies | cookies; cookie settings; Cookie Policy | **файли cookie** (pl.); **Налаштування файлів cookie**; title **Політика використання файлів cookie** | "cookie" stays Latin, uninflected, after «файли». Cookie name `cc_cookie` untouched. Forbidden: «куки», «кукі», bare «cookies», «печиво». |
| G05, G06 | nezbytné cookies; analytické a marketingové cookies | necessary; analytics and marketing cookies | **необхідні файли cookie**; **аналітичні та маркетингові файли cookie** | Forbidden: «обовʼязкові» (sounds like a legal duty), «технічні». |
| G08, L24 | osobní údaje; zpracování osobních údajů | personal data; processing of personal data | **персональні дані** (pl.); **обробка персональних даних** | GDPR terms. Forbidden: «особисті дані», «особові дані», «опрацювання». |
| G09, L22 | soukromí; Zásady ochrany osobních údajů | privacy; Privacy Policy | **конфіденційність** (f.); title **Політика конфіденційності** | Forbidden: «приватність» (mixing), «Принципи захисту…» as the title. |

### S · Status and errors

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| S01, S02 | stav; čeká | status; pending | **статус** (m.); **очікує** («Очікує оплати») | Forbidden: «стан» for a booking status, «в процесі», «пендінг». |
| S04 | Zkusit znovu; Zkus to znovu | try again | button **Спробувати ще раз**; sentence **Спробуйте ще раз.** | Forbidden: «Спробуй знову» (ти), «Повторіть спробу» on buttons, «Ще раз». |
| S05 | nepodařilo se | could not | **Не вдалося …** | «Не вдалося завантажити бронювання.» Forbidden: «Не вийшло», «Не получилося» (surzhyk), «Неможливо» (= impossible), «Помилка:» as lead-in. |
| S06 | načítání / načíst; Načítáme | loading / load | **Завантаження…**; **Завантажуємо…** | Ellipsis character «…». Forbidden: «Грузиться», «Підвантаження», «Лоадинг». |
| S07, S08 | podpora; pomoc | support; help | **підтримка** (f.), «служба підтримки»; **допомога** (f.) | Forbidden: «саппорт», «техпідтримка» for customer support, «хелп». |
| S09 | neplatný | invalid | **недійсний** (codes, links, sessions); **неправильний** (typed input format: «Неправильний формат IČO») | Forbidden: «невалідний», «некоректний», «неправильний» for an expired code. |

### I · AI assistants

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| I01 | AI asistent | AI assistant | **ШІ-асистент** (m.; ШІ = штучний інтелект) | Czech never says "agent" in UI. Forbidden: «AI-агент», «ШІ-агент», «бот», «чат-бот». |
| I02 | konektor | connector | **конектор** (m.) | Claude custom connector; follow Claude's uk UI label if it differs. Forbidden: «коннектор», «зʼєднувач». |
| I03 | Aplikace (ChatGPT menu); aplikace | Apps; app | ChatGPT menu: **use ChatGPT's own uk label** (default «Застосунки»); generic app **застосунок** (m.) | Generic mobile/web app is always «застосунок». Forbidden: «додаток», «апка», «програмка». |
| I04, I05 | ChatGPT / Claude; MCP | ChatGPT / Claude; MCP | **ChatGPT**, **Claude**, **MCP** | Latin, uninflected: «у ChatGPT», «через протокол MCP». Forbidden: «Чат GPT», «Клод». |

### M · Mobile app

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| M01, M02 | aktualizace; restartovat | update; restart | **оновлення** (n.); **перезапустити** | `update_ready_restart` «Перезапустити». Forbidden: «апдейт», «рестарт», «перезавантажити» (= reboot device). |
| M03 | vrátit se do aplikace | return to the app | **повернутися до застосунку** | `signin_returning_to_app` «Повертаємося до застосунку…». Forbidden: «додатку», «аппки». |

### A · Administration

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| A02 | administrace | administration | **адміністрування** (n.) | Nav/shell name. Forbidden: «адмінка», «адмін-панель», «адміністрація» (= management body). |
| A03, A04 | administrátor; role administrátora | administrator; administrator role | **адміністратор** (m.); **роль адміністратора** | Prefer role phrasing over the person noun: «Надати роль адміністратора», «з правами адміністратора». Forbidden: «адміністратор(-ка)», «адмін». |
| A05, A49 | udělit / odebrat roli; odvolat | grant / revoke role; revoke | **надати роль** / **відкликати роль**; **Відкликати** (session) | English uses "revoke" for both; one Ukrainian verb. Forbidden: «забрати», «видалити роль», «анулювати». |
| A07 | Akce (table column) | actions | **Дії** (pl.) | Not a sale (D06) and not an event (D07). Forbidden: «Акції», «Операції». |
| A09 | rezervace stolu | booking (Dotypos table booking) | **резервування столу** (n.) | Must stay distinct from R01 «бронювання»: «Резервування столу в Dotypos». Forbidden: «бронювання столу», «бронь». |
| A11 | operace | operations | **операції** (f. pl.) | Nexi payment operations. Forbidden: «транзакції» (mixing with K01 «платіж»). |
| A12 | Storno | void | **анулювання** (n.) | Payment-provider void, not a reservation cancellation (R18). Forbidden: «сторно» (accounting reversal in Ukrainian), «скасування», «повернення» (= refund). |
| A14 | aktivita rezervací | reservation activity | **активність бронювань** | Calendar heatmap title. |
| A16, A17, A54 | filtry; stránkování; další / předchozí | filters; pagination; next / previous | **фільтри**; landmark **Навігація сторінками**; **Наступна** / **Попередня** (сторінка) | Buttons «Застосувати фільтри», «Скинути». Forbidden: «пагінація» (jargon in aria labels), «Вперед/Назад». |
| A18 | drobečková navigace | breadcrumb | **навігаційний ланцюжок** (m.) | Landmark label. Forbidden: «хлібні крихти». |
| A19 | export | export | **експорт** (m.); verb **експортувати** | «Експорт у CSV». Forbidden: «вивантаження». |
| A20 | Odběratel | customer (invoice party) | **Покупець** (m.) | Invoice-form heading, as on Ukrainian invoices. Issuer side: «Постачальник». Forbidden: «Одержувач» (reserved for A27), «Абонент». |
| A21 | Položky | line items | **Позиції** (f. pl.) | Forbidden: «Пункти», «Айтеми», «Рядки». |
| A22 | datum splatnosti; po splatnosti; k úhradě | due date; overdue; due | **Сплатити до** / **строк оплати**; **прострочено**; **до сплати** | Ukrainian legal usage: «строк» = period/deadline. Forbidden: «термін оплати», «дедлайн». |
| A23 | variabilní symbol | variable symbol | **варіабельний символ (VS)** | Czech bank payment reference. First mention: «варіабельний символ (VS, ідентифікатор платежу в чеських банках)». Forbidden: «змінний символ», «призначення платежу». |
| A24 | kampaň | campaign (email) | **кампанія** (f.); «email-кампанія» only where Czech says e-mailová | Same word as P15, other surface. Forbidden: «розсилка» for the campaign object, «компанія». |
| A25, A26, A27 | okruh příjemců; uložené publikum; příjemce | audience; saved audience; recipient | **аудиторія** (f.); **збережена аудиторія**; **одержувач** (m.) | One word for both Czech audience terms. Forbidden: «сегмент» (mixing), «публіка», «отримувач» (mixing). |
| A28 | automatizace; automatická kampaň | automation; automated campaign | **автоматизація** (f.); **автоматична кампанія** | Forbidden: «автоматизована розсилка», «флоу». |
| A29, A30 | zkušební běh; běh | dry run; run | **пробне виконання**; **виконання** (n.) | One customer's pass through an automation. Forbidden: «прогін», «ран», «запуск» (reserved for A31). |
| A31, A32 | spuštění; spouštěcí událost | fire (scheduled start); trigger | **запуск** (m.); **подія запуску** (f.) | «Наступні запуски». Forbidden: «тригер», «спрацювання». |
| A33, A34 | krok; podmínka | step; condition | **крок** (m.); **умова** (f.) | Flow builder. Forbidden: «етап», «правило» (for podmínka). |
| A35, A36, A37 | vlastnost zákazníka; slevová skupina; štítky v Dotyposu | customer attribute; discount group; Dotypos tags | **властивість клієнта**; **група знижок**; **мітки в Dotypos** | Dotypos never inflected. Forbidden: «атрибут», «теги», «Dotyposу». |
| A38 | potvrzovací kód | confirmation code | **код підтвердження** (m.) | Typed to confirm a send. Distinct from U06 «код для входу». |
| A39, A40 | předmět; text náhledu | subject; preheader | **тема** (f.); **текст попереднього перегляду** | Email editor labels, as in Gmail uk. Forbidden: «предмет», «сабджект», «прехедер». |
| A41 | šablona | template | **шаблон** (m.) | Forbidden: «темплейт». |
| A42 | účel | purpose | **призначення** (n.) | Marketing vs operational. Forbidden: «мета» (goal). |
| A43, A44 | překlad; zveřejnění | translation; publishing | **переклад** (m.); **публікація** (f.) / **опублікувати** | Forbidden: «оприлюднення» (official-gazette tone), «паблішинг». |
| A45, A46 | archivovat; smazat | archive; delete | **Архівувати**; **Видалити** | Forbidden: «Заархівувати» on buttons, «Стерти», «Удалити» (Russianism). |
| A48 | schválit | approve | **Схвалити** | CLI sign-in approval. Forbidden: «Апрувнути», «Затвердити». |
| A50, A51 | klient (CLI); sestavení | client (software); build | **клієнтська програма** (f.); **збірка** (f.) | Not the legal party «Клієнт». Forbidden: «клієнт» here, «білд». |
| A53 | uložit / vytvořit | save / create | **Зберегти** / **Створити** | Infinitive buttons. Forbidden: «Сохранити», «Зберегти зміни» when space is tight. |
| A55 | název / jméno / příjmení | name / first name / last name | **назва** (things) / **імʼя** (people) / **прізвище** | Forbidden: «імя» (no apostrophe), U+0027 or U+2019 instead of ʼ, «найменування» outside legal. |
| A56 | nepovinné | optional | **необовʼязково** | Field suffix «(необовʼязково)». Forbidden: «опційно», «не обовʼязково». |

### L · Legal documents

| ID(s) | Czech | English | Ukrainian | Notes / forbidden alternatives |
|---|---|---|---|---|
| L01 | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | **Загальні умови надання послуг**; defined short form **«Загальні умови»** | Also the checkout link text in `checkoutPayConsent`. Ukrainian rarely abbreviates; don't coin «ЗУНП». Forbidden: «Публічна оферта», «Правила користування». |
| L02 | Poskytovatel | Provider | **Надавач** (m.; full «Надавач послуг» at definition) | See Key decisions. Forbidden: «Постачальник», «Виконавець», «Провайдер». |
| L04 | Spotřebitel | Consumer | **Споживач** (m.) | Statutory consumer under Czech law. |
| L05 | Smlouva | Contract | **Договір** (m.) | Forbidden: «Контракт», «Угода» (for this defined term). |
| L06, L08 | Prostory; Sdílený pracovní prostor | Premises; shared workspace | **Приміщення** (n.); **спільний робочий простір** | «Приміщення» only as the legal defined term. Forbidden: «Простори», «Площі». |
| L07 | Služby | Services | **Послуги** (f. pl.) | Defined term. |
| L09 | Provozní řád | House Rules | **Правила внутрішнього розпорядку** | Also the `<operatingRules>` link text in checkout. Forbidden: «Регламент», «Правила будинку». |
| L14, L15 | Provozovatel; Uživatel | Operator; User | **Оператор** (m.); **Користувач** (m.) | House Rules parties. If the source ever names a GDPR processor (*zpracovatel*), use «обробник», never «оператор». |
| L17 | odstoupení od smlouvy | withdrawal from the contract | **відмова від договору**; «право на відмову від договору» | Consumer withdrawal right. Forbidden: «розірвання» (= termination), «вихід із договору». |
| L18 | vady a reklamace | defects and complaints | **недоліки та претензії** | GTC §12. Forbidden: «дефекти», «скарги», «рекламації» (dated). |
| L19 | mimosoudní řešení spotřebitelských sporů | alternative consumer dispute resolution | **позасудове вирішення споживчих спорів** | Czech ADR body stays in Czech with an optional gloss. |
| L20 | občanský zákoník / zákon č. 89/2012 Sb. | Civil Code / Act No. 89/2012 Coll. | **zákon č. 89/2012 Sb., občanský zákoník** + once «(Закон № 89/2012 Зб., Цивільний кодекс Чеської Республіки)» | Never cite the Civil Code of Ukraine. |
| L21 | obchodní rejstřík | Commercial Register | **торговий реєстр** (m.) | «вписана до торгового реєстру, який веде Městský soud v Praze (Міський суд у Празі), oddíl C, vložka 442830». Forbidden: «ЄДР», «Єдиний державний реєстр». |
| L23 | Správce osobních údajů | Controller | **Контролер персональних даних** (m.) | GDPR uk term. Forbidden: «Розпорядник», «Володілець» (Ukrainian-law terms). |
| L25, L26, L27 | právní základ; doba uchování; předávání mimo EU | legal basis; retention period; transfers outside the EU | **правова підстава**; **строк зберігання**; **передавання за межі ЄС** | Privacy §4/§5/§7 headings. Forbidden: «юридична основа», «термін зберігання», «трансфер». |

## Grammar and typography notes

### Latin-script names in running text

Brand and third-party names stay in Latin script and **never decline**: Deskohub, Deskohub Workspace, Workspace, Dotypos, Nexi, ChatGPT, Claude, MCP, Google Maps, the tier names. (Place names are different: Пальмовка and Лібень are written in Cyrillic and decline; see X10.) Put the case on a generic noun next to the name:

- «у коворкінгу Deskohub Workspace» (not «у Deskohub Workspaceі»), «до свого облікового запису Deskohub Workspace»
- «через платіжну систему Nexi», «на захищеній платіжній сторінці Nexi»
- «у барі Deskohub», «мітки в Dotypos», «тарифу Cowork Plus»

Never transliterate into Cyrillic (*Дескохаб*, *Нексі*, *Дотипос*) and never attach Cyrillic endings (*Deskohubу*, *Nexi-ю*). A bare name after a preposition («у Workspace», «у ChatGPT») is grammatical for indeclinable foreign names and is fine in short labels.

### Apostrophe

Write the Ukrainian apostrophe as **U+02BC ʼ (MODIFIER LETTER APOSTROPHE)**: *імʼя, обовʼязково, звʼяжіться, памʼять, компʼютер, пʼять*. Not U+0027 `'` and not U+2019 `’`. Store it as the literal UTF-8 character in the JSON catalogs and in the legal documents, not as a `ʼ` escape, so reviewers can read it. U+02BC is a letter, so words stay whole for search, line breaking and screen readers.

### Quotation marks, dashes, numbers

- Quotes: «…» outside, „…“ inside: «Натисніть „Увійти“». Convert the Czech „…“ (e.g. `aiAssistantsChatGptStepAsk`) to «…».
- Dash: a spaced em dash « — » in prose. The Czech spaced hyphen in summary lines (`checkoutSummaryItemMeetingRoom` "Zasedací místnost - {duration}") becomes « — ».
- Numbers, dates, money: never hand-format (style guide §6). Ukrainian `Intl` output uses a decimal comma and a narrow no-break space for thousands. Abbreviations without a dot: «год», «хв», «с» («через {seconds} с»).
- Euphony: alternate у/в and і/й by the neighbouring sounds («у коворкінгу», «в офісі»; «Замовити й оплатити», «ціни і знижки»). It is part of correct Ukrainian, not a style choice.

### Polite ви and imperatives

- Customer and admin instructions use the 2nd-person plural imperative in **-іть / -йте / -те**: *Оберіть, Введіть, Спробуйте, Перевірте, Натисніть, Звʼяжіться, Зверніть увагу*. Never the *ти* forms (*Обери, Введи, Спробуй*). Never «Нажміть» (Russianism) → «Натисніть»; «кнопка нажати» → «натиснути кнопку».
- Prefer «Оберіть» to «Виберіть» for consistency. Prefer «Введіть» to «Вкажіть» for typed values.
- *ви/ваш* stay lowercase in customer and admin copy. A capital at a sentence start («Ваше бронювання…») is ordinary capitalisation, not the legal capitalised *Ви*.

### Gender-neutral techniques

1. Address the reader with *ви*: past tense becomes plural and neutral («ви забронювали», «ви отримали»).
2. Impersonal participles in *-но/-то*: «заброньовано», «надіслано», «оплачено», «Ким заброньовано: {name}».
3. Neutral nouns: «людина» (gramm. f., semantically neutral), «профіль», «обліковий запис», «команда», «роль адміністратора». E.g. «За кожну запрошену людину, яка…» for Czech "Za každého pozvaného, který…".
4. Put names after a colon in a label («Ким заброньовано: {name}», «Для кого: {name}») so the name stays nominative and no verb agrees with it. Avoid «для/від/на імʼя {name}», which need the genitive.
5. Never «(-ла)», «(ка)», slash forms or masculine-plus-feminine doublets.

### Plurals

Ukrainian needs `one` (1, 21, 31…; not 11), `few` (2–4, 22–24…), `many` (0, 5–20, 25–30…, 11–14) and `other` (fractions: genitive singular, usually the `few` text). Message structure and selector names: [../catalogs.md](../catalogs.md).

| | one (1, 21) | few (2–4) | many (0, 5+, 11–14) | other (1,5) |
|---|---|---|---|---|
| година | 1 година | 2 години | 5 годин | 1,5 години |

Renders: 1 година · 2 години · 5 годин · 21 година · 1,5 години. The same pattern for days: «{dayCount} день / дні / днів / дня»; seats: «{count} місце / місця / місць / місця»; invitations: «запрошення / запрошення / запрошень / запрошення».

### Buttons and length

- Buttons use the infinitive without an object where context is clear: «Зберегти», «Скасувати», «Забронювати», «Увійти», «Спробувати ще раз», «Копіювати» (next to the code; not «Копіювати код запрошення»).
- Ukrainian runs 15–25 % longer than Czech. Buttons, tabs, nav items, table headers and badges: Czech length +20 % or about 20 characters, whichever is larger. Page titles ≤ 40 characters before " | Deskohub Workspace"; meta descriptions ≤ 155; customer email subjects ≤ 60, key fact first.
- Shortening tools: drop «свій/ваш» where obvious; use the everyday «переговорна»; «Ціни» instead of «Прейскурант» in UI; «Дані для рахунку-фактури» is a section title, not a button.

## Watch keys

| Key(s) | Risk | Rule |
|---|---|---|
| All 11 customer plural keys: `accountReferralsHowBenchmark`, `reservationMeetingRoomDurationHours`, `reservationOfficeBasePriceLabel`, `reservationOfficeSeatCountOption`, `checkoutSummaryItemOfficeAccess`, `checkoutSummaryItemOfficeSeatCount`, `checkoutSummaryItemOfficeDayCount`, `reservationValidationOfficeMaximumDuration`, `accountReservationSeats`, `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange`; every administration plural message (e.g. `administration:administrationCustomerTableReservationCount`, `access-codes:accessCodesNameTooLong`) | Czech has no `many` text to follow; the wrong form there makes 5+ print the fraction form | `many` is the genitive plural (годин, днів, місць) in every one. Admin `…ReservationCount`: one/few «бронювання», many «бронювань», other «бронювання». |
| `accountReferralsHowBenchmark` | Czech variants are identical (*doporučení* doesn't change); Ukrainian differs (запрошення / запрошень); «достатньо» + genitive breaks with digits | Nominative construction: «Тобто лише {count} запрошення — і ви отримуєте знижку понад {benchmark}!»; many «запрошень». Avoid «достатньо/вистачить {count}…» (genitive). |
| `reservationValidationOfficeMaximumDuration` | «перевищувати» takes the accusative: `one` must be «годину», not «година» | one «…не може перевищувати {hours} годину.», few «години», many «годин», other «години». |
| `bookingWidgetDayCountRange`, `bookingWidgetSeatCountRange` | Czech `one` = "Zvol 1 den." for max = 1; Ukrainian `one` also fires for 21, 31… | Use one case-neutral text in all four variants: «Кількість днів: від 1 до {max}.» / «Кількість місць: від 1 до {max}.» |
| `accountHelpBody` + `accountHelpContact` | `{contact}` is the linked clause «kontaktuj nás» | Translate together: «Якщо вам потрібна допомога з обліковим записом або бронюваннями, {contact}.» + «звʼяжіться з нами» (lowercase imperative). |
| `accountReferralsHowCompound` | `{duration}` is `Intl` output in the nominative («30 днів», «21 день»); «протягом останніх» needs the genitive | «За кожну запрошену людину, яка відвідала нас за останні {duration}, ви отримуєте додаткову знижку {discount}. Знижки сумуються!» («за останні» + accusative = nominative). Also removes the masculine *pozvaný*. |
| `checkoutSummaryItemMeetingRoom`, `pricingMeetingRoomProduct`, `reservationValidationMeetingRoomDuration` | `{duration}` / `{durations}` hold nominative phrases | Keep them after « — », a comma or a colon: «Переговорна кімната — {duration}», «…одне з таких значень: {durations}.» |
| `reservationAvailabilityUnavailable` | `{tier}` is a tier title (Latin or translated) in a genitive slot | «Бронювання тарифу {tier} у вибраній конфігурації недоступне на {date}. Спробуйте іншу пропозицію або дату — або, якщо ви обрали робочу станцію, іншу конфігурацію моніторів!» |
| `checkoutSummaryDiscountDetailsTrigger`, `pricingReserveLabel`, `checkoutEmailAuthorHeading` | `{product}` / `{customer}` would need oblique cases | «Показати знижки: {product}», «Забронювати: {product}», «Заброньовано: {product}. Для кого: {customer}». |
| `accountReservationBookedBy`, `accountReservationBookedFor`, `accountProfileScreenMemberFallback`, `accountProfileReferralCodeHint` | Gender marking (Rezervoval(a), Člen, "Pozval tě jiný zákazník… jeho kód") | «Ким заброньовано: {name}», «Для кого: {name}», «Профіль Workspace», «Маєте код запрошення від іншого клієнта Workspace? Введіть його…» («його» = код). |
| `checkoutPayConsent`, `checkoutPaymentRetryConsent` | First-person declaration carrying the withdrawal waiver; tag link texts are document titles; leading space inside `<earlyPerformance>` | Needs legal review. «Я погоджуюся з документами <terms>Загальні умови надання послуг</terms>, <operatingRules>Правила внутрішнього розпорядку</operatingRules>.<earlyPerformance> Оскільки послуга починається протягом установленого законом строку для відмови від договору, я прямо прошу надати її в заброньований час і беру до відома, що після повного надання послуги моє право на відмову від договору припиняється.</earlyPerformance>». Retry: «Ще раз підтверджую, що погоджуюся з документами…». |
| `checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton` | Legal button wording | «Замовити й оплатити», «Замовити й оплатити {amount}». |
| `accountReferralsDiscountInfo`, `accountReferralsHowInvite`, `accountReservationPinUnavailable`, `accountReservationOtherProduct`, `accountMetadataDescription`, `ttrpgRoomMetadataDescription`, `landingOfferingTtrpgText`, `faqAnswerTtrpg`, `notFoundHomeLink`, `cookieConsentConsentModalTitle` | "ve Workspace" / "s Workspace" / "webu Workspace" after a preposition or in a genitive slot | Generic noun: «будь-якого бронювання в коворкінгу Workspace», «головна сторінка Workspace», «сайту Workspace». |
| `marketingPreferencesFormRowDescription`, `ttrpgRoomBarChoiceText`, `ttrpgRoomHeroLead`, `ttrpgRoomBarPrefillMessage`, `ttrpgRoomBarImageAlt`, `landingFaqItemThreeAnswer` | Czech inflects *Deskohubu*, *Deskohub Baru* | «дозволяєте Deskohub надсилати вам…», «в атмосфері бару Deskohub», «у барі Deskohub». |
| `checkoutPayProviderHandoff`, `checkoutStatusPendingLead` | Nexi in a locative/genitive slot | «на захищеній платіжній сторінці Nexi», «вкладку оплати Nexi». |
| Palmovka/Libeň keys: `landingMetadataTitle`, `landingHeroTitle`, `coworkingHeroTitle`, `coworkingMetadataTitle`, `meetingRoomMetadataTitle`, `reservationCoworkMetadataTitle`, `galleryMetadataTitle`, `faqMetadataTitle`, `landingLocationTransport`, `faqAnswerTransport`, `workspaceDescription`, `landingUiHeroFlowStepThreeText` | Czech *na Palmovce*, *v Libni*; titles ≤ 40 characters | «Коворкінг на Пальмовці, Прага 8», «у Лібені на вулиці Turnovská», «станція метро Пальмовка (Palmovka, лінія B)». |
| `pricingIntro` | Czech writes "Kč" in prose | «Ціни в CZK за все, що можна забронювати онлайн.» |
| `reservationTierPerkAllBasic` | Tier name after a genitive | «усі переваги тарифу Basic». |
| `checkoutDiscountCodeLabel` | Three distinct concepts | «Знижка, ваучер або код запрошення». |
| `accountSignInPasskey`, `landingAccessStepKeypad` | Passkey vs access code; keypad vs keyboard | «Увійти з ключем доступу»; «Введіть PIN на кодовій панелі біля вхідних дверей. Застосунок не потрібен.» |
| `footerVatStatus`, `invoiceNonVatPayerStatement`, `reservationBillingCompanyIdLabel`, `reservationBillingVatIdLabel` | Czech tax ids | «компанія не є платником ПДВ», «Ми не є платниками ПДВ.», «IČO», «DIČ (необовʼязково)», with the glosses from K20/K21 where a hint fits. |
| `faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales` | Visitor asks the venue (Czech *vy*) | «У вас є приватні офіси?» etc. *ви* here addresses the venue. |
| `checkoutStatusLatePaymentReviewContactMessage` (+ `…FulfillmentFailedContactMessage`, `…PaymentPendingContactMessage`) | Pre-filled email from the customer to the venue | First person, «Добрий день», polite to the venue; keep `{reservationDetails}` on its own line. |
| Font coverage (all surfaces) | Cyrillic glyphs and U+02BC ʼ may be missing in the web font and fall back mid-word | Check rendered pages on a preview deployment before release. |
