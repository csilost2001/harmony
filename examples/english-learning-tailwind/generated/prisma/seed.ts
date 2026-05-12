import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Upsert test user
  const passwordHash = await bcrypt.hash('TestPassword123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      password_hash: passwordHash,
      display_name: 'Test User',
      cefr_level: 'A1',
      streak_days: 0,
    },
  });

  // Upsert test story
  const story = await prisma.story.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      title: 'Test Story',
      cefr_level: 'B1',
      is_active: true,
    },
  });

  // Upsert learning_session id=1 for Step P5 tests (validSessionId=1)
  await prisma.learningSession.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      user_id: user.id,
      story_id: story.id,
      status: 'in_progress',
    },
  });

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
