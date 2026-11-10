import { workspaceSiteConstants } from "@/shared/utils";
import type {
  LegalDocumentBodies,
  LegalDocumentTranslation,
  LegalSection,
} from "../../legal-document-body";
import { companyAddress, companyName, contactEmail } from "../operator-details";

const commercialRegisterDisclosure =
  "Thông tin về việc đăng ký tại Sổ đăng ký thương mại có trong bản trích lục chính thức của công ty theo liên kết kèm theo.";

const termsAndConditionsSections: LegalSection[] = [
  {
    heading: "1. Điều khoản mở đầu",
    body: [
      <>
        1.1 Các điều kiện giao dịch chung này (sau đây gọi là “Điều kiện Giao
        dịch Chung”) điều chỉnh quyền và nghĩa vụ qua lại của các bên trong hợp
        đồng phát sinh liên quan đến việc cung cấp dịch vụ của công ty{" "}
        {companyName}, Mã số doanh nghiệp (IČO):{" "}
        {workspaceSiteConstants.company.identificationNumber}, có trụ sở tại
        Turnovská 430/10, Praha 8, được đăng ký tại Sổ đăng ký thương mại do
        Městský soud v Praze (Tòa án Thành phố Praha) quản lý (sau đây gọi là
        “Bên Cung cấp”), và khách hàng (sau đây gọi là “Khách hàng”).
      </>,
      "1.2 Điều kiện Giao dịch Chung này áp dụng cho các lượt vào coworking, việc đặt chỗ trực tuyến phòng họp và văn phòng riêng, cũng như việc sử dụng ngắn hạn mặt bằng cho các sự kiện được thỏa thuận riêng.",
      "1.3 Các quy định của Điều kiện Giao dịch Chung này là một phần không thể tách rời của mọi hợp đồng được giao kết giữa Bên Cung cấp và Khách hàng.",
      "1.4 Các quan hệ pháp lý không được Điều kiện Giao dịch Chung này điều chỉnh tuân theo pháp luật của Cộng hòa Séc, đặc biệt là zákon č. 89/2012 Sb., občanský zákoník (Bộ luật Dân sự Cộng hòa Séc, Luật số 89/2012 Sb.).",
      "1.5 Nếu Khách hàng là người tiêu dùng, Điều kiện Giao dịch Chung này không hạn chế các quyền mà theo các quy định pháp luật bắt buộc Khách hàng không thể từ bỏ.",
    ],
  },
  {
    heading: "2. Định nghĩa thuật ngữ",
    body: [
      "2.1 Khách hàng là cá nhân hoặc pháp nhân sử dụng dịch vụ của Bên Cung cấp.",
      "2.2 Người tiêu dùng là Khách hàng hành động ngoài phạm vi hoạt động kinh doanh của mình.",
      "2.3 Mặt bằng là không gian coworking, phòng họp, văn phòng riêng và không gian tổ chức sự kiện do Bên Cung cấp vận hành.",
      "2.4 Dịch vụ là việc cho phép sử dụng Mặt bằng đã chọn trong một khoảng thời gian giới hạn và các dịch vụ liên quan được nêu trong đơn hàng.",
      "2.5 Gói là phạm vi cụ thể của dịch vụ coworking và các điều kiện sử dụng dịch vụ đó theo Bảng giá hiện hành của Bên Cung cấp.",
      "2.6 Mã PIN Ra vào là mã hiện hành cho phép đi vào mặt bằng của Bên Cung cấp.",
      "2.7 Đặt chỗ là đơn hàng cho một lượt vào coworking cụ thể, một khung giờ sử dụng phòng họp, hoặc một khoảng thời gian, số ngày và số chỗ trong văn phòng riêng.",
    ],
  },
  {
    heading: "3. Đối tượng của hợp đồng",
    body: [
      "3.1 Bên Cung cấp cung cấp cho Khách hàng dịch vụ coworking, bao gồm việc tạm thời cho phép sử dụng không gian làm việc chung tại mặt bằng của Bên Cung cấp, trong phạm vi gói đã chọn. Không gian làm việc chung là một chỗ làm việc được chỉ định không độc quyền hoặc một phần không gian coworking dành cho công việc thông thường, không bảo đảm một bàn hoặc chỗ ngồi cụ thể, trừ khi gói cụ thể nêu rõ khác.",
      "3.2 Đặt chỗ phòng họp cho phép Khách hàng sử dụng độc quyền phòng đã chọn vào thời gian đã xác nhận, với thời lượng một giờ, bốn giờ hoặc một ngày dương lịch theo giờ Praha. Đặt chỗ cả ngày kéo dài từ nửa đêm của ngày đã chọn đến nửa đêm của ngày hôm sau theo múi giờ Europe/Prague.",
      "3.3 Đặt chỗ văn phòng riêng cho phép Khách hàng sử dụng độc quyền văn phòng với số chỗ đã xác nhận trong trọn các ngày dương lịch đã chọn. Mỗi ngày kéo dài từ nửa đêm đến nửa đêm tiếp theo theo múi giờ Europe/Prague, và ngày cuối cùng nêu trong xác nhận được tính vào Đặt chỗ.",
      "3.4 Sức chứa, trang thiết bị, giá, thời gian và phạm vi cụ thể của Đặt chỗ được nêu trên trang đặt chỗ và trong phần tóm tắt đơn hàng. Khách hàng không được vượt quá sức chứa đã xác nhận và chịu trách nhiệm về khách của mình cũng như những người khác mà Khách hàng cho phép vào.",
      "3.5 Ngoài ra, Bên Cung cấp cho phép Khách hàng sử dụng ngắn hạn mặt bằng để tổ chức sự kiện, luôn trên cơ sở thỏa thuận riêng.",
      "3.6 Dịch vụ là quyền sử dụng ngắn hạn Mặt bằng được chỉ định và các dịch vụ liên quan; Dịch vụ không tạo ra quyền thuê, trụ sở, cơ sở kinh doanh hay bất kỳ quyền đối vật nào khác đối với Mặt bằng. Nếu không có thỏa thuận riêng bằng văn bản, Khách hàng không được sử dụng địa chỉ của Mặt bằng làm trụ sở, địa điểm kinh doanh, cơ sở kinh doanh hoặc địa chỉ nhận thư.",
    ],
  },
  {
    heading: "4. Giao kết hợp đồng",
    body: [
      "4.1 Thông tin về Dịch vụ trên trang web là lời mời đặt hàng. Trước khi gửi đơn hàng, Khách hàng kiểm tra Dịch vụ đã chọn, thời gian, phạm vi, giá cuối cùng và thông tin liên hệ hoặc thông tin xuất hóa đơn, đồng thời chủ động chấp nhận Điều kiện Giao dịch Chung này và Nội quy.",
      "4.2 Bằng việc nhấn nút “Đặt và thanh toán”, Khách hàng gửi một đơn hàng có tính ràng buộc kèm nghĩa vụ thanh toán giá cuối cùng đã nêu. Hợp đồng được giao kết khi Khách hàng nhận được xác nhận của Bên Cung cấp sau khi thanh toán thành công, hoặc, đối với đơn hàng có giá cuối cùng bằng không, khi nhận được xác nhận hoàn tất đơn hàng. Xác nhận bao gồm các thông tin Đặt chỗ đã thỏa thuận và một liên kết an toàn đến trạng thái và thông tin ra vào của Đặt chỗ.",
      "4.3 Trước khi hợp đồng được giao kết, đây chỉ là việc giữ chỗ tạm thời. Bên Cung cấp có thể từ chối đơn hàng, đặc biệt khi không còn chỗ, có lỗi rõ ràng về giá, có nghi ngờ gian lận hoặc các điều kiện của Đặt chỗ không được đáp ứng; trong trường hợp đó, Bên Cung cấp hoàn trả khoản thanh toán đã nhận mà không chậm trễ không cần thiết.",
      "4.4 Các yêu cầu về cà phê, chỗ làm việc cụ thể, màn hình, trang thiết bị hoặc các tiện ích bổ sung khác tùy thuộc vào tình trạng sẵn có và chỉ có tính ràng buộc khi được nêu trong xác nhận.",
      "4.5 Hợp đồng về mặt bằng cho sự kiện được thỏa thuận riêng được giao kết khi Khách hàng chấp nhận báo giá cụ thể của Bên Cung cấp.",
    ],
  },
  {
    heading: "5. Giá và điều kiện thanh toán",
    body: [
      "5.1 Bên Cung cấp không đăng ký nộp thuế VAT. Mọi mức giá đều là giá cuối cùng.",
      "5.2 Giá có tính quyết định là giá cuối cùng hiển thị trong phần tóm tắt đơn hàng ngay trước khi gửi đơn hàng. Giá phải được thanh toán trước khi Dịch vụ được cung cấp, qua phương thức thanh toán được đưa ra.",
      "5.3 Giá văn phòng riêng được tính cho mỗi ngày đã chọn, bằng giá văn phòng theo ngày cộng giá theo ngày cho mỗi chỗ đã xác nhận. Giá phòng họp tương ứng với sản phẩm một giờ, bốn giờ hoặc cả ngày đã chọn.",
      "5.4 Giảm giá chỉ được áp dụng khi được nêu trong phần tóm tắt đơn hàng. Nếu giá hoặc mức giảm giá áp dụng được thay đổi trước khi bắt đầu thanh toán, Bên Cung cấp sẽ hiển thị phần tóm tắt mới và yêu cầu Khách hàng xác nhận lại.",
      "5.5 Giá mặt bằng cho sự kiện được thỏa thuận riêng được xác định trong báo giá tùy theo tính chất của sự kiện.",
    ],
  },
  {
    heading: "6. Tình trạng còn chỗ và thay đổi Đặt chỗ",
    body: [
      "6.1 Tình trạng còn chỗ chỉ được xác nhận cho thời gian, phạm vi, sức chứa và sản phẩm nêu trong xác nhận. Việc thay đổi ngày, giờ, thời lượng, số ngày, số chỗ hoặc sản phẩm cần một Đặt chỗ mới hoặc xác nhận rõ ràng của Bên Cung cấp.",
      "6.2 Không được chuyển nhượng hoặc bán lại Đặt chỗ nếu không có sự đồng ý trước của Bên Cung cấp.",
      "6.3 Bên Cung cấp có thể thay đổi danh mục, giá và nội dung Dịch vụ cho các đơn hàng trong tương lai. Thay đổi đó không ảnh hưởng đến hợp đồng đã được giao kết.",
      "6.4 Nếu Bên Cung cấp không thể cung cấp Dịch vụ đã xác nhận, tùy theo hoàn cảnh, Bên Cung cấp sẽ đề xuất cho Khách hàng một thời gian hoặc mặt bằng thay thế tương đương, một mức giảm giá hợp lý, hoặc hoàn trả giá cho phần Dịch vụ không được cung cấp. Điều này không ảnh hưởng đến các quyền khác theo luật định của Khách hàng.",
    ],
  },
  {
    heading: "7. Ra vào và sử dụng dịch vụ",
    body: [
      "7.1 Email xác nhận chứa một liên kết an toàn đến trang ra vào của Đặt chỗ. Khi Đặt chỗ đã được thanh toán, xác nhận và xác minh trực tiếp, đồng thời đã được cấp mã PIN ra vào, trang được bảo vệ sẽ hiển thị mã PIN này cùng với khoảng thời gian hiệu lực đã được lập trình chính xác của mã. Việc hệ thống khóa chấp nhận mã chỉ do khoảng thời gian đã được lập trình trong AlgoPIN quyết định; các ứng dụng không dùng đồng hồ riêng của mình cho việc này. Mã PIN không được ghi trực tiếp trong email xác nhận.",
      "7.2 Bên Cung cấp có thể thay đổi mã PIN ra vào; Khách hàng sử dụng mã đang hiển thị trên trang ra vào của Đặt chỗ. Việc hiển thị mã PIN không kéo dài thời gian sử dụng Mặt bằng đã xác nhận và không tạo ra quyền ra vào ngoài thời gian đó hoặc vào mặt bằng khác. Chỉ được sử dụng Mặt bằng trong thời gian Đặt chỗ đã xác nhận.",
      "7.3 Khách hàng chỉ được cho những người có quyền tham gia Đặt chỗ của mình biết mã PIN, phải bảo vệ mã khỏi những người khác và chịu trách nhiệm về việc khách của mình sử dụng mã. Khách hàng thông báo ngay cho Bên Cung cấp khi nghi ngờ mã bị lạm dụng.",
      "7.4 Khách hàng và khách của Khách hàng có nghĩa vụ tuân thủ sức chứa, mục đích của Đặt chỗ, thời gian đã xác nhận và Nội quy. Khách hàng bảo đảm rằng khách của mình rời khỏi Mặt bằng chậm nhất khi Đặt chỗ kết thúc.",
    ],
  },
  {
    heading: "8. Hủy Đặt chỗ",
    body: [
      <>
        8.1 Khách hàng có thể yêu cầu hủy Đặt chỗ bằng email gửi đến{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Bên Cung cấp xử lý yêu cầu theo các điều kiện nêu trong phần tóm tắt
        đơn hàng hoặc báo giá riêng và theo các quy định pháp luật bắt buộc.
      </>,
      "8.2 Trừ khi phần tóm tắt đơn hàng hoặc báo giá riêng quy định khác, bản thân việc hủy không tạo ra quyền yêu cầu riêng theo hợp đồng để được hoàn trả giá. Điều này không ảnh hưởng đến các quyền phát sinh từ việc thực hiện có khiếm khuyết, quyền rút khỏi hợp đồng theo luật định của Người tiêu dùng, cũng như trường hợp Bên Cung cấp không cung cấp Dịch vụ.",
      "8.3 Sự kiện được thỏa thuận riêng được hủy theo các điều kiện của báo giá cụ thể.",
      "8.4 Khách hàng không có quyền được hoàn trả giá chỉ vì đã không sử dụng Mặt bằng, đến muộn hoặc rời đi sớm, trừ khi đáp ứng các điều kiện hoàn trả theo điều này hoặc theo quy định pháp luật bắt buộc.",
    ],
  },
  {
    heading: "9. Quyền rút khỏi hợp đồng của Người tiêu dùng",
    body: [
      "9.1 Người tiêu dùng có thể rút khỏi hợp đồng được giao kết trực tuyến mà không cần nêu lý do trong vòng 14 ngày kể từ ngày giao kết, trừ khi trong trường hợp cụ thể quyền rút khỏi hợp đồng bị luật loại trừ hoặc đã chấm dứt.",
      "9.2 Nếu Dịch vụ bắt đầu trước khi thời hạn này kết thúc, khi xác nhận đơn hàng, Người tiêu dùng yêu cầu rõ ràng Bên Cung cấp bắt đầu thực hiện trước khi hết thời hạn và xác nhận đã biết rằng quyền rút khỏi hợp đồng chấm dứt sau khi Dịch vụ được cung cấp đầy đủ. Nếu Người tiêu dùng rút khỏi hợp đồng sau khi Dịch vụ đã bắt đầu nhưng trước khi Dịch vụ được cung cấp đầy đủ, Người tiêu dùng thanh toán phần giá tương ứng với phần đã được thực hiện, nếu đáp ứng các điều kiện luật định.",
      <>
        9.3 Có thể gửi thông báo rút khỏi hợp đồng bằng một tuyên bố rõ ràng đến
        địa chỉ trụ sở của Bên Cung cấp hoặc qua email đến{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Thời hạn được coi là đã tuân thủ nếu thông báo được gửi đi trước khi
        thời hạn kết thúc.
      </>,
      "9.4 Sau khi rút khỏi hợp đồng hợp lệ, Bên Cung cấp hoàn trả số tiền đã nhận mà không chậm trễ không cần thiết, chậm nhất trong vòng 14 ngày, bằng cùng phương thức đã nhận, trừ khi các bên có thỏa thuận khác mà Người tiêu dùng không phải chịu thêm chi phí.",
      "9.5 Mẫu thông báo: “Tôi xin thông báo rằng tôi rút khỏi hợp đồng đối với Dịch vụ sau: [mô tả và số Đặt chỗ], được đặt ngày [ngày]. Họ và tên của Người tiêu dùng: [điền vào]. Địa chỉ của Người tiêu dùng: [điền vào]. Ngày: [điền vào]. Chữ ký chỉ khi gửi bằng văn bản giấy.” Việc sử dụng mẫu này không bắt buộc.",
      "9.6 Các quyền theo điều này chỉ thuộc về Người tiêu dùng và áp dụng song song với các điều kiện hủy có lợi hơn (nếu có) được nêu trong phần tóm tắt đơn hàng hoặc báo giá riêng.",
    ],
  },
  {
    heading: "10. Quy tắc sử dụng và trách nhiệm của Khách hàng",
    body: [
      "10.1 Khách hàng có nghĩa vụ sử dụng Mặt bằng đúng cách, chỉ cho mục đích đã xác nhận và phù hợp với Điều kiện Giao dịch Chung này, Nội quy, các hướng dẫn an toàn và quy định pháp luật.",
      "10.2 Khách hàng chịu trách nhiệm về hành vi của khách của mình và về thiệt hại do Khách hàng hoặc khách của Khách hàng gây ra do vi phạm nghĩa vụ. Hao mòn thông thường không được coi là thiệt hại. Khách hàng thông báo về thiệt hại hoặc hư hỏng mà không chậm trễ không cần thiết.",
      "10.3 Bên Cung cấp có thể hạn chế hoặc chấm dứt việc cung cấp Dịch vụ ở mức độ tương xứng khi có vi phạm nghiêm trọng hoặc lặp lại Điều kiện Giao dịch Chung hoặc Nội quy, vượt quá sức chứa, hành vi nguy hiểm hoặc trái pháp luật, hoặc lạm dụng quyền ra vào. Điều này không ảnh hưởng đến các quyền của Khách hàng nếu biện pháp đó không có căn cứ.",
    ],
  },
  {
    heading: "11. Trách nhiệm của Bên Cung cấp",
    body: [
      "11.1 Bên Cung cấp chịu trách nhiệm về việc cung cấp đúng Dịch vụ đã xác nhận và về thiệt hại trong phạm vi do pháp luật quy định. Không có nội dung nào trong Điều kiện Giao dịch Chung này loại trừ hoặc hạn chế trách nhiệm không thể loại trừ một cách hợp lệ, cũng như các quyền theo luật định của Người tiêu dùng.",
      "11.2 Khách hàng chịu trách nhiệm về hoạt động kinh doanh, dữ liệu của mình và tài sản mang vào Mặt bằng. Bên Cung cấp chỉ chịu trách nhiệm về việc mất hoặc hư hỏng tài sản trong phạm vi do pháp luật quy định; vì vậy, Khách hàng không để tài sản mà không có người trông coi và bảo vệ tài sản một cách hợp lý.",
      "11.3 Bên Cung cấp không chịu trách nhiệm về trở ngại phát sinh ngoài ý chí của mình mà Bên Cung cấp không thể lường trước hoặc ngăn chặn một cách hợp lý. Nếu trở ngại đó hoặc tình trạng tạm thời không thể sử dụng kéo dài đến mức không thể cung cấp một phần đáng kể của Dịch vụ đã xác nhận, áp dụng điều 6.4.",
      "11.4 Đối với Khách hàng không phải là Người tiêu dùng, trong phạm vi tối đa pháp luật cho phép, Bên Cung cấp không chịu trách nhiệm về thiệt hại gián tiếp, lợi nhuận bị mất hoặc mất dữ liệu, trừ khi Bên Cung cấp gây ra các thiệt hại đó do cố ý hoặc do sơ suất nghiêm trọng.",
    ],
  },
  {
    heading: "12. Khiếm khuyết và khiếu nại",
    body: [
      "12.1 Khách hàng thông báo về khiếm khuyết của Dịch vụ mà không chậm trễ không cần thiết để có thể khắc phục, và nêu ít nhất thông tin liên hệ của mình, số Đặt chỗ, mô tả khiếm khuyết và cách giải quyết mong muốn.",
      <>
        12.2 Có thể khiếu nại tại cơ sở, tại địa chỉ của Bên Cung cấp hoặc qua
        email đến{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
        . Bên Cung cấp cấp cho Người tiêu dùng xác nhận về việc tiếp nhận và
        giải quyết khiếu nại.
      </>,
      "12.3 Bên Cung cấp quyết định về khiếu nại của Người tiêu dùng ngay lập tức, trong trường hợp phức tạp thì trong vòng ba ngày làm việc; Bên Cung cấp giải quyết khiếu nại, bao gồm cả việc khắc phục khiếm khuyết, mà không chậm trễ không cần thiết, chậm nhất trong vòng 30 ngày, trừ khi đã thỏa thuận với Người tiêu dùng một thời hạn dài hơn.",
      "12.4 Tùy theo tính chất của khiếm khuyết, Khách hàng có thể yêu cầu khắc phục, thực hiện thay thế, giảm giá hợp lý hoặc rút khỏi hợp đồng, nếu đáp ứng các điều kiện luật định.",
    ],
  },
  {
    heading: "13. Giải quyết tranh chấp tiêu dùng ngoài tòa án",
    body: [
      "13.1 Nếu giữa Bên Cung cấp và Người tiêu dùng phát sinh tranh chấp từ hợp đồng cung cấp Dịch vụ mà không thể giải quyết trực tiếp, Người tiêu dùng có thể gửi đề nghị giải quyết tranh chấp ngoài tòa án đến Cơ quan Thanh tra Thương mại Séc (Česká obchodní inspekce, ČOI), Ústřední inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2.",
      <>
        13.2 Thông tin và biểu mẫu điện tử có tại{" "}
        <a
          className="text-burned-orange underline underline-offset-4"
          href="https://coi.gov.cz/informace-o-adr/"
          rel="noreferrer"
          target="_blank"
        >
          coi.gov.cz/informace-o-adr/
        </a>
        . Người tiêu dùng phải gửi đề nghị chậm nhất trong vòng một năm kể từ
        ngày lần đầu tiên thực hiện quyền của mình với Bên Cung cấp.
      </>,
    ],
  },
  {
    heading: "14. Quy định riêng cho sự kiện",
    body: [
      "14.1 Khách hàng chịu trách nhiệm về diễn biến của sự kiện được thỏa thuận riêng và về những người tham gia sự kiện.",
      "14.2 Bên Cung cấp có quyền chấm dứt sự kiện trong trường hợp vi phạm quy định pháp luật, báo giá cụ thể, Điều kiện Giao dịch Chung này hoặc Nội quy.",
    ],
  },
  {
    heading: "15. Điều khoản cuối cùng",
    body: [
      "15.1 Bên Cung cấp có thể sửa đổi Điều kiện Giao dịch Chung này đối với các hợp đồng được giao kết sau khi phiên bản mới có hiệu lực. Đối với Đặt chỗ đã được giao kết, áp dụng phiên bản mà Khách hàng đã chấp nhận khi đặt hàng, trừ khi thay đổi sau đó có lợi hơn cho Khách hàng hoặc Khách hàng chấp nhận rõ ràng thay đổi đó.",
      "15.2 Thỏa thuận riêng khác biệt được ưu tiên áp dụng so với Điều kiện Giao dịch Chung này. Việc một điều khoản vô hiệu hoặc không có hiệu lực không ảnh hưởng đến các điều khoản khác.",
      "15.3 Điều kiện Giao dịch Chung này có hiệu lực từ ngày 12 tháng 8 năm 2026.",
    ],
  },
];

const operatingRulesSections: LegalSection[] = [
  {
    heading: "1. Điều khoản mở đầu",
    body: [
      <>
        1.1 Nội quy này (sau đây gọi là “Nội quy”) quy định các quy tắc ứng xử
        và sử dụng không gian coworking, phòng họp, văn phòng riêng và không
        gian sự kiện do công ty {companyName}, Mã số doanh nghiệp (IČO):{" "}
        {workspaceSiteConstants.company.identificationNumber}, có trụ sở tại
        Turnovská 430/10, Praha 8 (sau đây gọi là “Bên Vận hành”) vận hành.
      </>,
      "1.2 Nội quy này có hiệu lực ràng buộc đối với tất cả những người có mặt tại mặt bằng của Bên Vận hành (sau đây gọi là “Người dùng”).",
      "1.3 Khách hàng đã tạo đặt chỗ bảo đảm rằng khách của mình và những người khác mà Khách hàng cho phép vào cũng nắm được và tuân thủ Nội quy.",
    ],
  },
  {
    heading: "2. Quy tắc ứng xử cơ bản",
    body: [
      "2.1 Người dùng có nghĩa vụ cư xử chu đáo và tôn trọng những người khác tại mặt bằng.",
      "2.2 Tại các không gian làm việc chung và khu vực chung, Người dùng giữ yên tĩnh ở mức tương ứng với một cuộc trò chuyện nhỏ thông thường. Trong phòng họp hoặc văn phòng riêng, Người dùng giữ tiếng ồn trong phạm vi không gian đã đặt.",
      "2.3 Người dùng không được có hành vi làm phiền quá mức những người dùng khác hoặc hạn chế việc họ sử dụng mặt bằng. Khách hàng chịu trách nhiệm về hành vi của khách của mình.",
    ],
  },
  {
    heading: "3. Các hành vi bị cấm tại mặt bằng",
    body: [
      "3.1 Tại mặt bằng, nghiêm cấm:",
      "a) hút thuốc, kể cả sử dụng thuốc lá điện tử,",
      "b) sử dụng chất ma túy hoặc chất hướng thần,",
      "c) vào mặt bằng trong tình trạng chịu ảnh hưởng của rượu bia hoặc các chất gây nghiện khác ở mức làm hạn chế khả năng hành xử an toàn,",
      "d) thực hiện các hoạt động trái với quy định pháp luật,",
      "e) làm hư hỏng đồ đạc hoặc thiết bị của mặt bằng,",
      "f) quấy rầy những người dùng khác bằng hành vi không phù hợp hoặc hung hăng,",
      "g) vượt quá sức chứa đã xác nhận, nhượng lại hoặc bán lại đặt chỗ cho người không có quyền,",
      "h) sử dụng địa chỉ của mặt bằng làm trụ sở, địa điểm kinh doanh, cơ sở kinh doanh hoặc địa chỉ nhận thư khi không có thỏa thuận bằng văn bản.",
    ],
  },
  {
    heading: "4. Sử dụng mặt bằng",
    body: [
      "4.1 Người dùng có nghĩa vụ chỉ sử dụng mặt bằng cho các mục đích phù hợp với tính chất và công năng của mặt bằng.",
      "4.2 Phòng họp và văn phòng riêng chỉ được sử dụng trong thời gian đã xác nhận và với sức chứa đã xác nhận. Người dùng rời khỏi các phòng này cùng với đồ đạc của mình chậm nhất khi đặt chỗ kết thúc.",
      "4.3 Người dùng có nghĩa vụ giữ gìn trật tự, vệ sinh và sau khi sử dụng xong phải đưa chỗ đã sử dụng và trang thiết bị chung về trạng thái phù hợp.",
      "4.4 Nếu không có sự đồng ý của Bên Vận hành, Người dùng không được di chuyển trang thiết bị, thực hiện sửa đổi, lắp đặt thiết bị hoặc can thiệp vào hệ thống kỹ thuật.",
      "4.5 Người dùng sử dụng thiết bị nghe nhìn, thiết bị hội nghị và các thiết bị khác theo hướng dẫn và thông báo về sự cố mà không chậm trễ không cần thiết. Sau khi đặt chỗ kết thúc, Người dùng tắt thiết bị một cách an toàn nếu tính chất của thiết bị đòi hỏi.",
    ],
  },
  {
    heading: "5. Đồ ăn uống",
    body: [
      "5.1 Người dùng có nghĩa vụ sử dụng đồ ăn uống ở mức hợp lý và có quan tâm đến những người dùng khác.",
      "5.2 Người dùng không được lạm dụng hoặc lãng phí đồ ăn uống một cách không có lý do.",
    ],
  },
  {
    heading: "6. An toàn",
    body: [
      "6.1 Người dùng có nghĩa vụ chú ý đến sự an toàn của bản thân và của những người khác.",
      "6.2 Người dùng không được chặn lối thoát hiểm hoặc gây nguy hiểm cho hoạt động an toàn của mặt bằng bằng bất kỳ cách nào khác.",
      "6.3 Người dùng có nghĩa vụ thông báo cho Bên Vận hành mà không chậm trễ không cần thiết khi phát sinh tình huống nguy hiểm hoặc sự cố.",
      "6.4 Khách hàng chỉ được cho những người có quyền tham gia đặt chỗ của mình biết Mã PIN Ra vào. Người dùng bảo vệ mã để không bị tiết lộ cho người không có quyền hoặc bị người đó nhìn trộm, và đặc biệt cẩn thận khi nhập mã.",
      "6.5 Việc hiển thị mã PIN trên trang ra vào của Đặt chỗ không hạn chế hay kéo dài thời gian được phép sử dụng mặt bằng dưới bất kỳ hình thức nào; việc chấp nhận mã hoàn toàn do hệ thống khóa quyết định. Người dùng chỉ được vào và ở lại mặt bằng trong thời gian Đặt chỗ đã xác nhận.",
      "6.6 Không được để cửa hoặc các lối vào được bảo vệ khác ở trạng thái mở. Người dùng thông báo ngay cho Bên Vận hành khi nghi ngờ mã bị lạm dụng hoặc có người không có quyền đi vào.",
      "6.7 Khách hàng bảo đảm khách của mình đến và rời đi an toàn, và không được cho phép họ ra vào ngoài thời gian đã xác nhận hoặc vào khu vực khác ngoài mặt bằng được sử dụng hợp pháp.",
      "6.8 Bên Vận hành hoặc người được Bên Vận hành ủy quyền có thể vào không gian đã đặt nếu cần thiết do sự cố bất thường, vì lý do an toàn, để ngăn ngừa thiệt hại hoặc để bảo trì cần thiết; nếu hoàn cảnh cho phép, Bên Vận hành thông báo trước cho Khách hàng.",
    ],
  },
  {
    heading: "7. Trách nhiệm bồi thường thiệt hại",
    body: [
      "7.1 Người dùng chịu trách nhiệm về thiệt hại mà mình gây ra đối với tài sản của Bên Vận hành hoặc của bên thứ ba.",
      "7.2 Khách hàng cũng chịu trách nhiệm về thiệt hại do khách của mình gây ra. Hao mòn thông thường không được coi là thiệt hại.",
      "7.3 Người dùng có nghĩa vụ thông báo ngay cho Bên Vận hành về thiệt hại phát sinh, việc mất chìa khóa hoặc phương tiện ra vào, và các sự cố.",
    ],
  },
  {
    heading: "8. Vi phạm Nội quy",
    body: [
      "8.1 Trong trường hợp vi phạm Nội quy này, Bên Vận hành có quyền áp dụng các biện pháp tương xứng để bảo đảm trật tự và bảo vệ những người dùng khác.",
      "8.2 Các biện pháp này có thể bao gồm, đặc biệt là, yêu cầu khắc phục, hạn chế quyền ra vào, yêu cầu Người dùng rời khỏi mặt bằng hoặc chấm dứt đặt chỗ, nếu điều đó tương xứng với tính chất và mức độ nghiêm trọng của vi phạm.",
      "8.3 Nếu có thể và vi phạm không nghiêm trọng hay nguy hiểm, trước khi chấm dứt đặt chỗ, Bên Vận hành tạo cơ hội hợp lý để khắc phục.",
    ],
  },
  {
    heading: "9. Điều khoản cuối cùng",
    body: [
      "9.1 Bên Vận hành có thể sửa đổi Nội quy này đối với các đặt chỗ trong tương lai. Đối với đặt chỗ đã được xác nhận, áp dụng phiên bản đã được chấp nhận khi đặt hàng, trừ khi cần có biện pháp tức thời vì lý do an toàn hoặc theo quy định pháp luật bắt buộc.",
      "9.2 Nội quy này có hiệu lực từ ngày 12 tháng 8 năm 2026.",
    ],
  },
];

const legalDocuments = {
  "privacy-policy": {
    updatedAt: "8 tháng 11, 2026",
    sections: [
      {
        heading: "1. Bên Kiểm soát dữ liệu cá nhân",
        body: [
          <>
            {companyName}, Mã số doanh nghiệp (IČO){" "}
            {workspaceSiteConstants.company.identificationNumber}, địa chỉ cơ sở{" "}
            {companyAddress}, mã số cơ sở{" "}
            {workspaceSiteConstants.company.establishmentId}, là Bên Kiểm soát
            dữ liệu cá nhân của Quý khách.
          </>,
          commercialRegisterDisclosure,
          <>
            Nếu có câu hỏi về việc bảo vệ dữ liệu cá nhân, Quý khách vui lòng
            gửi email cho chúng tôi tại{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
        ],
      },
      {
        heading: "2. Chúng tôi xử lý những dữ liệu nào",
        body: [
          <>
            Chúng tôi xử lý dữ liệu mà Quý khách cung cấp cho chúng tôi qua
            trang web công khai, đặc biệt là thông tin liên hệ và nội dung tin
            nhắn gửi qua biểu mẫu liên hệ, cùng thông tin đặt chỗ: tên, email,
            số điện thoại, nhóm sản phẩm và sản phẩm đặt chỗ đã chọn, ngày hoặc
            khoảng ngày, giờ bắt đầu, thời lượng, số chỗ và các lựa chọn
            coworking (nếu có) về đồ ăn uống, màn hình hoặc trạm làm việc.
          </>,
          <>
            Khi Quý khách tiếp tục đặt hàng, chúng tôi cũng xử lý số tiền được
            báo giá và số tiền đã thanh toán, tiền tệ, các mức giảm giá đã áp
            dụng, mã định danh và trạng thái của khoản thanh toán và đặt chỗ,
            những điều kiện mà Quý khách đã chấp nhận và thời điểm chấp nhận,
            việc quyền ra vào đã được cấp hay chưa, và thông tin xuất hóa đơn
            không bắt buộc mà Quý khách yêu cầu ghi trên chứng từ kế toán. Chúng
            tôi không nhận đầy đủ thông tin thẻ thanh toán của Quý khách từ nhà
            cung cấp dịch vụ thanh toán.
          </>,
          <>
            Nếu Quý khách tạo tài khoản khách hàng, chúng tôi xử lý địa chỉ
            email đã được xác minh, thông tin hồ sơ và thông tin đăng nhập cần
            thiết để bảo mật tài khoản của Quý khách. Chúng tôi không bao giờ
            yêu cầu Quý khách cung cấp mật khẩu.
          </>,
          <>
            Nếu Quý khách kết nối một trợ lý AI, chẳng hạn ChatGPT hoặc Claude,
            với tài khoản khách hàng của mình, chúng tôi xử lý thông tin về việc
            đó là trợ lý nào, Quý khách đã cấp cho trợ lý những quyền nào và vào
            thời điểm nào, cũng như thông tin truy cập mà trợ lý sử dụng. Khi
            trợ lý thay mặt Quý khách bắt đầu một đặt chỗ, chúng tôi ghi lại trợ
            lý nào đã bắt đầu đặt chỗ đó.
          </>,
          <>
            Để vận hành trang web và bảo vệ trang web khỏi thư rác và hành vi
            lạm dụng, chúng tôi cũng có thể xử lý trong thời gian ngắn các dữ
            liệu kỹ thuật, chẳng hạn địa chỉ IP và thông tin về trình duyệt của
            Quý khách.
          </>,
          <>
            Để hiểu cách các công cụ tìm kiếm và trợ lý AI sử dụng trang web,
            chúng tôi phân loại các yêu cầu truy cập theo thông tin trình duyệt
            vào các nhóm lưu lượng chung. Chúng tôi chỉ cung cấp cho nhà cung
            cấp dịch vụ phân tích nhóm này, tên của trợ lý hoặc công cụ tìm kiếm
            được nhận diện, trang và ngôn ngữ, biểu mẫu mà yêu cầu tự động bị
            chặn đã cố sử dụng, và đối với các công cụ đặt chỗ dành cho trợ lý
            AI của chúng tôi, công cụ nào đã được sử dụng và có thành công hay
            không. Chúng tôi không chuyển bất kỳ thông tin nào có thể nhận diện
            Quý khách, và việc đo lường này không phụ thuộc vào sự đồng ý phân
            tích. Chúng tôi cũng gắn nhóm này và tên của trợ lý được nhận diện
            vào các bản ghi về đặt chỗ và thanh toán được mô tả tại mục 3.
          </>,
          <>
            Nếu Quý khách đồng ý với cookie phân tích hoặc các công nghệ tương
            tự, chúng tôi và các nhà cung cấp dịch vụ phân tích có thể xử lý dữ
            liệu về việc sử dụng trang web và đo lường chiến dịch, chẳng hạn
            lượt xem trang, thông tin về trình duyệt và thiết bị, dữ liệu kỹ
            thuật suy ra từ địa chỉ IP, loại sự kiện và các tham số chiến dịch
            tiêu chuẩn từ liên kết. Khi có sự đồng ý phân tích của Quý khách,
            chúng tôi cũng gắn các bản ghi về đặt chỗ và thanh toán của Quý
            khách được mô tả tại mục 3 vào hồ sơ phân tích của tài khoản Quý
            khách.
          </>,
          <>
            Nếu Quý khách đăng ký riêng để nhận thông tin tiếp thị trong tương
            lai, chúng tôi cũng xử lý tên, địa chỉ email, ngôn ngữ ưu tiên, thời
            điểm đồng ý và phiên bản thông báo tiếp thị mà Quý khách đã chấp
            nhận. Chúng tôi cũng ghi lại nơi Quý khách đã đồng ý, chẳng hạn
            trong biểu mẫu đặt chỗ, trong tài khoản của mình hoặc thông qua trợ
            lý, và lưu lựa chọn của Quý khách cùng với bản ghi khách hàng của
            Quý khách.
          </>,
        ],
      },
      {
        heading: "3. Chúng tôi sử dụng dữ liệu cho mục đích gì",
        body: [
          <>
            Chúng tôi sử dụng thông tin liên hệ, thông tin đặt chỗ, đơn hàng và
            thanh toán để kiểm tra tình trạng còn chỗ, chuẩn bị và xác nhận Đặt
            chỗ, giữ chỗ tạm thời, nhận hoặc kiểm tra khoản thanh toán, cấp
            quyền ra vào, gửi xác nhận, lập chứng từ kế toán được yêu cầu, xử lý
            việc hủy hoặc khiếu nại, ngăn chặn đơn hàng trùng lặp hoặc gian lận
            và hỗ trợ về Đặt chỗ khi Quý khách liên hệ với chúng tôi.
          </>,
          <>
            Chúng tôi sử dụng dữ liệu tài khoản khách hàng để xác minh Quý
            khách, quản lý hồ sơ của Quý khách và liên kết tài khoản với các đặt
            chỗ được tạo bằng cùng địa chỉ email đã xác minh.
          </>,
          <>
            Nếu Quý khách kết nối trợ lý AI, chúng tôi sử dụng kết nối đó để trợ
            lý, theo chỉ dẫn của Quý khách, có thể tìm kiếm trong danh mục dịch
            vụ của chúng tôi, bắt đầu một đặt chỗ mà sau đó Quý khách xác nhận
            và thanh toán trên trang web của chúng tôi, và hiển thị cho Quý
            khách các đặt chỗ của mình.
          </>,
          <>
            Chúng tôi không sử dụng thông tin đặt chỗ hay thông tin yêu cầu cho
            mục đích tiếp thị, trừ khi Quý khách đồng ý riêng cho việc đó.
          </>,
          <>
            Nếu Quý khách đưa ra sự đồng ý không bắt buộc này, chúng tôi có thể
            sử dụng địa chỉ email của Quý khách để gửi thông tin tiếp thị và
            thông tin cộng đồng của Deskohub Workspace trong tương lai. Chúng
            tôi không cung cấp thông tin liên hệ của Quý khách cho công ty khác
            để công ty đó tiếp thị cho chính mình.
          </>,
          <>
            Khi có sự đồng ý phân tích của Quý khách, chúng tôi sử dụng các dịch
            vụ phân tích và đo lường bên ngoài để hiểu cách trang web được sử
            dụng, hiệu suất của việc gửi đặt chỗ và hiệu quả của các chiến dịch.
            Việc đo lường này không bao gồm dữ liệu Quý khách nhập vào biểu mẫu
            đặt chỗ.
          </>,
          <>
            Bất kể có sự đồng ý phân tích hay không, chúng tôi cũng chuyển cho
            nhà cung cấp dịch vụ phân tích bản ghi về từng bước của quá trình
            đặt chỗ và thanh toán, chẳng hạn khoản thanh toán đã bắt đầu, đã
            hoàn tất, không thành công hoặc bị bỏ dở và số tiền của khoản thanh
            toán đó. Chúng tôi sử dụng các bản ghi này để đo lường diễn biến của
            việc đặt chỗ và thanh toán và để phát hiện các sự cố thanh toán. Các
            bản ghi này được liên kết với đặt chỗ của Quý khách và, khi có sự
            đồng ý phân tích của Quý khách, cả với hồ sơ phân tích của tài khoản
            Quý khách. Các bản ghi không chứa tên hay thông tin liên hệ của Quý
            khách.
          </>,
          <>
            Chúng tôi cũng chuyển một số dữ liệu khách hàng được chọn lọc từ hệ
            thống đặt chỗ Dotypos của chúng tôi cho nhà cung cấp dịch vụ phân
            tích, để hiểu cách khách hàng sử dụng dịch vụ của chúng tôi và điều
            đó liên quan thế nào đến hoạt động của họ trên trang web: mã định
            danh khách hàng, tên, tên công ty, email, số điện thoại, địa chỉ,
            ngày sinh, nhóm giảm giá, điểm khách hàng thân thiết, nhãn khách
            hàng và thông tin về thời điểm bản ghi khách hàng được tạo, được
            thay đổi lần cuối hoặc bị xóa. Ghi chú và các dữ liệu khách hàng
            khác vẫn nằm trong Dotypos. Đối với khách hàng đã đăng nhập và đã
            đồng ý phân tích, mã định danh khách hàng liên kết các dữ liệu này
            với dữ liệu phân tích trang web của khách hàng đó.
          </>,
        ],
      },
      {
        heading: "4. Cơ sở pháp lý",
        body: [
          <>
            Trước khi giao kết hợp đồng, chúng tôi xử lý thông tin đặt chỗ để
            thực hiện các biện pháp theo yêu cầu của Quý khách. Sau khi giao kết
            hợp đồng, chúng tôi xử lý thông tin đó để thực hiện hợp đồng, bao
            gồm thanh toán, quyền ra vào, hỗ trợ, hủy và khiếu nại. Chúng tôi
            cũng xử lý các bản ghi kế toán và giao dịch để thực hiện nghĩa vụ
            pháp lý.
          </>,
          <>
            Chúng tôi xử lý việc đăng nhập tài khoản, quản lý hồ sơ và lịch sử
            đặt chỗ để cung cấp dịch vụ tài khoản mà Quý khách yêu cầu và, tùy
            theo hoàn cảnh, để thực hiện hoặc chuẩn bị hợp đồng đặt chỗ liên
            quan. Việc bảo mật tài khoản, tính toàn vẹn của phiên đăng nhập và
            việc bảo vệ khỏi hành vi lạm dụng dựa trên lợi ích hợp pháp của
            chúng tôi.
          </>,
          <>
            Chúng tôi xử lý việc kết nối trợ lý AI và các yêu cầu của trợ lý để
            cung cấp dịch vụ tài khoản mà Quý khách yêu cầu và, tùy theo hoàn
            cảnh, để chuẩn bị hợp đồng đặt chỗ liên quan theo yêu cầu của Quý
            khách.
          </>,
          <>
            Đối với việc bảo mật trang web, ngăn chặn lạm dụng và gian lận,
            chứng minh tin cậy về khoản thanh toán và đặt chỗ, cũng như xác lập,
            thực hiện hoặc bảo vệ các yêu cầu pháp lý, chúng tôi dựa trên lợi
            ích hợp pháp của mình, trừ khi các quyền của Quý khách được ưu tiên
            hơn các lợi ích đó.
          </>,
          <>
            Chúng tôi chỉ xử lý cookie không bắt buộc trên cơ sở sự đồng ý của
            Quý khách. Việc phân tích cách Quý khách sử dụng trang web và đo
            lường chiến dịch dựa trên sự đồng ý mà Quý khách có thể rút lại hoặc
            thay đổi bất cứ lúc nào trong cài đặt cookie.
          </>,
          <>
            Việc đo lường lưu lượng tự động theo nhóm dựa trên lợi ích hợp pháp
            của chúng tôi trong việc vận hành trang web và cải thiện trang web
            cho các công cụ tìm kiếm và trợ lý AI. Việc này không sử dụng bất kỳ
            dữ liệu nào có thể nhận diện Quý khách.
          </>,
          <>
            Việc ghi lại các bước đặt chỗ và thanh toán dựa trên lợi ích hợp
            pháp của chúng tôi trong việc đo lường diễn biến của việc đặt chỗ và
            thanh toán và phát hiện các khoản thanh toán không thành công hoặc
            bị bỏ dở, trừ khi các quyền của Quý khách được ưu tiên hơn lợi ích
            đó. Quý khách có thể phản đối việc xử lý này bất cứ lúc nào. Việc
            liên kết các bản ghi này với hồ sơ phân tích của tài khoản Quý khách
            dựa trên sự đồng ý phân tích của Quý khách.
          </>,
          <>
            Việc chuyển dữ liệu khách hàng từ hệ thống đặt chỗ của chúng tôi cho
            nhà cung cấp dịch vụ phân tích dựa trên lợi ích hợp pháp của chúng
            tôi trong việc hiểu và cải thiện dịch vụ của mình, trừ khi các quyền
            của Quý khách được ưu tiên hơn lợi ích đó. Quý khách có thể phản đối
            việc xử lý này bất cứ lúc nào.
          </>,
          <>
            Thông tin tiếp thị trong tương lai dựa trên sự đồng ý riêng của Quý
            khách. Việc đồng ý là tự nguyện và không phải là điều kiện để tạo
            hoặc thanh toán đặt chỗ.
          </>,
        ],
      },
      {
        heading: "5. Thời hạn lưu trữ",
        body: [
          <>
            Chúng tôi chỉ lưu trữ dữ liệu từ các yêu cầu không thành công và các
            đặt chỗ bị bỏ dở trong thời gian cần thiết để xử lý yêu cầu, khôi
            phục đơn hàng chưa hoàn tất, ngăn chặn lạm dụng hoặc bảo vệ các yêu
            cầu pháp lý. Đối với các Đặt chỗ đã hoàn tất, chúng tôi lưu trữ các
            bản ghi giao dịch, kế toán, khiếu nại và pháp lý trong thời gian
            pháp luật yêu cầu hoặc thời gian cần thiết một cách hợp lý để xác
            lập, thực hiện hoặc bảo vệ các yêu cầu pháp lý. Các tín hiệu kỹ
            thuật để bảo vệ khỏi hành vi lạm dụng chỉ được lưu trong thời gian
            ngắn.
          </>,
          <>
            Chúng tôi lưu trữ tài khoản khách hàng trong thời gian tài khoản
            được sử dụng; các phiên đăng nhập và liên kết tự động hết hạn và
            được chúng tôi xóa định kỳ. Khi xóa tài khoản, chúng tôi xóa thông
            tin đăng nhập của Quý khách và vô hiệu hóa hồ sơ khách hàng được
            liên kết. Các bản ghi đặt chỗ, thanh toán, kế toán và các bản ghi
            cần thiết để ngăn chặn gian lận hoặc làm bằng chứng pháp lý không bị
            xóa cùng với tài khoản đăng nhập và chỉ được lưu trong thời hạn lưu
            trữ tương ứng theo hợp đồng, theo luật định hoặc dựa trên lợi ích
            hợp pháp.
          </>,
          <>
            Thông tin truy cập của trợ lý được kết nối tự động hết hạn và được
            chúng tôi xóa định kỳ. Kết nối và các quyền đã cấp tồn tại cho đến
            khi Quý khách ngắt kết nối trợ lý trong mục “Trợ lý đã kết nối”
            trong tài khoản của mình hoặc cho đến khi Quý khách xóa tài khoản.
            Khi Quý khách ngắt kết nối trợ lý hoặc xóa tài khoản, kết nối và các
            quyền chấm dứt ngay lập tức: thông tin truy cập của trợ lý ngừng
            hoạt động ngay lập tức và bị xóa. Thông tin về việc trợ lý nào đã
            bắt đầu đặt chỗ vẫn được lưu cùng với bản ghi đặt chỗ.
          </>,
          <>
            Chúng tôi lưu trữ dữ liệu phân tích và dữ liệu đo lường chiến dịch,
            bao gồm dữ liệu khách hàng đã chuyển cho nhà cung cấp dịch vụ phân
            tích, theo cài đặt của các nhà cung cấp dịch vụ phân tích và kỹ
            thuật tương ứng và chỉ trong thời gian cần thiết cho các mục đích đo
            lường đã nêu.
          </>,
          <>
            Chúng tôi lưu bản ghi về sự đồng ý nhận thông tin tiếp thị của Quý
            khách, bao gồm cả việc rút lại sự đồng ý, cùng với bản ghi khách
            hàng của Quý khách, để có thể chứng minh lựa chọn của Quý khách.
          </>,
        ],
      },
      {
        heading: "6. Bên nhận dữ liệu",
        body: [
          <>
            Đội ngũ nội bộ của Workspace và, trong phạm vi cần thiết cho vai trò
            của mình, các nhà cung cấp dịch vụ lưu trữ web, hệ thống đặt chỗ và
            quản lý khách hàng, xử lý thanh toán, gửi email, lập chứng từ kế
            toán, bảo mật, phân tích, đo lường bên ngoài và các dịch vụ kỹ thuật
            khác có thể truy cập dữ liệu. Chúng tôi chỉ chuyển dữ liệu thanh
            toán cho nhà cung cấp dịch vụ thanh toán để tạo và kiểm tra giao
            dịch. Đối với việc truy cập của các nhà cung cấp, chúng tôi áp dụng
            các biện pháp bảo đảm thích hợp về hợp đồng, tổ chức và kỹ thuật.
          </>,
          <>
            Chúng tôi quản lý hồ sơ khách hàng và đặt chỗ trong hệ thống đặt chỗ
            Dotypos của chúng tôi.
          </>,
          <>
            Nếu Quý khách kết nối trợ lý AI, chúng tôi chuyển các thông tin mà
            trợ lý nhận được theo yêu cầu của Quý khách, chẳng hạn danh mục dịch
            vụ của chúng tôi và các đặt chỗ của Quý khách, cho nhà cung cấp trợ
            lý đó; nhà cung cấp này xử lý thông tin theo các điều khoản của
            riêng mình với tư cách là bên nhận do Quý khách lựa chọn. Nhà cung
            cấp này có thể có trụ sở ngoài Liên minh châu Âu (EU), chẳng hạn tại
            Hoa Kỳ, và dữ liệu của Quý khách được chuyển đến đó vì Quý khách đã
            yêu cầu như vậy.
          </>,
          <>
            Nếu trong tương lai chúng tôi gửi thông tin tiếp thị, nhà cung cấp
            dịch vụ email của chúng tôi có thể thay mặt chúng tôi xử lý thông
            tin liên hệ và dữ liệu gửi thư cần thiết để gửi các thông tin đó.
          </>,
        ],
      },
      {
        heading: "7. Chuyển dữ liệu ra ngoài EU",
        body: [
          <>
            Một số nhà cung cấp của chúng tôi hoặc các công ty làm việc cho họ
            có trụ sở ngoài Liên minh châu Âu, vì vậy dữ liệu của Quý khách cũng
            có thể được xử lý tại đó. Tại Hoa Kỳ, chúng tôi chỉ sử dụng các công
            ty được chứng nhận theo Khung bảo vệ dữ liệu EU–Hoa Kỳ hoặc bị ràng
            buộc bởi các điều khoản hợp đồng tiêu chuẩn của Ủy ban châu Âu. Bản
            đồ trên trang web của chúng tôi được tải từ một nhà cung cấp tại
            Vương quốc Anh. Ủy ban châu Âu đã quyết định rằng Vương quốc Anh và
            các công ty Hoa Kỳ được chứng nhận theo khung này bảo đảm mức độ bảo
            vệ dữ liệu cá nhân thích hợp. Quý khách có thể yêu cầu thông tin về
            việc chuyển dữ liệu hoặc bản sao các biện pháp bảo đảm tương ứng qua
            email{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
          <>
            Nhà cung cấp khóa cửa của chúng tôi có trụ sở tại Singapore, nơi
            chưa có quyết định như vậy. Để Quý khách có thể vào mặt bằng trong
            thời gian đặt chỗ, nhà cung cấp này nhận dữ liệu về mã ra vào của
            Quý khách, chẳng hạn thời hạn hiệu lực của mã. Chúng tôi chuyển dữ
            liệu này chỉ vì việc đó là cần thiết để cung cấp dịch vụ mà Quý
            khách đã đặt.
          </>,
        ],
      },
      {
        heading: "8. Quyền của Quý khách",
        body: [
          <>
            Theo các quy định hiện hành, Quý khách có thể yêu cầu truy cập,
            chỉnh sửa, xóa dữ liệu, hạn chế xử lý, phản đối việc xử lý hoặc yêu
            cầu chuyển dữ liệu (quyền di chuyển dữ liệu) nếu quyền này được áp
            dụng. Quý khách có thể gửi khiếu nại đến Úřad pro ochranu osobních
            údajů (Cơ quan Bảo vệ Dữ liệu Cá nhân Cộng hòa Séc) tại{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="https://uoou.gov.cz/"
              rel="noreferrer"
              target="_blank"
            >
              uoou.gov.cz
            </a>
            .
          </>,
          <>
            Quý khách có thể đồng ý hoặc rút lại sự đồng ý nhận thông tin tiếp
            thị bất cứ lúc nào trên trang quyền riêng tư trong tài khoản của
            mình, qua liên kết trong bất kỳ email tiếp thị nào hoặc bằng cách
            gửi email đến{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Việc rút lại sự đồng ý không ảnh hưởng đến việc xử lý đã diễn ra
            trước đó.
          </>,
          <>
            Quý khách có thể xóa tài khoản khách hàng trên trang hồ sơ của mình.
            Thao tác tự phục vụ này xóa tài khoản đăng nhập nhưng không thay thế
            cho một yêu cầu rộng hơn theo các quy định về bảo vệ dữ liệu cá nhân
            liên quan đến đặt chỗ hoặc các bản ghi được lưu trữ theo luật định;
            Quý khách vui lòng gửi yêu cầu như vậy đến{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            .
          </>,
        ],
      },
    ],
  },
  "marketing-communications": {
    updatedAt: "5 tháng 8, 2026",
    sections: [
      {
        heading: "1. Ai có thể liên hệ với Quý khách",
        body: [
          <>
            Đối với thông tin tiếp thị trong tương lai, bên gửi và Bên Kiểm soát
            dữ liệu cá nhân là {companyName}, Mã số doanh nghiệp (IČO){" "}
            {workspaceSiteConstants.company.identificationNumber}, địa chỉ{" "}
            {companyAddress}.
          </>,
        ],
      },
      {
        heading: "2. Quý khách đồng ý với điều gì",
        body: [
          "Quý khách đồng ý rằng chúng tôi có thể sử dụng tên, địa chỉ email và ngôn ngữ ưu tiên của Quý khách để gửi thông tin tiếp thị và thông tin cộng đồng của Deskohub Workspace qua email trong tương lai.",
          "Sự đồng ý áp dụng cho hoạt động tiếp thị qua email đối với các dịch vụ Deskohub Workspace của chính chúng tôi. Chúng tôi không cung cấp thông tin liên hệ của Quý khách cho công ty khác để công ty đó tiếp thị cho chính mình.",
          "Sự đồng ý gắn với bản ghi khách hàng tương ứng, không gắn với địa chỉ email. Nếu địa chỉ email của bản ghi này thay đổi, sự đồng ý vẫn được giữ cùng với bản ghi này. Các bản ghi khách hàng có cùng địa chỉ email có sự đồng ý riêng biệt.",
        ],
      },
      {
        heading: "3. Lựa chọn của Quý khách",
        body: [
          "Sự đồng ý là tự nguyện và tách biệt với việc đặt chỗ. Nếu Quý khách không đánh dấu vào ô đồng ý nhận thông tin tiếp thị, điều đó hoàn toàn không ngăn cản Quý khách tạo hoặc thanh toán đặt chỗ.",
          "Nếu Quý khách không đánh dấu vào ô đồng ý nhận thông tin tiếp thị, điều đó không có nghĩa là Quý khách rút lại tùy chọn đã có trước đó.",
          "Chúng tôi ghi lại sự đồng ý cùng với bản ghi khách hàng tương ứng, kèm theo thời điểm và phiên bản thông báo, để có thể chứng minh những gì Quý khách đã chấp nhận.",
          "Một đặt chỗ ẩn danh chỉ có thể thiết lập tùy chọn ban đầu về thông tin tiếp thị của khách hàng khi chưa có tùy chọn nào. Đặt chỗ đó không thể ghi đè tùy chọn hiện có.",
        ],
      },
      {
        heading: "4. Quản lý và rút lại sự đồng ý",
        body: [
          <>
            Quý khách có thể đồng ý hoặc rút lại sự đồng ý trên trang quyền
            riêng tư trong tài khoản của mình nếu Quý khách đăng nhập bằng tài
            khoản đã xác minh được liên kết với bản ghi khách hàng tương ứng.
            Liên kết dành riêng cho từng khách hàng trong thông tin tiếp thị gửi
            trong tương lai cũng có thể cho phép Quý khách đồng ý hoặc rút lại
            sự đồng ý. Nếu không có cách nào trong số này, Quý khách vui lòng
            liên hệ bộ phận hỗ trợ của chúng tôi tại{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href={`mailto:${contactEmail}`}
            >
              {contactEmail}
            </a>
            . Việc rút lại sự đồng ý áp dụng cho hoạt động tiếp thị trong tương
            lai và không ảnh hưởng đến việc xử lý hợp pháp trước đó.
          </>,
        ],
      },
      {
        heading: "5. Nhà cung cấp và quyền của Quý khách",
        body: [
          <>
            Nếu trong tương lai chúng tôi gửi thông tin tiếp thị, nhà cung cấp
            dịch vụ email của chúng tôi có thể thay mặt chúng tôi xử lý thông
            tin liên hệ và dữ liệu gửi thư cần thiết để gửi các thông tin đó.
            Quý khách có thể tìm hiểu thêm về bên nhận dữ liệu, các biện pháp
            bảo đảm và quyền của mình trong{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/vi-VN/privacy-policy"
            >
              Chính sách bảo vệ dữ liệu cá nhân
            </a>{" "}
            của chúng tôi.
          </>,
        ],
      },
    ],
  },
  "terms-and-conditions": {
    updatedAt: "12 tháng 8, 2026",
    sections: termsAndConditionsSections,
  },
  "cookie-policy": {
    updatedAt: "8 tháng 11, 2026",
    sections: [
      {
        heading: "1. Cookie là gì",
        body: [
          <>
            Cookie là các tệp văn bản nhỏ được lưu trong trình duyệt, giúp trang
            web ghi nhớ các lựa chọn kỹ thuật, cải thiện khả năng sử dụng và
            kiểm soát việc bật các chức năng không bắt buộc.
          </>,
        ],
      },
      {
        heading: "2. Cookie thiết yếu",
        body: [
          <>
            Cookie thiết yếu hỗ trợ hoạt động cơ bản của trang web, việc xử lý
            ngôn ngữ, bảo mật và việc lưu trạng thái đồng ý cookie của Quý
            khách. Các cookie này luôn hoạt động vì nếu không có chúng, trang
            web không thể hoạt động ổn định.
          </>,
          <>
            Sau khi Quý khách đăng nhập vào tài khoản khách hàng, cookie phiên
            đăng nhập thiết yếu giúp Quý khách duy trì trạng thái đăng nhập tối
            đa 30 ngày. Cookie này chỉ được thiết lập sau khi đăng nhập và bị
            xóa khi đăng xuất hoặc xóa tài khoản.
          </>,
          <>
            Khi Quý khách mở liên kết giới thiệu từ một khách hàng khác, một
            cookie thiết yếu ghi nhớ mã giới thiệu của khách hàng đó trong tối
            đa 30 ngày để có thể áp dụng mức giảm giá mà Quý khách đã yêu cầu
            khi hoàn thiện hồ sơ hoặc khi đặt chỗ. Liên kết giới thiệu được mở
            sau đó không thay thế mã đã được ghi nhớ; tuy nhiên, mã giới thiệu
            mà Quý khách nhập ở bước thanh toán và được chấp nhận sẽ thay thế mã
            đó. Cookie bị xóa ngay khi lượt giới thiệu được ghi nhận hoặc khi
            đặt chỗ đầu tiên của Quý khách được thanh toán, và không được dùng
            để theo dõi.
          </>,
        ],
      },
      {
        heading: "3. Cookie ghi nhớ tùy chọn",
        body: [
          <>
            Cookie ghi nhớ tùy chọn lưu lại các cài đặt hiển thị hoặc tương tác
            không bắt buộc, nếu các chức năng như vậy đang hoạt động trên trang
            web.
          </>,
        ],
      },
      {
        heading: "4. Cookie phân tích và tiếp thị",
        body: [
          <>
            Cookie phân tích và tiếp thị là không bắt buộc. Nếu các công cụ phân
            tích, đo lường bên ngoài, đo lường chiến dịch hoặc các công cụ kỹ
            thuật tương tự của nhà cung cấp được sử dụng trên trang web, các
            công cụ đó chỉ được kích hoạt sau khi Quý khách đồng ý qua biểu ngữ
            cookie hoặc trang cài đặt cookie.
          </>,
          <>
            Cookie phân tích giúp chúng tôi hiểu cách trang web được sử dụng,
            hiệu suất của việc gửi đặt chỗ và hiệu quả của các chiến dịch. Tùy
            theo nhóm nhà cung cấp, dữ liệu được xử lý có thể bao gồm lượt xem
            trang, thông tin về trình duyệt và thiết bị, dữ liệu kỹ thuật suy ra
            từ địa chỉ IP, loại sự kiện và các tham số chiến dịch tiêu chuẩn từ
            URL: utm_source, utm_medium, utm_campaign, utm_content và utm_term.
          </>,
          <>
            Khi có sự đồng ý phân tích của Quý khách, chúng tôi cũng gắn các bản
            ghi về đặt chỗ và thanh toán của Quý khách vào hồ sơ phân tích của
            tài khoản Quý khách, như được mô tả trong{" "}
            <a
              className="text-burned-orange underline underline-offset-4"
              href="/vi-VN/privacy-policy"
            >
              Chính sách bảo vệ dữ liệu cá nhân
            </a>{" "}
            của chúng tôi.
          </>,
          <>
            Các sự kiện chuyển đổi về việc gửi đặt chỗ không chứa giá trị từ
            biểu mẫu đặt chỗ hay dữ liệu cá nhân như tên, email, số điện thoại,
            tin nhắn, ngày hoặc giờ đặt chỗ, thời lượng, số chỗ, sản phẩm đã
            chọn hay các lựa chọn về đồ ăn uống, màn hình hoặc trạm làm việc.
          </>,
        ],
      },
      {
        heading: "5. Cách quản lý sự đồng ý",
        body: [
          <>
            Quý khách có thể chấp nhận tất cả các nhóm cookie không bắt buộc, từ
            chối các nhóm không bắt buộc hoặc quản lý từng nhóm qua biểu ngữ
            cookie và trang cài đặt cookie riêng có thể truy cập từ chân trang.
          </>,
        ],
      },
    ],
  },
  "operating-rules": {
    updatedAt: "12 tháng 8, 2026",
    sections: operatingRulesSections,
  },
} satisfies LegalDocumentBodies;

export const translation = {
  translationNotice:
    "Đây là bản dịch của bản gốc tiếng Séc. Trong trường hợp có bất kỳ khác biệt nào giữa bản dịch này và bản tiếng Séc, bản tiếng Séc được ưu tiên áp dụng.",
  documents: legalDocuments,
} satisfies LegalDocumentTranslation;
