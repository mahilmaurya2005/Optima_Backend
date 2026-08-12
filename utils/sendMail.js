const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

const sendMail = async (subject, content, isHtml = false) => {
  try {
    console.log("Attempting to send email...");

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: "optimadispatch1982@gmail.com",
      subject: subject,
    };

    if (isHtml) {
      mailOptions.html = content; 
    } else {
      mailOptions.text = content; 
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    return info;

  } catch (error) {
    console.error("Mail sending error:", error);
    throw error; 
  }
};

module.exports = sendMail;