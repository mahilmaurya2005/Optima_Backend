const PDFDocument = require("pdfkit");

const generateChallanPDF = (challan) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
      });

      let buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        let pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      doc.fontSize(16).text("OPTIMA POLYPLAST LLP", { align: "center" });

      doc
        .fontSize(8)
        .text("Plot No. 12, 296, Industrial Road, Near Umiya Battery,", {
          align: "center",
        })
        .text("Mota Jalundra Industrial Zone, Derojnagar, Gandhinagar,", {
          align: "center",
        })
        .text("Mo. 9274658587", { align: "center" });

      doc.moveDown(0.5);
      doc
        .fontSize(8)
        .text("ISO 9001:2015 Certified Company", { align: "center" });

      const topSectionY = 140;

      doc
        .fontSize(8)
        .text("User Code:", 40, topSectionY)
        .text(challan.userCode, 90, topSectionY)
        .text("Date:", 40, topSectionY + 20)
        .text(new Date(challan.date).toLocaleDateString(), 90, topSectionY + 20)
        .text("Driver Name:", 40, topSectionY + 40)
        .text(challan.driverName, 90, topSectionY + 40);

      doc
        .text("INVOICE No.:", 300, topSectionY)
        .text(challan.invoiceNo, 360, topSectionY)
        .text("Vehicle No.:", 300, topSectionY + 20)
        .text(challan.vehicleNo || "-", 360, topSectionY + 20)
        .text("Mobile No.:", 300, topSectionY + 40)
        .text(challan.mobileNo || "-", 360, topSectionY + 40);

      doc.text("Mr/Mrs", 40, topSectionY + 70);

      const tableTop = topSectionY + 100;
      const tableHeaders = [
        "Sr. No",
        "Descriptions",
        "Quantity",
        "Rate",
        "Amount",
      ];
      const columnWidths = [40, 200, 100, 100, 100];
      const startX = 40;
      let currentX = startX;

      doc.fillColor("#E6E6FA").rect(startX, tableTop, 540, 20).fill();

      doc.fillColor("black");
      tableHeaders.forEach((header, i) => {
        doc.text(header, currentX, tableTop + 5, {
          width: columnWidths[i],
          align: "center",
        });
        currentX += columnWidths[i];
      });

      let currentY = tableTop + 20;
      for (let i = 0; i < 12; i++) {
        const item = challan.items[i] || {};
        currentX = startX;

        doc
          .moveTo(startX, currentY)
          .lineTo(startX + 540, currentY)
          .stroke();

        if (item.description) {
          doc
            .text((i + 1).toString(), currentX, currentY + 5, {
              width: columnWidths[0],
              align: "center",
            })
            .text(item.description, currentX + columnWidths[0], currentY + 5, {
              width: columnWidths[1],
              align: "left",
            })
            .text(
              item.boxes?.toString() || "",
              currentX + columnWidths[0] + columnWidths[1],
              currentY + 5,
              { width: columnWidths[2], align: "center" }
            )
            .text(
              item.rate?.toString() || "",
              currentX + columnWidths[0] + columnWidths[1] + columnWidths[2],
              currentY + 5,
              { width: columnWidths[3], align: "center" }
            )
            .text(
              item.amount?.toString() || "",
              currentX +
                columnWidths[0] +
                columnWidths[1] +
                columnWidths[2] +
                columnWidths[3],
              currentY + 5,
              { width: columnWidths[4], align: "center" }
            );
        }

        currentY += 30;
      }

      doc
        .font("Helvetica-Bold")
        .text("Total", startX, currentY + 10)
        .text(
          challan.totalAmount?.toFixed(2) || "0.00",
          startX + 440,
          currentY + 10,
          { align: "right" }
        );

      currentY += 50;
      doc
        .font("Helvetica")
        .text("Signature", startX, currentY)
        .text("Receiver's Sign", startX + 440, currentY)
        .text("Name:", startX + 440, currentY + 20);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = generateChallanPDF;
