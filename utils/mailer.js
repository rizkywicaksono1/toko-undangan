// utils/mailer.js
require('dotenv').config();

// 1. Fungsi Kirim OTP Registrasi via API HTTPS Resend (Anti-Blokir Render)
async function sendOtpEmail(to, otp) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error('[mailer] RESEND_API_KEY belum disetel di Environment Variables Render!');
    throw new Error('Layanan email belum dikonfigurasi di server.');
  }

  const fromEmail = process.env.EMAIL_FROM || 'Toko Undangan Digital <onboarding@resend.dev>';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[mailer] Resend Error:', data);
    throw new Error(data.message || 'Gagal mengirim email OTP');
  }

  console.log('[mailer] Email OTP berhasil dikirim:', data.id);
  return { sent: true, data };
}

// 2. Fungsi Kirim Link Verifikasi
async function sendVerificationEmail(to, name, verifyUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY belum dikonfigurasi' };
  }

  const fromEmail = process.env.EMAIL_FROM || 'Toko Undangan Digital <onboarding@resend.dev>';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: 'Verifikasi Email Anda - Toko Undangan Digital',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #b3435c;">Halo, ${name}!</h2>
            <p>Terima kasih sudah mendaftar di Toko Undangan Digital. Klik tautan berikut untuk memverifikasi akun Anda:</p>
            <p style="text-align: center; margin: 28px 0;">
              <a href="${verifyUrl}" style="background:#b3435c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Verifikasi Email</a>
            </p>
            <p style="color:#999; font-size: 0.85rem;">Tautan ini berlaku selama 24 jam.</p>
          </div>
        `,
      }),
    });

    const data = await response.json();
    return { sent: response.ok, data };
  } catch (err) {
    console.error('[mailer] Fetch Error:', err);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  sendOtpEmail,
  sendVerificationEmail,
};
