import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

function loadJson<T>(filename: string): T {
  const filePath = path.join(__dirname, '../../seed', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

interface UserSeed {
  id: number;
  login_id: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

interface AccountSeed {
  id: number;
  user_id: number;
  name: string;
  account_type: string;
  initial_balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

interface CategorySeed {
  id: number;
  user_id: number;
  name: string;
  category_type: string;
  icon?: string;
  color: string;
  created_at: string;
  updated_at: string;
}

interface TransactionSeed {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number;
  occurred_on: string;
  amount: number;
  memo?: string;
  created_at: string;
  updated_at: string;
}

async function main() {
  const users = loadJson<UserSeed[]>('users.json');
  const accounts = loadJson<AccountSeed[]>('accounts.json');
  const categories = loadJson<CategorySeed[]>('categories.json');
  const transactions = loadJson<TransactionSeed[]>('transactions.json');

  // Seed users
  let userCount = 0;
  for (const u of users) {
    // Determine password hash: use bcrypt if placeholder detected
    let passwordHash = u.password_hash;
    if (passwordHash.includes('REPLACE_ME')) {
      passwordHash = bcrypt.hashSync('demo123', 10);
    }

    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        login_id: u.login_id,
        password_hash: passwordHash,
        display_name: u.display_name,
        created_at: new Date(u.created_at),
        updated_at: new Date(u.updated_at),
      },
    });
    userCount++;
  }
  console.log(`Users seeded: ${userCount}`);

  // Seed accounts
  let accountCount = 0;
  for (const a of accounts) {
    await prisma.account.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        user_id: a.user_id,
        name: a.name,
        account_type: a.account_type,
        initial_balance: a.initial_balance,
        currency: a.currency,
        created_at: new Date(a.created_at),
        updated_at: new Date(a.updated_at),
      },
    });
    accountCount++;
  }
  console.log(`Accounts seeded: ${accountCount}`);

  // Seed categories
  let categoryCount = 0;
  for (const c of categories) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        user_id: c.user_id,
        name: c.name,
        category_type: c.category_type,
        icon: c.icon ?? null,
        color: c.color,
        created_at: new Date(c.created_at),
        updated_at: new Date(c.updated_at),
      },
    });
    categoryCount++;
  }
  console.log(`Categories seeded: ${categoryCount}`);

  // Seed transactions
  let txCount = 0;
  for (const t of transactions) {
    await prisma.transaction.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        user_id: t.user_id,
        account_id: t.account_id,
        category_id: t.category_id,
        occurred_on: t.occurred_on,
        amount: t.amount,
        memo: t.memo ?? null,
        created_at: new Date(t.created_at),
        updated_at: new Date(t.updated_at),
      },
    });
    txCount++;
  }
  console.log(`Transactions seeded: ${txCount}`);

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
