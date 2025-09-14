import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const dir = join(process.cwd(), 'src', 'db', 'migrations');
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const f of files) {
      const p = join(dir, f);
      const sql = readFileSync(p, 'utf-8');
      console.log(`Running migration: ${f}`);
      await client.query(sql);
    }
    console.log('Migrations completed');
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

