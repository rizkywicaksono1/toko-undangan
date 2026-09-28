// utils/mailer.js
const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.error('[mailer] Kredensial SMTP_USER atau SMTP_PASS belum disetel di Environment!');
    return null;
  }

  // Bersihkan karakter spasi jika ada di App Password
  const cleanPass = pass.replace(/\s+/g, '');

  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Port 465 WAJIB secure: true
    auth: {
      user: user,
      pass: cleanPass,
    },
    // Timeout cepat agar backend tidak menggantung (hang) jika port diblokir
    connectionTimeout: 10000, // 10 detik
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  return transporter;
};

// 1. Fungsi kirim Kode OTP (Registrasi)
async function sendOtpEmail(to, otp) {
  const t = getTransporter();
  if (!t) {
    throw new Error('Layanan email belum dikonfigurasi di server (SMTP_USER/SMTP_PASS kosong).');
  }

  const fromName = process.env.SMTP_FROM_NAME || 'Toko Undangan Digital';
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  await t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `Kode Verifikasi Pendaftaran: ${otp}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #f1d5dc; border-radius: 12px; background-color: #fff9fa;">
        <h2 style="color: #b3435c; text-align: center; margin-top: 0;">Verifikasi Email Anda</h2>
        <p style="color: #4b5563; font-size: 15px; line-height: 1.5;">Halo,</p>
        <p style="color: #4b5563; font-size: 15px; line-height: 1.5;">Terima kasih sudah mendaftar di <strong>Toko Undangan Digital</strong>. Masukkan 6 digit kode OTP berikut untuk mengaktifkan akun Anda:</p>
        
        <div style="background-color: #ffffff; border: 2px dashed #b3435c; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #b3435c; display: inline-block;">${otp}</span>
        </div>
        
        <p style="color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 0;">
          Kode ini berlaku selama <strong>10 menit</strong>.<br>
          Jika Anda tidak merasa mendaftar, silakan abaikan email ini.
        </p>
      </div>
    `,
  });

  return { sent: true };
}

// 2. Fungsi kirim Link Verifikasi (jika masih digunakan di tempat lain)
async function sendVerificationEmail(to, name, verifyUrl) {
  const t = getTransporter();
  if (!t) {
    return { sent: false, reason: 'SMTP belum dikonfigurasi' };
  }

  const fromName = process.env.SMTP_FROM_NAME || 'Toko Undangan Digital';
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  await t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: 'Verifikasi Email Anda - Toko Undangan Digital',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
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

module.exports = {
  sendOtpEmail,
  sendVerificationEmail,
};
