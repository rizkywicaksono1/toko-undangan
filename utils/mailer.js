// utils/mailer.js — pengirim email lewat SMTP (bisa pakai Gmail, atau layanan SMTP lain)
const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // Belum dikonfigurasi
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465, // true untuk port 465, false untuk 587/lainnya
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendVerificationEmail(to, name, verifyUrl) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[mailer] SMTP belum dikonfigurasi. Link verifikasi untuk ${to}: ${verifyUrl}`
    );
    return { sent: false, reason: 'SMTP belum dikonfigurasi' };
  }

  const fromName = process.env.SMTP_FROM_NAME || 'Toko Undangan Digital';
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  await t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: 'Verifikasi Email Anda - Toko Undangan Digital',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #b3435c;">Halo, ${name}!</h2>
        <p>Terima kasih sudah mendaftar di Toko Undangan Digital. Klik tombol di bawah untuk memverifikasi email Anda:</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${verifyUrl}" style="background:#b3435c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
            Verifikasi Email Saya
          </a>
        </p>
        <p>Atau salin link berikut ke browser Anda:</p>
        <p style="word-break: break-all; color: #555;">${verifyUrl}</p>
        <p style="color:#999; font-size: 0.85rem;">Link ini berlaku selama 24 jam. Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
      </div>
    `,
  });

  return { sent: true };
}

module.exports = { sendVerificationEmail };
