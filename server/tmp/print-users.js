const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany();
    console.log(JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('Error querying users:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();