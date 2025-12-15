const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
require('dotenv').config();

// POST /send-email
router.post("/", async (req, res) => {
  const { message } = req.body;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"Project Faith 💖" <${process.env.EMAIL_USER}>`,
    to: "elgenprestosa@gmail.com",
    subject: "A special letter for you 💌",
    html: `<div>${message || "There's something special waiting for you 💖"}</div>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("Email sending error:", error);
    res.status(500).json({ message: "Error sending email", error: error.message });
  }
});

module.exports = router;





//======================================================
// const express = require("express");
// const router = express.Router();
// const { sendEmail } = require("../configs/mailer");

// // POST /send-email
// router.post("/", async (req, res) => {
//   const { message } = req.body;

//   try {
//     await sendEmail("elgenprestosa@gmail.com", message);
//     res.status(200).json({ message: "Email sent successfully!" });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Error sending email", error });
//   }
// });

// module.exports = router;