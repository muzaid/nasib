// Apply the migrations over a database connection, in order.
//
//   npm i pg
//   node tool/apply-migrations.mjs "postgres://…:5432/postgres?sslmode=require"
//
// This exists because of one specific failure. Some query consoles —
// Vercel's database tab among them — send whatever you paste as a
// *prepared statement*, and PostgreSQL refuses to prepare more than one
// command at a time:
//
//     cannot insert multiple commands into a prepared statement
//
// That is not a problem with the SQL. It is the console. Supabase's own
// SQL editor has no such limit and is the easier path; this is for when
// that is not available, or when you would rather it were repeatable.
//
// Each file runs in its own transaction over the *simple* query protocol
// — node-postgres uses it whenever a query is passed without parameters,
// and it is the protocol that has always allowed several commands in one
// message.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let Client;
try {
  ({ Client } = require("pg"));
} catch {
  console.error("This needs the postgres driver:  npm i pg");
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "supabase", "migrations");

const target = process.argv[2]
  || process.env.DATABASE_URL
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.POSTGRES_URL;

if (!target) {
  console.error(`Usage: node tool/apply-migrations.mjs "<connection string>"

Use the NON-POOLING one. Supabase gives you several:

  POSTGRES_URL_NON_POOLING   port 5432 — use this
  POSTGRES_URL / _PRISMA_URL port 6543, pgbouncer in transaction mode

Transaction pooling reuses one backend connection per statement, which
breaks anything that spans statements — and a migration is exactly that.
`);
  process.exit(2);
}

if (/:6543|pgbouncer=true/.test(target)) {
  console.error(`
That is the pooled connection (port 6543, pgbouncer). Migrations need the
direct one — POSTGRES_URL_NON_POOLING, port 5432. Transaction pooling
hands each statement a different backend, so a transaction spanning
several statements does not hold.
`);
  process.exit(2);
}

const local = /@(localhost|127\.0\.0\.1)|^postgres(ql)?:\/\/\//.test(target) || target.startsWith("/");
const caPath = process.env.PGSSLROOTCERT;

const client = new Client({
  connectionString: target,
  ssl: local ? false : {
    // Verification stays on. A migration run carries the whole schema and
    // the credentials to write it; accepting an unverified certificate to
    // make a connection error go away is how that ends up somewhere else.
    // If the handshake fails, fetch Supabase's CA from the dashboard
    // (Settings → Database → SSL configuration) and point PGSSLROOTCERT
    // at it rather than turning this off.
    rejectUnauthorized: true,
    ...(caPath && existsSync(caPath) ? { ca: readFileSync(caPath, "utf8") } : {}),
  },
});

// `--from 0009` resumes a run that stopped partway. There is no
// migrations table here — Supabase's CLI owns that, and inventing a
// second one that disagrees with it is worse than a flag.
const fromIndex = process.argv.indexOf("--from");
const from = fromIndex > -1 ? process.argv[fromIndex + 1] : "";

const all = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const files = from ? all.filter((f) => f >= from) : all;

if (from && files.length === 0) {
  console.error(`No migration at or after "${from}". They are: ${all.join(", ")}`);
  process.exit(2);
}

try {
  await client.connect();
} catch (error) {
  console.error(`\nCould not connect: ${error.message}\n`);
  if (/self.signed|unable to verify/i.test(error.message)) {
    console.error("Download the CA certificate from Settings → Database → SSL");
    console.error("configuration, then set PGSSLROOTCERT to its path.\n");
  } else if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(error.message)) {
    console.error("Port 5432 is usually what a corporate network blocks. If this is");
    console.error("a work machine, use Supabase's SQL editor in the browser instead.\n");
  }
  process.exit(1);
}

console.log(`connected — applying ${files.length} migrations\n`);

let applied = 0;
for (const file of files) {
  const sql = readFileSync(join(dir, file), "utf8");
  process.stdout.write(`  ${file} … `);
  try {
    // One transaction per file, so a failure leaves that migration
    // entirely unapplied rather than half-applied. The ones before it
    // stay, which is what you want: re-running picks up where it stopped.
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    applied += 1;
    console.log("ok");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`\n${error.message}`);
    if (error.position) console.error(`at character ${error.position}`);

    // Be exact about what to do next. These migrations are NOT safe to
    // repeat — `create table` and `create type` fail outright on a second
    // run — so "fix it and run it again" would send you into a second,
    // more confusing error.
    if (/already exists/.test(error.message)) {
      console.error(`
This database already has part of the schema. The migrations are not
written to be re-runnable: create table and create type fail on a second
pass, which is what you just saw.

Either resume after the ones that are already in:

    node tool/apply-migrations.mjs "<url>" --from ${file}

or start from an empty schema, which on a project with no data in it yet
is the cleaner option:

    drop schema public cascade; create schema public;
    grant usage on schema public to anon, authenticated, service_role;
`);
    } else {
      console.error(`
${applied} migration(s) applied before this one, and they are still in.
Fix the cause, then resume from here rather than from the beginning:

    node tool/apply-migrations.mjs "<url>" --from ${file}
`);
    }
    await client.end();
    process.exit(1);
  }
}

const { rows } = await client.query(
  "select count(*)::int as tables from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
);
console.log(`\nall ${applied} applied — ${rows[0].tables} tables in public\n`);
await client.end();
