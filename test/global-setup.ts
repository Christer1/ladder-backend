import { execSync } from 'child_process';
import './setup-env';

// Apply migrations to the test database before any e2e suite runs.
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env });
}
