const mysql = require('mysql2/promise');

function decodeCertificate(value) {
  return String(value).replace(/\\n/g, '\n');
}

function buildSslConfig(env = process.env) {
  if (String(env.DB_SSL || '').toLowerCase() !== 'true') {
    return undefined;
  }

  if (!env.DB_SSL_CA) {
    throw new Error('DB_SSL=true requires DB_SSL_CA to be set');
  }

  return {
    ca: decodeCertificate(env.DB_SSL_CA),
    rejectUnauthorized: true,
  };
}

function buildPoolConfig(env = process.env) {
  const ssl = buildSslConfig(env);

  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'foodflow',
    ...(ssl ? { ssl } : {}),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    connectTimeout: 10000,
  };
}

// A pooled connection is used instead of a single connection so the API
// can serve concurrent requests without waiting on one connection to free up.
const pool = mysql.createPool(buildPoolConfig());

async function checkDbConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  checkDbConnection,
  buildSslConfig,
  buildPoolConfig,
  decodeCertificate,
};
