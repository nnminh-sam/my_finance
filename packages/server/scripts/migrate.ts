import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "../src/config";
import { serviceErrorDiagnostic } from "../src/service-error";

async function migrate(): Promise<void> {
  const sql = neon(config.databaseUrl);
  const directory = path.resolve(__dirname, "../migrations");
  const files = (await readdir(directory)).filter(file => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]) || a.localeCompare(b));
  if (!files.length) throw new Error("No checked-in migrations found");
  for (const file of files) {
    const migration = await readFile(path.join(directory, file), "utf8");
    // Checked-in migrations contain simple DDL only: no procedural bodies or
    // semicolons inside literals/comments. Each file is atomic and rerunnable.
    const statements = migration.split(";").map(statement => statement.trim()).filter(Boolean);
    await sql.transaction(statements.map(statement => sql.query(statement)));
    console.log(`Migration ${file} applied.`);
  }
}

migrate().catch((error: unknown) => {
  console.error("Database migration failed", serviceErrorDiagnostic(error));
  process.exitCode = 1;
});
