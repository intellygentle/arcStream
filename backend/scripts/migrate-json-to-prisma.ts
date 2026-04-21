import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Load Environment Variables
dotenv.config();

// 2. ESM __dirname Fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 3. Initialize Prisma with the PostgreSQL Adapter (Required for v7)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function migrateUsers() {
  const usersPath = path.resolve(__dirname, '../src/data/users.json');
  
  if (!fs.existsSync(usersPath)) {
    console.log('⚠️ users.json not found, skipping...');
    return;
  }
  
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  console.log(`🔄 Migrating ${users.length} users...`);
  
  for (const user of users) {
    try {
      await prisma.user.upsert({
        where: { eoaAddress: user.eoa },
        update: {},
        create: {
          eoaAddress: user.eoa,
          dcwAddress: user.dcwAddress,
          circleWalletId: user.dcwWalletId || "",
          createdAt: new Date(user.createdAt || Date.now()),
        },
      });
      console.log(`✅ Migrated: ${user.eoa}`);
    } catch (err: any) {
      console.error(`❌ Error migrating user ${user.eoa}:`, err.message);
    }
  }
}

async function migrateVideos() {
  const videosPath = path.resolve(__dirname, '../src/data/videos.json');
  if (!fs.existsSync(videosPath)) return;

  const videos = JSON.parse(fs.readFileSync(videosPath, 'utf-8'));
  console.log(`🔄 Migrating ${videos.length} videos...`);

  for (const v of videos) {
    try {
      await prisma.video.upsert({
        where: { id: v.id },
        update: {},
        create: {
          id: v.id,
          title: v.title,
          sessionDuration: v.pricingModel === 'per_5s' ? 5 : 60,
          pricePerSession: v.pricePerChunk || 0.001,
          creatorAddress: v.creatorWallet,
          // Note: ensure these field names match your schema exactly
        }
      });
      console.log(`✅ Migrated: ${v.title}`);
    } catch (err: any) {
      console.error(`❌ Error migrating video ${v.id}:`, err.message);
    }
  }
}

async function main() {
  try {
    await migrateUsers();
    await migrateVideos();
    console.log('🎉 Migration successful!');
  } catch (err) {
    console.error('💥 Global Migration Error:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end(); // Important to close the PG pool
  }
}

main();