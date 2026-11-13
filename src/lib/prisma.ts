import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function upstashVectorCredentials(): { url: string; token: string } | null {
  const url = process.env.HUSFELDS_VECTOR_UPSTASH_VECTOR_REST_URL || process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.HUSFELDS_VECTOR_UPSTASH_VECTOR_REST_TOKEN || process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function vectorDatabaseConfigured(): boolean {
  return upstashVectorCredentials() !== null;
}

export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}
