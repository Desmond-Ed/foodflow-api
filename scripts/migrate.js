require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildPoolConfig } = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  // multipleStatements is enabled only on this short-lived runner connection;
  // the application pool never enables it.
  const connection = await mysql.createConnection({
    ...buildPoolConfig(),
    multipleStatements: true,
  });

  let currentFile = null;

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    const [rows] = await connection.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.filename));

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`skipped ${filename}`);
        continue;
      }

      currentFile = filename;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [
        filename,
      ]);
      console.log(`applied ${filename}`);
    }
  } catch (err) {
    // Never echo connection settings or SQL values; a filename and MySQL
    // error code are enough to identify the failed migration safely.
    const location = currentFile ? `failed ${currentFile}` : 'failed before applying migrations';
    console.error(`${location} (${err.code || 'error'})`);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

runMigrations().catch((err) => {
  console.error(`failed to run migrations (${err.code || 'error'})`);
  process.exitCode = 1;
});
