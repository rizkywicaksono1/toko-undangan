// routes/auth.js — registrasi, login, login Google, verifikasi email, profil pengguna
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendVerificationEmail } = require('../utils/mailer');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: !!user.is_admin, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function dispatchVerificationEmail(user) {
  const token = generateVerificationToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // berlaku 24 jam

  await pool.query(
    'UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?',
    [token, expires, user.id]
  );

  const verifyUrl = `${process.env.FRONTEND_URL}/verifikasi-email?token=${token}`;
  return sendVerificationEmail(user.email, user.name, verifyUrl);
}
// POST /api/auth/register-request
// Mengirim OTP dan menyimpan sementara (BELUM masuk ke tabel users)
router.post('/register-request', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Pastikan belum terdaftar di tabel users resmi
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
    }

    // Buat kode OTP 6 digit acak
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Berlaku 10 menit
    const hash = await bcrypt.hash(password, 10);

    // Kirim email OTP TERLEBIH DAHULU
    // Jika email ngawur / gagal kirim, proses langsung berhenti di sini
    await sendOtpEmail(cleanEmail, name.trim(), otp);

    // Simpan data SEMENTARA di pending_verifications
    await pool.query(
      `INSERT INTO pending_verifications (email, name, password_hash, otp, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), otp = VALUES(otp), expires_at = VALUES(expires_at)`,
      [cleanEmail, name.trim(), hash, otp, expiresAt]
    );

    res.json({ message: 'Kode OTP telah dikirim ke email Anda. Silakan cek kotak masuk/spam.' });
  } catch (err) {
    console.error('Register request error:', err);
    res.status(500).json({ error: 'Gagal mengirim email verifikasi. Pastikan alamat email benar.' });
  }
});

// POST /api/auth/verify-otp
// Cek OTP, jika benar BARU dimasukkan ke tabel users resmi
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    const [rows] = await pool.query(
      'SELECT * FROM pending_verifications WHERE email = ? AND otp = ?',
      [cleanEmail, String(otp).trim()]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Kode OTP salah atau email tidak cocok.' });
    }

    const pending = rows[0];
    if (new Date(pending.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Kode OTP telah kedaluwarsa. Silakan daftar ulang.' });
    }

    // DISINI BARU INSERT RESMI KE TABEL USERS TIDB
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)',
      [pending.name, pending.email, pending.password_hash]
    );

    // Hapus dari data sementara
    await pool.query('DELETE FROM pending_verifications WHERE email = ?', [cleanEmail]);

    const newUser = { id: result.insertId, name: pending.name, email: pending.email, is_admin: 0 };
    const token = signToken(newUser);

    res.status(201).json({
      message: 'Akun berhasil diverifikasi dan terdaftar!',
      token,
      user: newUser,
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Gagal memverifikasi akun.' });
  }
});


// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Email Anda belum diverifikasi. Silakan cek kotak masuk (atau folder spam) untuk link verifikasi.',
        needs_verification: true,
      });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, is_admin: !!user.is_admin },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Gagal masuk. Coba lagi nanti.' });
  }
});

// GET /api/auth/verify-email?token=... — dipanggil saat pengguna klik link di email
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token verifikasi tidak ditemukan.' });

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE verification_token = ?',
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Link verifikasi tidak valid atau sudah pernah dipakai.' });
    }
    const user = rows[0];

    if (user.is_verified) {
      return res.json({ message: 'Email Anda sudah terverifikasi sebelumnya. Silakan masuk.' });
    }

    if (!user.verification_expires || new Date(user.verification_expires) < new Date()) {
      return res.status(400).json({
        error: 'Link verifikasi sudah kedaluwarsa. Silakan minta link verifikasi baru.',
        expired: true,
      });
    }

    await pool.query(
      'UPDATE users SET is_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
      [user.id]
    );

    res.json({ message: 'Email berhasil diverifikasi! Silakan masuk ke akun Anda.' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Gagal memverifikasi email. Coba lagi nanti.' });
  }
});

// POST /api/auth/resend-verification — kirim ulang email verifikasi
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email wajib diisi.' });

    const genericMessage = {
      message: 'Jika email tersebut terdaftar dan belum diverifikasi, kami sudah mengirim ulang link verifikasi.',
    };

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (rows.length === 0) return res.json(genericMessage); // jangan bocorkan email terdaftar atau tidak

    const user = rows[0];
    if (user.is_verified) {
      return res.json({ message: 'Email ini sudah terverifikasi. Silakan langsung masuk.' });
    }

    await dispatchVerificationEmail(user);
    res.json(genericMessage);
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Gagal mengirim ulang email verifikasi.' });
  }
});

// POST /api/auth/google — daftar / masuk otomatis pakai akun Google
// Menerima "credential" = ID token dari tombol Google Sign-In di frontend.
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Token Google tidak ditemukan.' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'Login Google belum dikonfigurasi di server (GOOGLE_CLIENT_ID kosong).' });
    }

    // Verifikasi token langsung ke server Google, tanpa perlu library tambahan.
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Token Google tidak valid atau kedaluwarsa.' });
    }
    const payload = await verifyRes.json();

    // Pastikan token ini memang dibuat untuk aplikasi kita (mencegah token dari aplikasi lain dipakai di sini)
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Token Google tidak sesuai dengan aplikasi ini.' });
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return res.status(401).json({ error: 'Email Google Anda belum terverifikasi.' });
    }

    const email = String(payload.email).toLowerCase().trim();
    const name = payload.name || email.split('@')[0];

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    let user;

    if (rows.length === 0) {
      // Akun baru dari Google: buat password acak (tidak pernah dipakai, login tetap lewat Google)
      // Langsung is_verified = 1 karena Google sudah memverifikasi kepemilikan email ini.
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const hash = await bcrypt.hash(randomPassword, 10);
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)',
        [name, email, hash]
      );
      user = { id: result.insertId, name, email, is_admin: 0 };
    } else {
      user = rows[0];
      if (!user.is_verified) {
        // Pengguna pernah daftar manual tapi belum verifikasi; karena berhasil masuk lewat
        // Google dengan email yang sama, kepemilikan emailnya sudah terbukti.
        await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id]);
      }
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, is_admin: !!user.is_admin },
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Gagal masuk dengan Google. Coba lagi nanti.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, is_admin FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  const u = rows[0];
  res.json({ id: u.id, name: u.name, email: u.email, is_admin: !!u.is_admin });
});

module.exports = router;
