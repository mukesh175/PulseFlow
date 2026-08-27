import { PrismaClient } from '@prisma/client';

// Serverless-safe singleton: Vercel reuses warm lambdas, and Next.js dev
// hot-reloads modules — both would otherwise open a new pool per reload.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__pulseflowPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pulseflowPrisma = prisma;
}

export default prisma;
