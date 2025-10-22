import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

function toExpiresIn(value?: string): number {
  if (!value) return 7200;
  const v = value.trim().toLowerCase();
  if (v.endsWith('h')) return Number(v.slice(0, -1)) * 3600;
  if (v.endsWith('m')) return Number(v.slice(0, -1)) * 60;
  const n = Number(v);
  return Number.isFinite(n) ? n : 7200;
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-please',
      signOptions: { expiresIn: toExpiresIn(process.env.JWT_EXPIRES_IN) },
    }),
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}