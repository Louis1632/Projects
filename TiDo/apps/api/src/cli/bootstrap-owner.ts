import { bootstrapOwner, BootstrapError, createDb } from '@tido/db';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const { db, close } = createDb(required('DATABASE_URL'), { max: 1 });
try {
  const link = await bootstrapOwner(db, {
    email: required('BOOTSTRAP_OWNER_EMAIL'),
    displayName: process.env.BOOTSTRAP_OWNER_NAME ?? 'Workspace owner',
    workspaceName: process.env.BOOTSTRAP_WORKSPACE_NAME ?? 'Home',
    timezone: process.env.WORKSPACE_TIMEZONE ?? 'Africa/Johannesburg',
    tokenSecret: required('SESSION_SECRET'),
    webOrigin: required('WEB_ORIGIN'),
  });
  console.log('Owner created. Open this single-use setup link to choose a password:');
  console.log(link.url);
  console.log(`It expires at ${link.expiresAt.toISOString()}.`);
} catch (error) {
  if (!(error instanceof BootstrapError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await close();
}
