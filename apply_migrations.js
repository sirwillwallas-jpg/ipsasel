require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Utilidad simple para aplicar migraciones SQL en orden alfanumerico.
const migrationsDir = path.join(__dirname, 'migrations');

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || '';
const databaseHost = process.env.DB_HOST || '';
let pool;
if (databaseUrl) {
  pool = new Pool({ connectionString: databaseUrl, ssl: false });
} else {
  pool = new Pool({
    user: process.env.DB_USER || process.env.PGUSER || 'tu_usuario',
    host: databaseHost || process.env.PGHOST || '127.0.0.1',
    database: process.env.DB_NAME || process.env.PGDATABASE || 'ipsasel_db',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'tu_password',
    port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  });
}

async function run() {
  // Conecta, recorre migraciones y aplica el esquema secuencialmente.
  console.log('Conectando a la base de datos...');
  try {
    await pool.connect();
  } catch (err) {
    console.error('Error conectando a la DB:', err && err.message ? err.message : err);
    process.exit(1);
  }

  let files;
  try {
    files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  } catch (err) {
    console.error('No se encontró el directorio de migraciones:', migrationsDir);
    process.exit(1);
  }

  files.sort();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    console.log('Ejecutando migración:', file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      await pool.query(sql);
      console.log(' OK');
    } catch (err) {
      console.error('Error ejecutando', file, ':', err && err.message ? err.message : err);
      // continue to next migration in case of IF NOT EXISTS semantics
    }
  }

  console.log('Migraciones finalizadas.');
  process.exit(0);
}

run();
