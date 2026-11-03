require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildPoolConfig } = require('../src/config/db');

const SEED_FILE = path.join(__dirname, '..', 'seeds', 'dev_seed.sql');

async function runSeed() {
  const connection = await mysql.createConnection({
    ...buildPoolConfig(),
    multipleStatements: true,
  });

  try {
    const [[vendorCount]] = await connection.query('SELECT COUNT(*) AS count FROM vendors');

    if (Number(vendorCount.count) > 0) {
      console.log('skipped: vendors not empty');
      return;
    }

    const sql = await fs.readFile(SEED_FILE, 'utf8');
    await connection.query(sql);
    console.log('seeded: dev_seed.sql');
  } catch (err) {
    // Never echo connection settings or SQL values.
    console.error(`failed to seed (${err.code || 'error'})`);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

runSeed().catch((err) => {
  console.error(`failed to seed (${err.code || 'error'})`);
  process.exitCode = 1;
});
