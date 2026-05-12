import { execSync } from 'child_process';
import * as path from 'path';

export default async function globalSetup() {
  // Project root = generated/ (3 levels up from src/test/e2e/)
  const cwd = path.resolve(__dirname, '../../../');
  execSync('npm run db:reset', {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, DATABASE_URL: `file:${cwd}/prisma/dev.db` },
  });
}
