require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// API: Register User
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
    }
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Bu e-posta zaten kullanımda.' });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password,
        role: 'ORGANIZER',
      },
    });
    
    res.json({ message: 'Kayıt başarılı!', user });
  } catch (error) {
    res.status(500).json({ error: 'Kayıt olurken bir hata oluştu.' });
  }
});

// API: Login User
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    res.json({ message: 'Giriş başarılı!', user });
  } catch (error) {
    res.status(500).json({ error: 'Giriş yaparken bir hata oluştu.' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
