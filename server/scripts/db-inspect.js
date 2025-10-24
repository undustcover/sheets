const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const users = await prisma.user.findMany();
    console.log('Users:', users.map(u => ({ id: u.id, username: u.username, role: u.role, password_start: String(u.password).slice(0, 10) })));
    if (users.length) {
      const u = users[0];
      const okAdmin = await argon2.verify(u.password, 'admin');
      const okAdmin123 = await argon2.verify(u.password, 'admin123');
      console.log('Verify admin:', okAdmin, ' | Verify admin123:', okAdmin123);
    }
  } catch (e) {
    console.error('DB INSPECT ERROR:', e && e.message);
  } finally {
    await prisma.$disconnect();
  }
})();