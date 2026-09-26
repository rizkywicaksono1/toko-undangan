// routes/auth.js — registrasi, login, profil pengguna
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

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), hash]
    );

   const user = { id: result.insertId, name: name.trim(), email: email.toLowerCase().trim() };
const emailResult = await dispatchVerificationEmail(user);

res.status(201).json({
  message: 'Pendaftaran berhasil! Silakan cek email Anda untuk memverifikasi akun sebelum bisa masuk.',
  email_sent: emailResult.sent,
});
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Gagal mendaftar. Coba lagi nanti.' });
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
    if (rows.length === 0) return res.json(genericMessage);

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

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, is_admin FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  const u = rows[0];
  res.json({ id: u.id, name: u.name, email: u.email, is_admin: !!u.is_admin });
});

module.exports = router;
