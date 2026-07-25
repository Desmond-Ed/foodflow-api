const mysql = require('mysql2/promise');

// A pooled connection is used instead of a single connection so the API
// can serve concurrent requests without waiting on one connection to free up.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'foodflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function checkDbConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
}

module.exports = { pool, checkDbConnection };
