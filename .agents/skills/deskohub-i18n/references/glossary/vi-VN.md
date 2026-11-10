# Vietnamese (vi-VN) glossary: Deskohub Workspace

Locale: **vi-VN**. Source: Czech (`cs-CZ`), cross-check: English (`en-US`). Every concept ID in [terms.md](terms.md) appears below at least once.

This file is binding for the vi-VN customer catalog, administration catalogs, legal documents and mobile catalog. The shared rules are in [style-guide.md](style-guide.md): sources and precedence, do-not-translate list, placeholders, plurals and length. Where the two differ, this file wins for Vietnamese.

Vietnamese readers of this site are mostly people living or travelling in Prague. Write natural, plain Vietnamese as used in Vietnamese apps and booking sites, not a word-for-word rendering of the Czech. Keep sentences short and drop pronouns where Vietnamese naturally does.

## Register

| Surface | Register | Examples |
|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | neutral **bạn** (lowercase mid-sentence, *Bạn* at the start), friendly; drop *bạn* / *của bạn* when the sentence stays clear without it | *Bạn có thể đặt chỗ…*, *Hãy thử lại.*, *Đặt chỗ của bạn đã được xác nhận.* |
| Three customer FAQ questions where the visitor addresses the venue (`faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales`) | the visitor asks the venue, no pronoun | *Ở đây có văn phòng riêng không?*, *Có chương trình giảm giá không?* |
| Pre-filled support emails the customer sends (`checkoutStatus*ContactMessage`) | the customer's polite voice: *Xin chào,* + first person **tôi**, the venue addressed without a pronoun or as *Deskohub* | *Xin chào, khoản thanh toán của tôi đến sau khi thời gian giữ chỗ đã hết. Vui lòng kiểm tra đặt chỗ của tôi.* |
| Administration (staff UI, staff emails) | formal and impersonal: **no second-person pronoun**; requests with **Vui lòng** + verb; statements without a subject | *Vui lòng chọn khách hàng.*, *Không thể tải dữ liệu. Vui lòng thử lại.* |
| Legal documents | formal; third person through defined terms; where the Czech addresses the reader directly, **Quý khách** | *Khách hàng có nghĩa vụ…*, *Quý khách có thể rút lại sự đồng ý bất cứ lúc nào.* |

- Customer requests and retries use **Hãy** (*Hãy thử lại.*, *Hãy chọn ngày.*); administration uses **Vui lòng** (*Vui lòng thử lại.*). This is the main visible register difference, so keep it consistent.
- Never use *anh/chị*, *em*, *mình*, *bạn ơi* or *quý vị*. Never use *bạn* in administration or legal text.
- Buttons, menu items and tabs use a bare verb phrase in sentence case in every surface (*Lưu*, *Hủy*, *Thử lại*, *Đặt chỗ coworking*). A bare verb is not informal, so the same button text works in admin.
- First-person declarations (checkout consent, `checkoutPayConsent`) use **Tôi** (*Tôi đồng ý với…*, *tôi yêu cầu rõ ràng…*).

## Brand and name rule

Vietnamese has no case endings, so brands, tier names and place names never change form. Put them where Vietnamese word order wants them: the head noun first, the name after it.

- **Deskohub Workspace**, **Workspace**, **Deskohub**, **Deskohub Bar**, **Dotypos**, **Nexi**: unchanged, Latin script, exact capitalisation. *tại Workspace*, *trên trang thanh toán của Nexi*, *nhãn trong Dotypos*.
- Tier names (**Basic Day Pass**, **Cowork Plus**, **Profi Workstation**, **Basic**) follow the generic noun *gói*: *gói Basic Day Pass*, *mọi quyền lợi của gói Basic*, *đặt gói {tier}*.
- **Praha** is also the Vietnamese name of the city: *ở Praha*, *Praha 8* in addresses. ✗ *Prague*, ✗ *Prag*. **Palmovka**, **Libeň** unchanged: *ở Palmovka*, *quận Libeň*.

## Glossary

Columns: concept ID(s) | Czech | English | Vietnamese | Notes and forbidden alternatives. "✗" marks a forbidden form.

### P: products and spaces

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| P01, P02 | coworking, cowork | coworking, cowork | **coworking** (*không gian coworking*, *chỗ ngồi coworking*) | The loan is the everyday word in Vietnam. One concept, one word: Czech *cowork* in CTAs also becomes *coworking*: `landingHeroPrimaryCta` → *Đặt chỗ coworking*. ✗ *cowork* alone, ✗ *làm việc chung* as the product name (fine in a description). |
| P03 | open space / otevřený prostor; sdílené místo | open space; shared desk | **không gian mở**; the product **chỗ ngồi chung** | The open-space desk product (`reservationOpenSpaceTitle`, Czech *sdílené místo*) is *Chỗ ngồi chung* on every surface. Tier bullets that describe the space keep *không gian mở*: `reservationTierBasicBulletDesk` "Open-space místo" → *Chỗ ngồi trong không gian mở*. ✗ *chỗ ngồi dùng chung*, ✗ *open space* in prose. |
| P04, P05 | zasedací místnost, zasedačka | meeting room | **phòng họp** | Vietnamese has no formal/colloquial pair, so both become *phòng họp*: `landingHeroMeetingRoomCta` → *Đặt phòng họp*. ✗ *phòng hội nghị* (conference hall), ✗ *meeting room*. |
| P06, P07 | kancelář; soukromá kancelář | office; private office | **văn phòng**; **văn phòng riêng** | ✗ *văn phòng tư nhân* (reads as "private-sector office"), ✗ *phòng làm việc riêng*. |
| P08 | pracovní stanice | workstation | **trạm làm việc** | The Profi tier desk with monitors. Keep it distinct from P09. ✗ *máy trạm* (a computer). |
| P09 | vyhrazené místo | reserved desk | **chỗ ngồi giữ riêng** | A desk kept for the customer for the day. ✗ *chỗ đã đặt* (blurs with the reservation itself), ✗ *chỗ cố định* (implies a permanent desk). |
| P10 | stůl | desk / table | **bàn** | The cowork desk and the Dotypos table behind admin bookings (A09). |
| P11, R21 | místo; přiřazené místo | spot / seat / desk; assigned desk | **chỗ** / **chỗ ngồi**; **chỗ được chỉ định** | Count noun: *{count} chỗ*. `accountReservationSeatsLabel` → *Số chỗ*. `accountReservationAssignedDesk` → *Chỗ được chỉ định*. ✗ *ghế* (a chair). |
| P12, P14 | místnost; TTRPG místnost | room; TTRPG room | **phòng**; **phòng TTRPG** | Acronym stays. |
| P13, L08 | prostor / pracovní prostor; Sdílený pracovní prostor | space / workspace (generic); shared workspace | **không gian**, **không gian làm việc**; **không gian làm việc chung** | Lowercase generic noun, not the brand Workspace. |
| P15 | kampaň (TTRPG) | campaign (role-playing) | **campaign** | Vietnamese TTRPG players keep the English word, like *one-shot*: `ttrpgRoomMetadataDescription` → *Dành cho campaign hoặc one-shot…*. Keeps it apart from the admin email *chiến dịch* (A24). ✗ *chiến dịch* here. |
| P16 | one-shot | one-shot | **one-shot** | Loan stays. |
| P17 | bar | bar | **quán bar** | Deskohub Bar stays a name. Czech *deskovky* → *board game*. ✗ *quán rượu* (pub/tavern). |
| P18, X09 | provozovna; adresa provozovny | venue / premises; venue address | **cơ sở**; **địa chỉ cơ sở** | `footerCompanyAddressLabel` → *Địa chỉ cơ sở*. Legal premises use L06. |
| P19 | nabídka | offering / options | **lựa chọn** (tier picker label); **dịch vụ** (what we offer, in prose) | `reservationTierLabel` → *Lựa chọn*. `reservationAvailabilityUnavailable` "jinou nabídku" → *lựa chọn khác*. ✗ *ưu đãi* (that is a deal). |
| P20, P21 | tarif; výhody | tier / plan; perks | **gói**; **quyền lợi** | *gói Basic*, *mọi quyền lợi của gói Basic*. `reservationTierPerksLabel` → *Quyền lợi*. ✗ *hạng*, ✗ *cấp*, ✗ *ưu đãi* for perks. Legal defined term L10. |
| P22, P23, P24 | Basic Day Pass, Cowork Plus, Profi Workstation | same | **Basic Day Pass**, **Cowork Plus**, **Profi Workstation** (and **Basic**) | Never translate. ✗ *vé ngày*, ✗ *thẻ ngày*. |
| P25, P29 | monitorový setup; monitor | monitor setup; monitor | **cấu hình màn hình** (*cấu hình chuyên nghiệp* for "profi setup"); **màn hình** | Czech *sestava monitorů* → *cấu hình màn hình*. ✗ *setup* in prose, ✗ *monitor*. |
| P26, P27 | batch brew káva; káva zdarma | batch brew coffee; free coffee | **cà phê batch brew**; **cà phê miễn phí** | "batch brew" stays as the loan. |
| P28 | Wi-Fi | Wi-Fi | **Wi-Fi** | Spelling stays: *mật khẩu Wi-Fi*. ✗ *wifi*, ✗ *mạng không dây* in labels. |
| P30 | člen Workspace | Workspace member | **Thành viên Workspace** | `accountProfileScreenMemberFallback`. *Thành viên* is gender-neutral. |
| P31, P32, P33 | Deskohub Workspace, Workspace, Deskohub | same | **Deskohub Workspace**, **Workspace**, **Deskohub** | Unchanged. `accountReferralsDiscountInfo` "ve Workspace" → *tại Workspace*. |

### R: reservation and time

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| R01, D11 | rezervace; první rezervace | reservation; first reservation | **đặt chỗ** (noun and verb; *lượt đặt chỗ* when counted); **lần đặt chỗ đầu tiên** | The core noun in customer UI and admin: *đặt chỗ của bạn*, *chi tiết đặt chỗ*, *{count} lượt đặt chỗ*. ✗ *booking*, ✗ *sự đặt trước*, ✗ *đặt bàn* (that is A09). Legal: L13. |
| R02 | rezervovat | book / reserve | **đặt** / **đặt chỗ** | `landingHeroPrimaryCta` → *Đặt chỗ coworking*; meeting room → *Đặt phòng họp*. ✗ *book*, ✗ *giữ chỗ* (that is the checkout hold, K25). |
| R03 | rezervační | booking (adj.) | **đặt chỗ** after the noun | *biểu mẫu đặt chỗ*, *liên kết đặt chỗ*, `reservationSuccessMessage` "Rezervační poptávka" → *Yêu cầu đặt chỗ*. |
| R04, A10 | objednávka; objednávky | order; orders | **đơn hàng** | Order ID: *mã đơn hàng*. ✗ *đơn đặt hàng* in labels (too long). |
| R05 | objednat a zaplatit | order and pay | **Đặt và thanh toán**; with amount **Đặt và thanh toán ({amount})** | Final checkout button (`checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton`). Czech law (§ 1826a OZ, Art. 8(2) Directive 2011/83/EU) requires wording that makes the payment obligation unambiguous; *thanh toán* in the button states it, as the Czech does. ✗ *Tiếp tục*, ✗ *Gửi*, ✗ *Đặt chỗ* alone. |
| R06 | poptávka | inquiry | **yêu cầu** (*gửi yêu cầu*) | Contact-form request for offices and events: *gửi yêu cầu cho công ty*. ✗ *đơn hỏi giá*. |
| R07, R08 | termín; datum | date / time slot; date | **thời gian** / **khung giờ** (slot); **ngày** | A date or slot, not a deadline. ✗ *hạn chót*, ✗ *thời hạn*. |
| R09, R10 | začátek; konec | start; end | **Bắt đầu**; **Kết thúc** | Labels. |
| R11 | délka | duration | **thời lượng** | `reservationMeetingRoomDurationLabel` → *Thời lượng*. ✗ *độ dài*. |
| R12, R13 | hodina; den | hour; day | **giờ** (*{count} giờ*); **ngày** (*{count} ngày*); *cả ngày* | Vietnamese nouns don't change with the count. `reservationMeetingRoomDurationWholeDay` → *Cả ngày*. ✗ *tiếng* (spoken "hour"). |
| R14, R15, R16 | dostupnost; volný / volno; obsazeno | availability; available / free; booked / taken | **tình trạng còn chỗ**; **còn trống** / **còn chỗ**; **đã kín chỗ** / **hết chỗ** | `reservationAvailabilityError` → *Không thể kiểm tra tình trạng còn chỗ.* ✗ *miễn phí* for "free slot" (that is free of charge). `bookingWidgetNotAvailable` → *Có vẻ đã hết chỗ.* |
| R17 | potvrzení | confirmation | **xác nhận** (*email xác nhận*) | |
| R18, L16 | zrušení / zrušit | cancellation / cancel | **hủy** (*hủy đặt chỗ*, *đã hủy*) | ✗ *huỷ* (see typography: traditional tone placement). |
| R19 | změna | change | **thay đổi** | |
| R20 | Rezervoval(a) {name} | Booked by {name} | **Người đặt: {name}** | Vietnamese is gender-neutral here anyway; keep the label form. |
| R22, R23 | platnost / platí; vypršet | validity / is valid; expire | **hiệu lực** (*còn hiệu lực*, *có hiệu lực trong 10 phút*); **hết hạn** | `checkoutPayInvalidStateTitle` → *Liên kết thanh toán đã hết hạn*. |

### K: payment and billing

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| K01, K02, K03 | platba; zaplatit; zaplaceno | payment; pay; paid | **thanh toán** (noun: *khoản thanh toán*); **thanh toán**; **đã thanh toán** | ✗ *trả tiền* in UI labels (fine in casual prose). |
| K04, K05 | platební karta; platební metoda | payment card; payment method | **thẻ thanh toán**; **phương thức thanh toán** | |
| K06, K07 | platební brána; platební odkaz | payment gateway; payment link | **cổng thanh toán**; **liên kết thanh toán** | ✗ *link* in prose. |
| K08 | Nexi | Nexi | **Nexi** | *trang thanh toán bảo mật của Nexi*. |
| K09, K10, K11 | cena; základní cena / původní cena; ceník | price; base price / original price; price list | **giá**; **giá gốc**; **bảng giá** | *giá gốc* covers both the base price and the struck-through original price (`checkoutSummaryOriginalPrice`). ✗ *giá ban đầu*, ✗ *chi phí* for price. Legal L11. |
| K12, K13, K14 | částka; celkem; měna | amount; total; currency | **số tiền**; **tổng cộng**; **tiền tệ** | |
| K15 | Kč | CZK | **CZK** | Prose that names the currency writes *CZK* (`pricingIntro`, `accountBillingCurrency` → *Tiền tệ: CZK*). ✗ *Kč*, ✗ *koruna Séc* in UI, ✗ any VND or EUR conversion. |
| K16, K17 | faktura; fakturační údaje | invoice; billing details | **hóa đơn**; **thông tin xuất hóa đơn** | The only tax document. ✗ *biên lai* (receipt), ✗ *hoá đơn*. |
| K18, K19 | DPH; neplátce DPH | VAT; not a VAT payer | **VAT** (prose: *thuế VAT*); **không đăng ký nộp thuế VAT** | Czech VAT fact kept. `footerVatStatus` → *…công ty không đăng ký nộp thuế VAT*; `invoiceNonVatPayerStatement` → *Chúng tôi không đăng ký nộp thuế VAT.* ✗ *GTGT* (reads as Vietnamese tax), ✗ *DPH* untranslated in prose. |
| K20, K21 | IČO; DIČ | company ID number; VAT ID | **Mã số doanh nghiệp (IČO)**; **Mã số thuế (DIČ)** | Labels translate, values never. ARES is the Czech company register: *sổ đăng ký doanh nghiệp của Séc*. |
| K22, K23, K24 | firma / společnost; PSČ; ulice | company; postal code; street | **công ty**; **mã bưu chính**; **đường** (*Đường và số nhà*) | |
| K25 | platba po vypršení blokace rezervace | payment after the reservation hold expired | **thanh toán sau khi thời gian giữ chỗ đã hết** | *blokace rezervace* = **giữ chỗ** (the temporary hold during checkout). The pre-filled email is the customer's own polite voice (see Register). |

### D: discounts and referrals

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| D01, D02, D03 | sleva; slevový kód; kód | discount; discount code; code | **giảm giá** (noun: *mức giảm giá*); **mã giảm giá**; **mã** | ✗ *chiết khấu* (accounting term), ✗ *coupon*. |
| D04, A57 | poukaz; propagační poukaz | voucher; promotional voucher | **voucher**; **voucher khuyến mãi** | The loan is standard in Vietnamese commerce. ✗ *phiếu quà tặng*, ✗ *thẻ quà tặng* (gift card) unless the Czech says *dárkový*. |
| D05 | Sleva, poukaz nebo doporučovací kód | Discount, voucher or referral code | **Mã giảm giá, voucher hoặc mã giới thiệu** | Three concepts stay distinct. |
| D06, A08 | akce (sale) | sale / promotion | **khuyến mãi** (*đợt khuyến mãi*, *chương trình khuyến mãi*) | `landingSaleBanner*`, `discounts:discountsSalesTitle` → *Khuyến mãi*. ✗ *sale*, ✗ *sự kiện*. |
| D07 | akce (event) | event | **sự kiện** | `landingOfferingEvents` → *Sự kiện*. |
| D08, D09, D10 | doporučení; doporučovací kód; doporučovací odkaz | referral; referral code; referral link | **giới thiệu** (*lượt giới thiệu* when counted, *chương trình giới thiệu*); **mã giới thiệu**; **liên kết giới thiệu** | ✗ *referral*, ✗ *tiến cử*. |

### U: account and sign-in

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| U01, U02, U15 | účet; profil; zákaznický účet | account; profile; customer account | **tài khoản**; **hồ sơ**; **tài khoản khách hàng** | |
| U03, U04 | přihlásit se; odhlásit se | sign in; sign out | **đăng nhập**; **đăng xuất** | ✗ *log in*, ✗ *vào tài khoản* on buttons. |
| U05, U06 | přihlašovací odkaz; přihlašovací kód | sign-in link; sign-in code | **liên kết đăng nhập**; **mã đăng nhập** | Never *magic link*. |
| U07 | přístupový klíč | passkey | **khóa truy cập** | Google's and Microsoft's Vietnamese term. Must not collide with the door access code (X01 *mã ra vào*). ✗ *passkey* in prose, ✗ *mã khóa*, ✗ *mã truy cập*. |
| U08, U09 | správce hesel; heslo | password manager; password | **trình quản lý mật khẩu**; **mật khẩu** | |
| U10 | relace | session | **phiên đăng nhập** (*phiên* when context is clear) | |
| U11, U12 | zařízení; prohlížeč | device; browser | **thiết bị**; **trình duyệt** | A browser tab is *thẻ*: *mở trong thẻ mới*. |
| U13 | ověření / ověřit | verification / verify | **xác minh** | ✗ *xác thực* (that is authentication). |
| U14 | e-mail | email | **email** | One spelling. ✗ *e-mail*, ✗ *thư điện tử* in UI. |
| U16, A06 | zákazník | customer | **khách hàng** | UI and admin. Legal uses the defined term L03. |
| U17 | telefon | phone | **số điện thoại** (label *Điện thoại*) | Placeholder example *+84 900 000 000*. |

### X: access and venue

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| X01, A01 | přístupový kód | access code | **mã ra vào** | The door code for a reservation (customer) and the staff-created door code (admin). ✗ *mã truy cập* (blurs with passkey U07), ✗ *mã cửa*. |
| X02, L12 | PIN / PIN kód; Přístupový PIN kód | PIN / PIN code; Access PIN Code | **mã PIN**; legal **Mã PIN Ra vào** | Keep *PIN*. |
| X03, X04, X05 | dveře; klávesnice; vstup | door; keypad; entry | **cửa**; **bàn phím số** (keypad); **lối vào** / **vào cửa** | ✗ *bàn phím* alone (a computer keyboard). |
| X06, A15 | přístup; přístup ke dveřím | access; door access | **quyền truy cập** (data, account); **quyền ra vào** (door) | |
| X07, X08 | otevírací doba; otevřeno nonstop | opening hours; open 24/7 | **giờ mở cửa**; **mở cửa 24/7** | |
| X10, X11, X12 | Palmovka; Praha; Libeň | same | **Palmovka**; **Praha**; **Libeň** | See the brand and name rule. Postal addresses stay Czech. |
| X13 | metro | metro | **tàu điện ngầm** (metro); tram **tàu điện** | `landingLocationTransport`: *ga tàu điện ngầm Palmovka*. |
| X14, X15 | Google Maps; kontakt | Google Maps; contact | **Google Maps**; **liên hệ** | |

### G: consent and privacy

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| G01, G02, G03 | souhlas; marketingový souhlas; marketingová sdělení | consent; marketing consent; marketing messages | **sự đồng ý** (verb *đồng ý*); **đồng ý nhận thông tin tiếp thị**; **thông tin tiếp thị** | ✗ *quảng cáo* for marketing messages, ✗ *marketing*. |
| G04, G05, G06, G07 | cookies; nezbytné cookies; analytické a marketingové cookies; nastavení cookies | cookies; necessary cookies; analytics and marketing cookies; cookie settings | **cookie** (no plural *-s*); **cookie thiết yếu**; **cookie phân tích và tiếp thị**; **cài đặt cookie** | ✗ *cookies*, ✗ *bánh quy*. |
| G08, G09, L24 | osobní údaje; soukromí; zpracování osobních údajů | personal data; privacy; processing of personal data | **dữ liệu cá nhân**; **quyền riêng tư**; **xử lý dữ liệu cá nhân** | ✗ *thông tin cá nhân* in legal text (UI may use it where Czech says *údaje* loosely, but prefer *dữ liệu cá nhân*). |

### S: status and errors

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| S01, S02, S03 | stav; čeká; potvrzeno | status; pending; confirmed | **trạng thái**; **đang chờ**; **đã xác nhận** | |
| S04 | zkusit znovu | try again | **Thử lại** (button); customer sentence *Hãy thử lại.*; admin *Vui lòng thử lại.* | |
| S05 | nepodařilo se | could not | **Không thể…** | *Không thể tải đặt chỗ.* Don't add apologies (*Xin lỗi*) the Czech doesn't have. |
| S06 | načítání / načíst | loading / load | **Đang tải…**; **tải** | |
| S07, S08 | podpora; pomoc | support; help | **bộ phận hỗ trợ** / **hỗ trợ**; **trợ giúp** | |
| S09 | neplatný | invalid | **không hợp lệ** | |

### I: AI assistants

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| I01 | AI asistent | AI assistant | **trợ lý AI** | ✗ *tác nhân AI*, ✗ *AI agent*. |
| I02 | konektor | connector | **trình kết nối** | Claude custom connector: *trình kết nối tùy chỉnh*. |
| I03, I04 | aplikace (ChatGPT); ChatGPT / Claude | app; ChatGPT / Claude | **Ứng dụng** (ChatGPT's Vietnamese menu label); **ChatGPT**, **Claude** | Product names stay. |
| I05 | MCP | MCP | **MCP** | |

### M: mobile

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| M01, M02, M03 | aktualizace; restartovat; vrátit se do aplikace | update; restart; return to the app | **bản cập nhật**; **khởi động lại**; **quay lại ứng dụng** | `home_signed_in_as` → *Đã đăng nhập: {email}*. |

### A: administration (formal, impersonal)

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| A02 | administrace | administration | **trang quản trị** | ✗ *admin* in prose. |
| A03, A04, A05 | administrátor; role administrátora; udělit / odebrat roli | administrator; administrator role; grant / revoke role | **quản trị viên**; **vai trò quản trị viên**; **cấp / thu hồi vai trò** | Gender-neutral. |
| A07 | akce (actions) | actions | **Thao tác** | Table column header. Not a sale (A08), not an event (D07). |
| A09 | rezervace stolu | booking (Dotypos) | **đặt bàn** (*lượt đặt bàn*, *chi tiết đặt bàn*) | The Dotypos table booking behind a reservation. Always *đặt bàn*, never *đặt chỗ* (R01), so the two stay apart. |
| A11, A12, A13 | operace; storno; platba nedokončena | operations; void; payment abandoned | **giao dịch**; **hủy giao dịch (void)** in the type label, **void** in compact columns; **bỏ dở thanh toán** | *storno* is the payment-provider void, not a reservation cancellation (*hủy đặt chỗ*). ✗ *thao tác* for operations (that is A07). |
| A14 | aktivita rezervací | reservation activity | **hoạt động đặt chỗ** | |
| A16, A17, A18, A19 | filtry; stránkování; drobečková navigace; export | filters; pagination; breadcrumb; export | **bộ lọc**; **phân trang**; **đường dẫn điều hướng**; **xuất** (*xuất CSV*) | |
| A20, A21, A22 | odběratel; položky; datum splatnosti / po splatnosti / k úhradě | customer (invoice); line items; due date / overdue / due | **bên mua** (supplier *dodavatel* → **bên bán**); **hạng mục**; **hạn thanh toán** / **quá hạn** / **cần thanh toán** | Statutory invoice parties. |
| A23 | variabilní symbol | variable symbol | **mã thanh toán (variabilní symbol)** | A Czech bank payment reference with no Vietnamese equivalent: gloss it once per screen, then *mã thanh toán*. |
| A24, A28 | kampaň; automatizace / automatická kampaň | campaign; automation / automated campaign | **chiến dịch** (*chiến dịch email*); **tự động hóa** / **chiến dịch tự động** | |
| A25, A26, A27 | okruh příjemců; uložené publikum; příjemce | audience; saved audience; recipient | **nhóm người nhận**; **nhóm người nhận đã lưu**; **người nhận** | One concept, one word for A25 and A26. ✗ *khán giả*, ✗ *đối tượng* for audience. |
| A29, A30, A31, A32, A33 | zkušební běh; běh; spuštění; spouštěcí událost; krok | dry run; run; fire; trigger; step | **chạy thử**; **lượt chạy**; **lần khởi chạy**; **sự kiện kích hoạt**; **bước** | **kích hoạt** alone is reserved for activating an automation or a version (*aktivace*); a scheduled fire is *lần khởi chạy*. The step sequence of an automation (flow) is **kịch bản**; a heading inside an editor is **đầu đề**, never *tiêu đề* (email subject, A39). |
| A34, A35, A36, A37 | podmínka; vlastnost zákazníka; slevová skupina; štítky v Dotyposu | condition; customer attribute; discount group; Dotypos tags | **điều kiện**; **thuộc tính khách hàng**; **nhóm giảm giá**; **nhãn trong Dotypos** | Dotypos uninflected. |
| A38, A39, A40, A41, A42, A43, A44 | potvrzovací kód; předmět; text náhledu; šablona; účel; překlad; zveřejnění | confirmation code; subject; preheader; template; purpose; translation; publishing | **mã xác nhận**; **tiêu đề**; **dòng xem trước**; **mẫu**; **mục đích**; **bản dịch**; **xuất bản** | Subject: *Tiêu đề email* when it could be confused with a page title. |
| A45, A46 | archivovat; smazat | archive; delete | **lưu trữ**; **xóa** | ✗ *xoá*. |
| A47, A48, A49, A50, A51 | relace CLI; schválit; odvolat; klient (CLI); sestavení | CLI session; approve; revoke; client; build | **phiên CLI**; **phê duyệt**; **thu hồi**; **ứng dụng khách**; **bản dựng** | *ứng dụng khách* (software client) never mixes with the legal *Khách hàng* (L03). |
| A52, A53, A54 | zrušit; uložit / vytvořit; další / předchozí | cancel; save / create; next / previous | **Hủy**; **Lưu** / **Tạo**; **Tiếp** / **Trước** | |
| A55, A56 | název / jméno / příjmení; nepovinné | name / first name / last name; optional | **tên** (things and people), **tên** (first name), **họ** (last name); **(không bắt buộc)** | Field order follows the Czech form, not Vietnamese "họ tên" order. |

### L: legal (formal; Czech law, Vietnamese defined terms)

Defined terms are capitalised on the first letter of each word that the defined term capitalises below, in every use (*Bên Cung cấp*, *Khách hàng*, *Đặt chỗ*). The first definition uses *(sau đây gọi là “…”)*, the Vietnamese equivalent of *(dále jen „…“)*.

| ID(s) | Czech | English | Vietnamese | Notes / forbidden alternatives |
|---|---|---|---|---|
| L01 | Všeobecné obchodní podmínky (VOP) | General Terms and Conditions (GTC) | **Điều kiện Giao dịch Chung** | The Vietnamese consumer-law term for standard terms. Where the Czech writes the abbreviation *VOP*, write the full term or *các Điều kiện Giao dịch Chung này*. ✗ *Điều khoản dịch vụ*, ✗ *VOP* left untranslated. |
| L02, L03, L04 | Poskytovatel; Klient; Spotřebitel | Provider; Client; Consumer | **Bên Cung cấp**; **Khách hàng**; **Người tiêu dùng** | *Bên Cung cấp* = Desktechub s.r.o.; *Khách hàng* = the contracting customer, never the software client (A50); *Người tiêu dùng* = the statutory consumer. |
| L05, L06, L07 | Smlouva; Prostory; Služby | Contract; Premises; Services | **Hợp đồng**; **Mặt bằng**; **Dịch vụ** | ✗ *Không gian* for Prostory (clashes with P13). |
| L09 | Provozní řád | House Rules | **Nội quy** | The checkout consent links it as *Nội quy*. ✗ *Quy chế hoạt động*. |
| L10, L11, L13 | Tarif; Ceník; Rezervace | Tariff; Price List; Booking | **Gói**; **Bảng giá**; **Đặt chỗ** | Same roots as UI P20, K11, R01, capitalised. |
| L14, L15 | Provozovatel; Uživatel | Operator; User | **Bên Vận hành**; **Người dùng** | House Rules parties. |
| L17 | odstoupení od smlouvy | withdrawal from the contract | **rút khỏi hợp đồng** (*quyền rút khỏi hợp đồng*) | Consumer right of withdrawal, also in `checkoutPayConsent`. ✗ *hủy hợp đồng* (that is termination). |
| L18, L19 | vady a reklamace; mimosoudní řešení spotřebitelských sporů | defects and complaints; alternative consumer dispute resolution | **khiếm khuyết và khiếu nại**; **giải quyết tranh chấp tiêu dùng ngoài tòa án** | The ADR body stays Czech (ČOI): *Cơ quan Thanh tra Thương mại Séc (Česká obchodní inspekce, ČOI)*. |
| L20 | Občanský zákoník / zákon č. 89/2012 Sb. | Civil Code / Act No. 89/2012 Coll. | **zákon č. 89/2012 Sb., občanský zákoník** (Czech citation kept); glossed once **(Bộ luật Dân sự Cộng hòa Séc, Luật số 89/2012 Sb.)** | Czech law. Never substitute the Vietnamese Bộ luật Dân sự 2015, and never write a bare *Bộ luật Dân sự*. |
| L21 | obchodní rejstřík | Commercial Register | **Sổ đăng ký thương mại** | Court stays *Městský soud v Praze*; gloss *(Tòa án Thành phố Praha)* allowed in legal only. |
| L22, L30 | Zásady ochrany osobních údajů; Zásady používání cookies | Privacy Policy; Cookie Policy | **Chính sách bảo vệ dữ liệu cá nhân**; **Chính sách cookie** | `footerPrivacyLink`, `footerCookiePolicyLink`. |
| L23 | Správce osobních údajů | Controller | **Bên Kiểm soát dữ liệu cá nhân** | The term Vietnamese data-protection law uses for the GDPR controller. |
| L25, L26, L27 | právní základ; doba uchování; předávání mimo EU | legal basis; retention period; transfers outside the EU | **cơ sở pháp lý**; **thời hạn lưu trữ**; **chuyển dữ liệu ra ngoài EU** | *EU* stays (*Liên minh châu Âu (EU)* once in legal). |
| L28, L29 | Souhlas s marketingovou komunikací; odvolání souhlasu | Marketing Communications Consent; withdrawal of consent | **Đồng ý nhận thông tin tiếp thị**; **rút lại sự đồng ý** | |

## Grammar and typography

- **Unicode NFC.** Every Vietnamese letter is a precomposed code point (*ệ* U+1EC7, not *e* + combining marks). Check: `python3 -c "import json,unicodedata,sys;t=open(sys.argv[1]).read();print(t==unicodedata.normalize('NFC',t))" <catalog>` prints `True`.
- **Tone-mark placement: traditional style**, the form most Vietnamese software uses: *hóa đơn*, *hủy*, *tùy chọn*, *xóa*, *khỏe*, *thủy*, *hòa*. ✗ *hoá*, *huỷ*, *tuỳ*, *xoá*. One style across every surface; search for *oá, oà, oả, oã, oạ, uỷ, uý, uỳ, uỹ, uỵ, oé, oè* before review.
- **Capitalisation: sentence case** for titles, buttons, tabs and headings (*Đặt phòng họp*, *Chi tiết đặt chỗ*). Capitalise proper names and legal defined terms only. ✗ Title Case Every Word.
- **No plural marking.** *giờ, ngày, chỗ* stay the same for every count. Use *các* / *những* only where the Czech plural matters to the meaning; most labels need neither (*Đặt chỗ*, not *Các đặt chỗ*).
- **Classifiers when counting:** *{count} chỗ*, *{count} lượt đặt chỗ*, *{count} lượt giới thiệu*, *{count} khách hàng*, *{count} phiên*.
- **Quotation marks**: *“…”* (U+201C … U+201D). Apostrophe *’* where an English name needs one. Definitions: *(sau đây gọi là “Bên Cung cấp”)*. Dashes: keep the Czech dash characters; spaced en dash *–* in new prose. Ellipsis *…* (U+2026) where Czech has it.
- **Time phrases**: "in X" = *sau {seconds} giây* / *còn {remaining}*: `accountSignInCodeResendCooldown` → *Bạn có thể gửi lại email sau {seconds} giây*; `checkoutSummaryDiscountEnds` → *Kết thúc sau {remaining}*. Don't hand-format the value.
- **Plurals** (CLDR vi: `other` only). A Czech plural message keeps its `declarations` and `selectors` unchanged and gets a single `countPlural=other` variant (or `*` where Czech uses `*`); exact-number keys and select keys stay as in Czech, and a select-plus-plural message needs one key per select value with `other`. Where the Czech `one` writes the number out (*Zvol 1 den.*), the `other` text uses the placeholder (*Chọn từ 1 đến {max} ngày.*). Message structure and plural categories: [../catalogs.md](../catalogs.md).
- **Button style**: bare verb phrase, no object when the context is clear: *Lưu*, *Hủy*, *Thử lại*, *Sao chép mã*. Legal exception: R05.
- **Line breaks**: Vietnamese words are separated by spaces syllable by syllable, so wrapping never breaks inside a syllable; don't add NBSP or soft hyphens.

## Watch keys

Customer catalog (`apps/deskohub-workspace/features/i18n/messages/cs-CZ.json`) unless an area is named.

| Key | Vietnamese risk | Rule |
|---|---|---|
| `checkoutPayOrderAndPayButton`, `checkoutPayOrderAndPayAmountButton` | Statutory button wording (R05) | *Đặt và thanh toán* / *Đặt và thanh toán ({amount})*. |
| `checkoutPayConsent`, `checkoutPaymentRetryConsent` | First-person consumer declaration with the withdrawal waiver; three tags | First person *Tôi*: *Tôi đồng ý với <terms>Điều kiện Giao dịch Chung</terms> và <operatingRules>Nội quy</operatingRules>.<earlyPerformance> …tôi yêu cầu rõ ràng… và xác nhận rằng… quyền rút khỏi hợp đồng của tôi chấm dứt.</earlyPerformance>* Keep the scope of the Czech waiver exactly; reviewer check. |
| `accountHelpBody` + `accountHelpContact` | `{contact}` is a linked clause | *Nếu bạn cần trợ giúp về tài khoản hoặc đặt chỗ, {contact}.* + *hãy liên hệ với chúng tôi*. |
| `accountReferralsHowCompound` | `{duration}` is an Intl-formatted span (*30 ngày*) | *…trong {duration} qua…*: works for any value. |
| `checkoutSummaryItemMeetingRoom`, `pricingMeetingRoomProduct`, `reservationValidationMeetingRoomDuration` | `{duration}` / `{durations}` hold the hours plural or *cả ngày* | Keep after a dash, comma or colon. |
| `reservationAvailabilityUnavailable` | `{tier}` is a product name | *Gói {tier} với cấu hình đã chọn không còn chỗ vào {date}…* |
| `accountReservationBookedBy`, `accountReservationBookedFor` | Label form (R20) | *Người đặt: {name}*; *Dành cho {name}*. |
| Plural messages (customer, admin and any `maxPlural`, `hoursPlural`, `dayCountPlural`) | Czech one/few/other collapse to `other` | Single `other` variant with the placeholder; never write a literal *1* where Czech `one` did. |
| `publicOfferingOfficeUsage` | Plain string with a count | *{hours} giờ*: Vietnamese needs no plural, nothing to flag. |
| `accountBillingCurrency`, `pricingIntro` | Czech prints *Kč* | *Tiền tệ: CZK*; *Giá bằng CZK cho mọi thứ bạn có thể đặt trực tuyến.* |
| `footerVatStatus`, `invoiceNonVatPayerStatement` | VAT fact (K19) | *không đăng ký nộp thuế VAT*. |
| `landingOfferingEvents`, `discounts:discountsSalesTitle`, `administration:administrationTableActions` | Three meanings of *akce* | *Sự kiện*; *Khuyến mãi*; *Thao tác*. |
| `checkoutStatusLatePaymentReviewContactMessage`, `checkoutStatusFulfillmentFailedContactMessage`, `checkoutStatusPaymentPendingContactMessage` | Customer writes to the venue | *Xin chào,* + *tôi*; keep `\n\n` and `{reservationDetails}`. |
| `faqQuestionOffices`, `faqQuestionOpeningHours`, `faqQuestionSales` | Visitor asks the venue | *Ở đây có văn phòng riêng không?* |
| `contactPhonePlaceholder`, `contactEmailPlaceholder`, `accountSignInEmailPlaceholder` | Real-looking contact data | Phone *+84 900 000 000*; email *lan@example.com*. Never reuse the Czech values. |
| `checkoutPayProviderHandoff` | Browser tab word | *…trang thanh toán bảo mật của Nexi sẽ mở trong thẻ mới…* |
| Language names (`*LocaleName*`, `*Czech`, `*English`, …) | Language vs country | *tiếng Séc*, *tiếng Anh*, *tiếng Đức*, *tiếng Ukraina*, *tiếng Slovakia*, *tiếng Việt*, *tiếng Hindi*; capitalise only at the start of a label (*Tiếng Việt*). |

## Terms fixed during the first translation (2026-11-10)

Terms without a concept ID that the catalogs use consistently. Keep them when editing nearby copy.

| Czech | English | Vietnamese | Where |
|---|---|---|---|
| přístupový odkaz | access link (to the door-PIN page) | **liên kết truy cập** | customer checkout and emails |
| preferenční cookies | preference cookies | **cookie ghi nhớ tùy chọn** | cookie dialog; plain *cookie tùy chọn* would read as "optional cookies" |
| autorizace; zachycení (capture); storno | authorization; capture; void | **cấp phép**; **thu tiền**; **hủy giao dịch (void)** | administration payment operations |
| párování (orders); párování (door access) | reconciliation | **đối soát** (orders); **đối chiếu** (door access) | administration; Czech uses two words |
| odebrat (from an audience or list) vs smazat | remove vs delete | **gỡ** vs **xóa** | administration |
| scénář / průběh automatizace | automation flow | **kịch bản** | email automations |
| nadpis (editor block) | heading | **đầu đề** | email editor; never *tiêu đề* (subject) |
| spouštěč | trigger (event or schedule) | **sự kiện kích hoạt** | email automations |
| nabídka (an offer block in an email, a deal) | offer | **ưu đãi** | email editor block, marketing consent; P19 keeps *lựa chọn* / *dịch vụ* for "what we offer" |
| formát data | date-input format | **DD/MM/YYYY** kept as written | `reservationDateInputFormat`: Vietnamese letters would be ambiguous (*N* = ngày and năm) |
