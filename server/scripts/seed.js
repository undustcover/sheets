// Simple seed script to create default admin user
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')

async function main() {
  const prisma = new PrismaClient()
  try {
    const username = 'admin'
    const passwordPlain = 'admin123'
    const role = 'admin'
    const hashed = await argon2.hash(passwordPlain)

    // Upsert admin user
    const user = await prisma.user.upsert({
      where: { username },
      update: { password: hashed, role },
      create: { username, password: hashed, role },
    })

    console.log('Seeded user:', { id: user.id, username: user.username, role: user.role })
  } catch (e) {
    console.error('Seed error:', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()