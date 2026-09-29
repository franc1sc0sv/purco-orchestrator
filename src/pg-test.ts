import path from "node:path";
import { openPools } from "./postgres-config.ts";

const PURCO_WEB_ROOT = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/purco-web",
);

const { pools, notes } = await openPools(PURCO_WEB_ROOT);
for (const note of notes) process.stdout.write(`${note}\n`);
process.stdout.write("\n");

const WRITE_ATTEMPTS = [
  "delete from claims",
  "update claims set settled_at = now()",
  "insert into claims (id) values (1)",
  "create table orch_should_not_exist (id int)",
  "select 1; delete from claims",
  "with x as (delete from claims returning id) select * from x",
];

let failures = 0;
const report = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail.slice(0, 150)}` : ""}\n`,
  );
};

for (const [tenant, db] of pools) {
  process.stdout.write(`=== ${tenant} ===\n`);

  const started = Date.now();
  const schemas = await db.read(
    "select current_database() as db, current_user as usr, version() as v",
  );
  const ms = Date.now() - started;
  report(
    schemas.error === undefined,
    `${tenant}: connects and reads (${ms}ms)`,
    schemas.error ?? "",
  );
  if (schemas.output) {
    process.stdout.write(
      `      ${schemas.output.split("\n")[2]?.slice(0, 130) ?? ""}\n`,
    );
  }

  const count = await db.read(
    "select count(*) as tables from information_schema.tables where table_schema = 'public'",
  );
  report(
    count.error === undefined,
    `${tenant}: can introspect`,
    count.error ?? "",
  );
  if (count.output) {
    process.stdout.write(
      `      ${count.output.split("\n")[2] ?? ""} public tables\n`,
    );
  }

  for (const sql of WRITE_ATTEMPTS) {
    const result = await db.read(sql);
    report(
      result.error !== undefined,
      `${tenant}: blocked "${sql.slice(0, 46)}"`,
      result.error === undefined ? "IT WAS ALLOWED" : "",
    );
  }

  const readOnlyProof = await db.read("show transaction_read_only");
  report(
    readOnlyProof.output?.includes("on") === true,
    `${tenant}: session runs in a READ ONLY transaction`,
    readOnlyProof.output?.split("\n")[2] ?? readOnlyProof.error ?? "",
  );

  await db.close();
  process.stdout.write("\n");
}

if (pools.size === 0) {
  process.stdout.write("no pools opened; nothing tested\n");
  process.exit(1);
}
process.stdout.write(
  failures === 0 ? "all checks passed\n" : `${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
