require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);
const port = Number(process.env.PORT || 3000);
const DEFAULT_USER_ID = Number(process.env.DEFAULT_USER_ID || 1);
const SESSION_SECRET = process.env.SESSION_SECRET || 'secreto_ipsasel';
const AUTH_COOKIE_NAME = 'ipsasel_auth';
const AUTH_COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 8 * 60 * 60 * 1000);
const APP_ADMIN_USERNAME = process.env.APP_ADMIN_USERNAME || '';
const APP_ADMIN_PASSWORD_HASH = process.env.APP_ADMIN_PASSWORD_HASH || '';
const APP_ADMIN_NAME = process.env.APP_ADMIN_NAME || 'Administrador INPSASEL';
const DB_CONNECTION_TIMEOUT_MS = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
const DB_QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 10000);

function applyCorsHeaders(req, res) {
  const requestOrigin = req.headers.origin;

  res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

// Configuración de la base de datos PostgreSQL
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || '';
const databaseHost = process.env.DB_HOST || '';
let useSsl;
if (typeof process.env.DB_SSL !== 'undefined') {
  useSsl = process.env.DB_SSL === 'true';
} else if (databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const hostFromUrl = parsed.hostname || '';
    useSsl = !(hostFromUrl === 'localhost' || hostFromUrl === '127.0.0.1' || hostFromUrl === '');
  } catch (err) {
    useSsl = Boolean(databaseHost) && databaseHost !== '127.0.0.1' && databaseHost !== 'localhost';
  }
} else {
  useSsl = Boolean(databaseHost) && databaseHost !== '127.0.0.1' && databaseHost !== 'localhost';
}

const pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
  })
  : new Pool({
    user: process.env.DB_USER || process.env.PGUSER || 'tu_usuario',
    host: databaseHost || process.env.PGHOST || '127.0.0.1',
    database: process.env.DB_NAME || process.env.PGDATABASE || 'ipsasel_db',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'tu_password',
    port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
  });

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err && err.message ? err.message : err);
});

function logStartupDbError(err) {
  const dbHost = databaseUrl ? '(connection string)' : (process.env.DB_HOST || '127.0.0.1');
  const dbPort = Number(process.env.DB_PORT || 5432);

  if (err && err.code === 'ECONNREFUSED') {
    console.error('No se pudo conectar a PostgreSQL.');
    console.error(`Intento de conexión: ${dbHost}:${dbPort}`);
    console.error('Verifique que el servicio de PostgreSQL esté iniciado y escuchando en ese host/puerto.');
    console.error('Si está en Windows, puede iniciarlo desde una consola con permisos de administrador.');
    return;
  }

  console.error('No se pudo iniciar el servidor:', err);
}

const ALLOWED_TIPOS = ['Técnica', 'Comercial', 'Soporte', 'Inspección', 'Personal', 'Administrativa'];
const ALLOWED_ESTATUS = ['Planificada', 'En Curso', 'Completada', 'Revisada', 'Cancelada', 'No Programada', 'Emergencia'];
const ALLOWED_TIPO_CONTACTO = ['Individual', 'Empresa', 'Organización'];
let supportsSplitContactFields = false;
let detectColumnsPromise = null;

async function detectContactColumns() {
  try {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'contactos'
        AND column_name IN ('nombre_completo', 'entidad')
    `);

    const names = new Set(result.rows.map((row) => row.column_name));
    supportsSplitContactFields = names.has('nombre_completo') && names.has('entidad');
  } catch (err) {
    console.warn('Advertencia: no se pudo detectar columnas de contactos. Se asumirá modo legacy.');
    console.warn('Detalles:', err && err.message ? err.message : err);
    console.warn('Verifique DB_HOST, DB_USER, DB_PASSWORD y que la base de datos esté accesible.');
    supportsSplitContactFields = false;
  }
}

function contactSelectSql(alias = 'c') {
  if (supportsSplitContactFields) {
    return `${alias}.nombre_completo, ${alias}.entidad, COALESCE(NULLIF(${alias}.entidad, ''), NULLIF(${alias}.nombre_completo, ''), ${alias}.nombre_entidad) AS nombre_entidad`;
  }
  return `NULL::varchar AS nombre_completo, NULL::varchar AS entidad, ${alias}.nombre_entidad AS nombre_entidad`;
}

function contactSearchSql(alias = 'c') {
  if (supportsSplitContactFields) {
    return `COALESCE(${alias}.nombre_completo, '') ILIKE $1 OR COALESCE(${alias}.entidad, '') ILIKE $1 OR COALESCE(${alias}.nombre_entidad, '') ILIKE $1`;
  }
  return `COALESCE(${alias}.nombre_entidad, '') ILIKE $1`;
}

async function ensureContactColumns() {
  if (!detectColumnsPromise) {
    detectColumnsPromise = detectContactColumns().catch((err) => {
      console.error('Error inicializando columnas de contacto (continua en modo legacy):', err && err.message ? err.message : err);
      supportsSplitContactFields = false;
      // swallow the error so that the serverless function can continue operating
    });
  }
  return detectColumnsPromise;
}

function normalizeContactData(body) {
  const tipoContacto = (body.tipo_contacto || '').trim();
  const legacyNombreEntidad = (body.nombre_entidad || '').trim();
  let nombreCompleto = (body.nombre_completo || '').trim();
  let entidad = (body.entidad || '').trim();

  if (!nombreCompleto && tipoContacto === 'Individual') {
    nombreCompleto = legacyNombreEntidad;
  }

  if (!entidad && tipoContacto && tipoContacto !== 'Individual') {
    entidad = legacyNombreEntidad;
  }

  const nombreEntidad = entidad || nombreCompleto || legacyNombreEntidad;
  return {
    nombre_completo: nombreCompleto,
    entidad,
    nombre_entidad: nombreEntidad,
  };
}

function validateVisitBody(body) {
  const errors = [];
  const { fecha, hora, tipo_visita, estatus, cedula_rif, nombre_entidad, telefono, tipo_contacto } = body;
  const contactData = normalizeContactData(body);

  if (!fecha) errors.push('Fecha es obligatoria.');
  if (!hora) errors.push('Hora es obligatoria.');
  if (!tipo_visita) errors.push('Tipo de visita es obligatorio.');
  if (tipo_visita && !ALLOWED_TIPOS.includes(tipo_visita)) errors.push(`Tipo de visita inválido. Valores válidos: ${ALLOWED_TIPOS.join(', ')}.`);
  if (!estatus) errors.push('Estatus es obligatorio.');
  if (estatus && !ALLOWED_ESTATUS.includes(estatus)) errors.push(`Estatus inválido. Valores válidos: ${ALLOWED_ESTATUS.join(', ')}.`);
  if (!cedula_rif) errors.push('Cédula o RIF es obligatorio.');
  if (!contactData.nombre_completo && !contactData.entidad && !nombre_entidad) {
    errors.push('Debe indicar Nombre completo o Entidad.');
  }
  if (tipo_contacto === 'Individual' && !contactData.nombre_completo) {
    errors.push('Nombre completo es obligatorio para tipo de contacto Individual.');
  }
  if (tipo_contacto && tipo_contacto !== 'Individual' && !contactData.entidad) {
    errors.push('Entidad es obligatoria para tipo de contacto Empresa u Organización.');
  }
  if (!telefono) errors.push('Teléfono es obligatorio.');
  if (!tipo_contacto) errors.push('Tipo de contacto es obligatorio.');
  if (tipo_contacto && !ALLOWED_TIPO_CONTACTO.includes(tipo_contacto)) errors.push(`Tipo de contacto inválido. Valores válidos: ${ALLOWED_TIPO_CONTACTO.join(', ')}.`);

  if (fecha && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha)) errors.push('Formato de fecha inválido. Use AAAA-MM-DD.');
  // Accept hours with or without leading zero, optional seconds, and valid ranges.
  const horaVal = typeof hora === 'string' ? hora.trim() : (hora || '');
  if (hora && !/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(horaVal)) errors.push('Formato de hora inválido. Use HH:MM.');
  if (telefono && telefono.length < 7) errors.push('Teléfono parece demasiado corto.');

  return errors;
}

// Middleware
app.use((req, res, next) => {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  },
}));
app.use((req, res, next) => {
  if (isPublicRequest(req)) {
    return next();
  }

  return requireAuth(req, res, next);
});
app.use(express.static(path.join(__dirname), { index: false }));

app.get('/style.css', (req, res) => {
  res.type('text/css').send(loadTextAsset('style.css', 'body { font-family: sans-serif; }'));
});

app.get('/menu_style.css', (req, res) => {
  res.type('text/css').send(loadTextAsset('menu_style.css', 'body { font-family: sans-serif; }'));
});
const LOGIN_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inicio de sesion - INPSASEL</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(180deg, #f8fafc 0%, #dbeafe 100%);
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-shell { width: min(100%, 460px); }
    .login-panel {
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 24px;
      box-shadow: 0 32px 80px rgba(15, 23, 42, 0.12);
      padding: 34px;
    }
    .login-brand {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 16px;
      align-items: center;
      margin-bottom: 18px;
    }
    .login-logo {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      object-fit: cover;
    }
    .login-eyebrow {
      margin: 0 0 6px;
      color: #0369a1;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 1.55rem; line-height: 1.2; }
    .login-copy { margin: 0 0 22px; color: #475569; line-height: 1.6; }
    .login-form { display: grid; gap: 18px; }
    .form-group { display: flex; flex-direction: column; }
    label { font-weight: 700; margin-bottom: 10px; color: #344054; }
    input {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 16px;
      background: white;
      font-size: 1rem;
      color: #0f172a;
    }
    input:focus {
      border-color: #2563eb;
      outline: none;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
    }
    .btn-submit {
      padding: 16px;
      border: none;
      border-radius: 20px;
      font-size: 1.05rem;
      font-weight: 700;
      color: white;
      background: linear-gradient(135deg, #2563eb, #06b6d4);
      cursor: pointer;
      box-shadow: 0 18px 35px rgba(37, 99, 235, 0.18);
    }
    .login-message {
      margin-bottom: 18px;
      padding: 12px 14px;
      border-radius: 14px;
      font-weight: 700;
      line-height: 1.4;
    }
    .login-message.error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
    .login-message.success {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #166534;
    }
  </style>
</head>
<body>
  <main class="login-shell">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-brand">
        <img src="https://tse3.mm.bing.net/th/id/OIP.EM3DltdiNLHzZh23cV-MYQHaHa?rs=1&pid=ImgDetMain&o=7&rm=3" alt="Logo INPSASEL" class="login-logo">
        <div>
          <p class="login-eyebrow">Acceso privado</p>
          <h1 id="login-title">Sistema de Registro de Visitas</h1>
        </div>
      </div>
      <p class="login-copy">Ingrese con el usuario autorizado para continuar.</p>
      <div id="login-message" class="login-message" hidden></div>
      <form class="login-form" action="/login" method="POST">
        <input type="hidden" id="next" name="next" value="/menu">
        <div class="form-group">
          <label for="username">Usuario</label>
          <input type="text" id="username" name="username" autocomplete="username" required autofocus>
        </div>
        <div class="form-group">
          <label for="password">Contrasena</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn-submit">Iniciar sesion</button>
      </form>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const error = params.get('error');
    const loggedOut = params.get('logged_out');
    const message = document.getElementById('login-message');
    const nextInput = document.getElementById('next');
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) {
      nextInput.value = next;
    }
    if (error) {
      message.textContent = error;
      message.classList.add('error');
      message.hidden = false;
    } else if (loggedOut) {
      message.textContent = 'Sesion cerrada correctamente.';
      message.classList.add('success');
      message.hidden = false;
    }
  </script>
</body>
</html>`;

const HTML_PAGES = {
  'login.html': LOGIN_FALLBACK_HTML,
  'menu_index.html': '<!doctype html><html><head><meta charset="utf-8"><title>INPSASEL</title></head><body><h1>INPSASEL</h1></body></html>',
  'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Registro</title></head><body><h1>Registro de visita</h1></body></html>',
  'modify_visit.html': '<!doctype html><html><head><meta charset="utf-8"><title>Modificar</title></head><body><h1>Modificar visita</h1></body></html>',
  'delete_visit.html': '<!doctype html><html><head><meta charset="utf-8"><title>Eliminar</title></head><body><h1>Eliminar visita</h1></body></html>',
  'success.html': '<!doctype html><html><head><meta charset="utf-8"><title>Éxito</title></head><body><h1>Operación exitosa</h1></body></html>',
  'visitas_del_dia.html': '<!doctype html><html><head><meta charset="utf-8"><title>Visitas del día</title></head><body><h1>Visitas del día</h1></body></html>',
  '2index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Inicio</title></head><body><h1>Inicio</h1></body></html>',
};

const assetPathCache = new Map();

function findAssetPath(rootDir, fileName, depth = 0) {
  if (!rootDir || depth > 4) {
    return null;
  }

  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (err) {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || ['.git', '.vercel', 'node_modules'].includes(entry.name)) {
      continue;
    }

    const foundPath = findAssetPath(path.join(rootDir, entry.name), fileName, depth + 1);
    if (foundPath) {
      return foundPath;
    }
  }

  return null;
}

function resolveAssetPath(fileName) {
  if (assetPathCache.has(fileName)) {
    return assetPathCache.get(fileName);
  }

  const candidatePaths = [
    path.join(__dirname, fileName),
    path.join(__dirname, 'api', fileName),
    path.join(process.cwd(), fileName),
    path.join(process.cwd(), 'api', fileName),
    path.join(__dirname, '..', fileName),
  ];

  const directPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  const resolvedPath = directPath
    || findAssetPath(process.cwd(), fileName)
    || findAssetPath(__dirname, fileName)
    || candidatePaths[0];

  assetPathCache.set(fileName, resolvedPath);
  return resolvedPath;
}

function loadHtmlPage(fileName) {
  const filePath = resolveAssetPath(fileName);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`No se pudo leer ${fileName}; se usará una versión mínima embebida.`);
    return HTML_PAGES[fileName] || '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  }
}

function loadTextAsset(fileName, fallbackContent) {
  const filePath = resolveAssetPath(fileName);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`No se pudo leer ${fileName}; se usará un fallback embebido.`);
    return fallbackContent;
  }
}

function sendStaticHtml(res, fileName) {
  res.type('html').send(loadHtmlPage(fileName));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

function signAuthPayload(payload) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
}

function createAuthCookieValue(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: user.id_usuario,
    username: user.username,
    exp: Date.now() + AUTH_COOKIE_MAX_AGE_MS,
  })).toString('base64url');

  return `${payload}.${signAuthPayload(payload)}`;
}

function verifyAuthCookie(req) {
  const rawCookie = parseCookies(req)[AUTH_COOKIE_NAME];
  if (!rawCookie) {
    return null;
  }

  const [payload, signature] = rawCookie.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signAuthPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp || !data.userId) {
      return null;
    }

    return {
      userId: Number(data.userId),
      username: String(data.username || ''),
    };
  } catch (err) {
    return null;
  }
}

function setAuthCookie(res, user) {
  res.cookie(AUTH_COOKIE_NAME, createAuthCookieValue(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    path: '/',
  });
}

function getAuthenticatedUser(req) {
  if (req.session && req.session.isAuthenticated) {
    return {
      userId: Number(req.session.userId || DEFAULT_USER_ID),
      username: req.session.username || '',
    };
  }

  const cookieUser = verifyAuthCookie(req);
  if (!cookieUser) {
    return null;
  }

  if (req.session) {
    req.session.isAuthenticated = true;
    req.session.userId = cookieUser.userId;
    req.session.username = cookieUser.username;
  }

  return cookieUser;
}

function wantsJsonResponse(req) {
  const acceptHeader = req.headers.accept || '';
  return req.path.startsWith('/api') || acceptHeader.includes('application/json');
}

function sanitizeRedirect(target) {
  if (!target || typeof target !== 'string') {
    return '/menu';
  }

  if (!target.startsWith('/') || target.startsWith('//') || target === '/' || target.startsWith('/login')) {
    return '/menu';
  }

  return target;
}

function loginRedirectUrl(req) {
  if (!req.originalUrl || req.originalUrl === '/' || req.originalUrl.startsWith('/login')) {
    return '/login';
  }

  return `/login?next=${encodeURIComponent(req.originalUrl)}`;
}

function requireAuth(req, res, next) {
  const authUser = getAuthenticatedUser(req);
  if (authUser) {
    req.authUser = authUser;
    return next();
  }

  if (wantsJsonResponse(req)) {
    return res.status(401).json({
      success: false,
      message: 'Sesion expirada. Inicie sesion nuevamente.',
    });
  }

  return res.redirect(303, loginRedirectUrl(req));
}

function isPublicAsset(pathname) {
  return /\.(css|png|jpe?g|gif|svg|ico|webp)$/i.test(pathname);
}

function isPublicRequest(req) {
  if (req.method === 'OPTIONS') {
    return true;
  }

  if (req.method === 'GET' && (req.path === '/' || req.path === '/login' || req.path === '/login.html')) {
    return true;
  }

  if (req.method === 'POST' && req.path === '/login') {
    return true;
  }

  return req.method === 'GET' && isPublicAsset(req.path);
}

function hasConfiguredDatabase() {
  if (!databaseUrl && process.env.VERCEL && ['127.0.0.1', 'localhost'].includes(databaseHost)) {
    return false;
  }

  return Boolean(
    databaseUrl ||
    process.env.DB_USER ||
    process.env.DB_HOST ||
    process.env.DB_NAME ||
    process.env.DB_PASSWORD ||
    process.env.PGUSER ||
    process.env.PGHOST ||
    process.env.PGDATABASE ||
    process.env.PGPASSWORD
  );
}

async function authenticateConfiguredAdmin(username, password) {
  if (!APP_ADMIN_USERNAME || !APP_ADMIN_PASSWORD_HASH || username !== APP_ADMIN_USERNAME) {
    return null;
  }

  const match = await bcrypt.compare(password, APP_ADMIN_PASSWORD_HASH);
  if (!match) {
    return null;
  }

  if (!hasConfiguredDatabase()) {
    return {
      id_usuario: DEFAULT_USER_ID,
      username: APP_ADMIN_USERNAME,
    };
  }

  try {
    const roleResult = await pool.query(
      `INSERT INTO ROLES (nombre_rol)
       VALUES ($1)
       ON CONFLICT (nombre_rol) DO UPDATE SET nombre_rol = EXCLUDED.nombre_rol
       RETURNING id_rol`,
      ['Admin']
    );

    const userResult = await pool.query(
      `INSERT INTO USUARIOS (id_rol, nombre_completo, username, password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE SET
         id_rol = EXCLUDED.id_rol,
         nombre_completo = EXCLUDED.nombre_completo,
         password = EXCLUDED.password
       RETURNING id_usuario, username`,
      [roleResult.rows[0].id_rol, APP_ADMIN_NAME, APP_ADMIN_USERNAME, APP_ADMIN_PASSWORD_HASH]
    );

    return userResult.rows[0];
  } catch (err) {
    console.warn('No se pudo sincronizar el usuario administrador en PostgreSQL:', err && err.message ? err.message : err);
    return {
      id_usuario: DEFAULT_USER_ID,
      username: APP_ADMIN_USERNAME,
    };
  }
}

function establishLoginSession(req, res, user, redirectTo) {
  req.session.isAuthenticated = true;
  req.session.userId = user.id_usuario;
  req.session.username = user.username;
  setAuthCookie(res, user);
  return res.redirect(303, redirectTo);
}

// Rutas
app.get('/', (req, res) => {
  if (getAuthenticatedUser(req)) {
    return res.redirect('/menu');
  }

  return sendStaticHtml(res, 'login.html');
});

app.get('/login', (req, res) => {
  if (getAuthenticatedUser(req)) {
    return res.redirect('/menu');
  }

  return sendStaticHtml(res, 'login.html');
});

app.get('/register-visit', (req, res) => {
  sendStaticHtml(res, 'index.html');
});

app.get('/modify-visit', (req, res) => {
  sendStaticHtml(res, 'modify_visit.html');
});

app.get('/delete-visit', (req, res) => {
  sendStaticHtml(res, 'delete_visit.html');
});

app.post('/delete-visit', async (req, res) => {
  const { codigo_visita } = req.body;
  if (!codigo_visita) {
    return res.status(400).send(`
      <script>
        alert('Debe indicar el código de visita.');
        window.location.href = '/delete-visit';
      </script>
    `);
  }

  try {
    const result = await pool.query(
      'DELETE FROM VISITAS WHERE codigo_visita = $1 RETURNING *',
      [codigo_visita]
    );

    if (result.rowCount > 0) {
      return res.send(`
        <script>
          alert('Visita ${codigo_visita} eliminada con éxito.');
          window.location.href = '/menu';
        </script>
      `);
    }

    return res.send(`
      <script>
        alert('No se encontró ninguna visita con el código: ${codigo_visita}');
        window.location.href = '/delete-visit';
      </script>
    `);
  } catch (err) {
    console.error(err);
    return res.status(500).send(`
      <script>
        alert('Error interno al intentar eliminar el registro.');
        window.location.href = '/delete-visit';
      </script>
    `);
  }
});

app.get('/menu', (req, res) => {
  sendStaticHtml(res, 'menu_index.html');
});

app.get('/2index', (req, res) => {
  sendStaticHtml(res, '2index.html');
});

app.get('/success', (req, res) => {
  sendStaticHtml(res, 'success.html');
});

app.get('/visitas-del-dia', (req, res) => {
  sendStaticHtml(res, 'visitas_del_dia.html');
});

// Inicializar detección de columnas sólo en rutas que usan base de datos
async function requireContactColumns(req, res, next) {
  try {
    await ensureContactColumns();
    next();
  } catch (err) {
    next(err);
  }
}

// Ruta para registrar visita
app.post('/register-visit', requireContactColumns, async (req, res) => {
  const {
    fecha,
    hora,
    tipo_visita,
    estatus,
    cedula_rif,
    nombre_completo,
    entidad,
    nombre_entidad,
    telefono,
    tipo_contacto,
    codigo_ot,
    detalle_ot
  } = req.body;
  const contactData = normalizeContactData({ nombre_completo, entidad, nombre_entidad, tipo_contacto });

  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  const errors = validateVisitBody(req.body);

  if (errors.length > 0) {
    const message = `Errores de validación: ${errors.join(' ')}`;
    return wantsJson
      ? res.status(400).json({ success: false, message, errors })
      : res.status(400).send(message);
  }

  try {
    // Insertar o actualizar contacto
    let contactoResult = await pool.query(
      'SELECT id_contacto FROM CONTACTOS WHERE cedula_rif = $1',
      [cedula_rif]
    );

    let id_contacto;
    if (contactoResult.rows.length > 0) {
      id_contacto = contactoResult.rows[0].id_contacto;
      if (supportsSplitContactFields) {
        await pool.query(
          'UPDATE CONTACTOS SET nombre_completo = $1, entidad = $2, nombre_entidad = $3, telefono = $4, tipo_contacto = $5 WHERE id_contacto = $6',
          [contactData.nombre_completo || null, contactData.entidad || null, contactData.nombre_entidad, telefono, tipo_contacto, id_contacto]
        );
      } else {
        await pool.query(
          'UPDATE CONTACTOS SET nombre_entidad = $1, telefono = $2, tipo_contacto = $3 WHERE id_contacto = $4',
          [contactData.nombre_entidad, telefono, tipo_contacto, id_contacto]
        );
      }
    } else {
      const insertContacto = supportsSplitContactFields
        ? await pool.query(
          'INSERT INTO CONTACTOS (cedula_rif, nombre_completo, entidad, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_contacto',
          [cedula_rif, contactData.nombre_completo || null, contactData.entidad || null, contactData.nombre_entidad, telefono, tipo_contacto]
        )
        : await pool.query(
          'INSERT INTO CONTACTOS (cedula_rif, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4) RETURNING id_contacto',
          [cedula_rif, contactData.nombre_entidad, telefono, tipo_contacto]
        );
      id_contacto = insertContacto.rows[0].id_contacto;
    }

    // Insertar orden de trabajo si se proporciona
    let id_orden = null;
    if (codigo_ot) {
      const ordenResult = await pool.query(
        'INSERT INTO ORDENES_TRABAJO (codigo_ot, detalle) VALUES ($1, $2) ON CONFLICT (codigo_ot) DO UPDATE SET detalle = EXCLUDED.detalle RETURNING id_orden',
        [codigo_ot, detalle_ot || '']
      );
      id_orden = ordenResult.rows[0].id_orden;
    }

    const codigo_visita = `VIS-${Date.now()}`;
    const authUser = getAuthenticatedUser(req);
    const id_usuario = authUser ? authUser.userId : (req.session.userId || DEFAULT_USER_ID);

    const userCheck = await pool.query('SELECT id_usuario FROM USUARIOS WHERE id_usuario = $1', [id_usuario]);
    if (userCheck.rows.length === 0) {
      const message = `Error: el usuario predeterminado con id ${id_usuario} no existe. Configura DEFAULT_USER_ID en .env o inicia sesión.`;
      return wantsJson
        ? res.status(400).json({ success: false, message })
        : res.status(400).send(message);
    }

    await pool.query(
      'INSERT INTO VISITAS (codigo_visita, fecha, hora, tipo_visita, estatus, id_contacto, id_usuario, id_orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [codigo_visita, fecha, hora, tipo_visita, estatus, id_contacto, id_usuario, id_orden]
    );

    const message = `Visita registrada exitosamente. Código: ${codigo_visita}`;
    if (wantsJson) {
      return res.json({ success: true, message, codigo_visita });
    }

    return res.redirect(303, `/success?code=${encodeURIComponent(codigo_visita)}`);
  } catch (err) {
    console.error(err);
    const message = `Error al registrar la visita: ${err.message}`;
    return wantsJson
      ? res.status(500).json({ success: false, message })
      : res.status(500).send(message);
  }
});

// API para buscar visitas por código o datos parciales
app.get('/api/visitas', requireContactColumns, async (req, res) => {
  const { codigo_visita } = req.query;
  if (!codigo_visita) {
    return res.status(400).json({ success: false, message: 'Código de visita requerido' });
  }

  try {
    const searchTerm = `%${codigo_visita.trim()}%`;
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             ${contactSelectSql('c')},
             c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      WHERE v.codigo_visita ILIKE $1
         OR c.cedula_rif ILIKE $1
         OR ${contactSearchSql('c')}
      ORDER BY v.fecha DESC, v.hora DESC
      LIMIT 20
    `, [searchTerm]);

    res.json({ success: true, visits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error al buscar visitas' });
  }
});

// Listar visitas recientes
app.get('/visitas', requireContactColumns, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             ${contactSelectSql('c')},
             c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      ORDER BY v.fecha DESC, v.hora DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener visitas');
  }
});

// Listar visitas de la fecha actual
app.get('/api/visitas-del-dia', requireContactColumns, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             ${contactSelectSql('c')},
             c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      WHERE v.fecha = CURRENT_DATE
      ORDER BY v.hora DESC
    `);

    res.json({ success: true, visits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error al obtener visitas del día' });
  }
});

// Listar visitas por fecha puntual (AAAA-MM-DD)
app.get('/api/visitas-por-fecha', requireContactColumns, async (req, res) => {
  const { fecha } = req.query;

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({
      success: false,
      message: 'Parámetro fecha inválido. Use formato AAAA-MM-DD.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             ${contactSelectSql('c')},
             c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      WHERE v.fecha = $1::date
      ORDER BY v.hora ASC
    `, [fecha]);

    return res.json({ success: true, visits: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error al obtener visitas por fecha' });
  }
});

function isPostgresAuthError(err) {
  return err && err.code === '28P01';
}

// Eventos para FullCalendar
app.get('/api/visitas-calendario-resumen', requireContactColumns, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(v.fecha, 'YYYY-MM-DD') AS fecha,
        COUNT(*)::int AS total
      FROM VISITAS v
      GROUP BY v.fecha
      ORDER BY v.fecha ASC
    `);

    return res.json({ success: true, dates: result.rows });
  } catch (err) {
    console.error('Error al obtener el resumen del calendario:', err && err.message ? err.message : err);
    return res.json({ success: false, dates: [] });
  }
});

app.get('/api/visitas-eventos', requireContactColumns, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             TO_CHAR(v.fecha, 'YYYY-MM-DD') AS fecha_iso,
             TO_CHAR(v.hora, 'HH24:MI:SS') AS hora_iso,
            ${contactSelectSql('c')},
             c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      ORDER BY v.fecha ASC, v.hora ASC
      LIMIT 1000
    `);

    const events = result.rows.map((visit) => {
      const datePart = visit.fecha_iso;
      const timePart = visit.hora_iso || '00:00:00';

      return {
        id: visit.codigo_visita,
        title: `${visit.tipo_visita} - ${visit.nombre_entidad || 'Sin entidad'}`,
        start: `${datePart}T${timePart}`,
        allDay: false,
        extendedProps: {
          codigo_visita: visit.codigo_visita,
          estatus: visit.estatus,
          cedula_rif: visit.cedula_rif || '',
          nombre_completo: visit.nombre_completo || '',
          entidad: visit.entidad || '',
          nombre_entidad: visit.nombre_entidad || '',
          telefono: visit.telefono || '',
          tipo_contacto: visit.tipo_contacto || '',
          codigo_ot: visit.codigo_ot || '',
          detalle_ot: visit.detalle_ot || '',
          tipo_visita: visit.tipo_visita || '',
          hora: String(visit.hora_iso || '').slice(0, 5),
          fecha: visit.fecha_iso || ''
        }
      };
    });

    return res.json({ success: true, events });
  } catch (err) {
    console.error('Error al obtener eventos de visitas:', err && err.message ? err.message : err);
    if (isPostgresAuthError(err)) {
      return res.json({ success: false, events: [] });
    }
    return res.json({ success: false, events: [] });
  }
});

// Ruta para modificar visita
app.post('/modify-visit', requireContactColumns, async (req, res) => {
  const {
    codigo_visita,
    fecha,
    hora,
    tipo_visita,
    estatus,
    cedula_rif,
    nombre_completo,
    entidad,
    nombre_entidad,
    telefono,
    tipo_contacto,
    codigo_ot,
    detalle_ot
  } = req.body;
  const contactData = normalizeContactData({ nombre_completo, entidad, nombre_entidad, tipo_contacto });

  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  const errors = validateVisitBody(req.body);

  if (!codigo_visita) {
    const message = 'Código de visita es obligatorio para modificar.';
    return wantsJson ? res.status(400).json({ success: false, message }) : res.status(400).send(message);
  }

  if (errors.length > 0) {
    const message = `Errores de validación: ${errors.join(' ')}`;
    return wantsJson
      ? res.status(400).json({ success: false, message, errors })
      : res.status(400).send(message);
  }

  try {
    const visitCheck = await pool.query('SELECT id_orden FROM VISITAS WHERE codigo_visita = $1', [codigo_visita]);
    if (visitCheck.rows.length === 0) {
      const message = `Visita ${codigo_visita} no encontrada.`;
      return wantsJson ? res.status(404).json({ success: false, message }) : res.status(404).send(message);
    }

    let id_orden = visitCheck.rows[0].id_orden;

    // Insertar o actualizar contacto
    let contactoResult = await pool.query(
      'SELECT id_contacto FROM CONTACTOS WHERE cedula_rif = $1',
      [cedula_rif]
    );

    let id_contacto;
    if (contactoResult.rows.length > 0) {
      id_contacto = contactoResult.rows[0].id_contacto;
      if (supportsSplitContactFields) {
        await pool.query(
          'UPDATE CONTACTOS SET nombre_completo = $1, entidad = $2, nombre_entidad = $3, telefono = $4, tipo_contacto = $5 WHERE id_contacto = $6',
          [contactData.nombre_completo || null, contactData.entidad || null, contactData.nombre_entidad, telefono, tipo_contacto, id_contacto]
        );
      } else {
        await pool.query(
          'UPDATE CONTACTOS SET nombre_entidad = $1, telefono = $2, tipo_contacto = $3 WHERE id_contacto = $4',
          [contactData.nombre_entidad, telefono, tipo_contacto, id_contacto]
        );
      }
    } else {
      const insertContacto = supportsSplitContactFields
        ? await pool.query(
          'INSERT INTO CONTACTOS (cedula_rif, nombre_completo, entidad, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_contacto',
          [cedula_rif, contactData.nombre_completo || null, contactData.entidad || null, contactData.nombre_entidad, telefono, tipo_contacto]
        )
        : await pool.query(
          'INSERT INTO CONTACTOS (cedula_rif, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4) RETURNING id_contacto',
          [cedula_rif, contactData.nombre_entidad, telefono, tipo_contacto]
        );
      id_contacto = insertContacto.rows[0].id_contacto;
    }

    if (codigo_ot) {
      const ordenResult = await pool.query(
        'INSERT INTO ORDENES_TRABAJO (codigo_ot, detalle) VALUES ($1, $2) ON CONFLICT (codigo_ot) DO UPDATE SET detalle = EXCLUDED.detalle RETURNING id_orden',
        [codigo_ot, detalle_ot || '']
      );
      id_orden = ordenResult.rows[0].id_orden;
    }

    await pool.query(
      'UPDATE VISITAS SET fecha = $1, hora = $2, tipo_visita = $3, estatus = $4, id_contacto = $5, id_orden = $6 WHERE codigo_visita = $7',
      [fecha, hora, tipo_visita, estatus, id_contacto, id_orden, codigo_visita]
    );

    const message = `Visita ${codigo_visita} actualizada correctamente.`;
    if (wantsJson) {
      return res.json({ success: true, message, codigo_visita });
    }
    return res.redirect(303, `/success?code=${encodeURIComponent(codigo_visita)}`);
  } catch (err) {
    console.error(err);
    const message = `Error al modificar la visita: ${err.message}`;
    return wantsJson
      ? res.status(500).json({ success: false, message })
      : res.status(500).send(message);
  }
});

// Ruta para login
app.post('/login', async (req, res) => {
  const { username, password, next } = req.body;
  const redirectTo = sanitizeRedirect(next);

  if (!username || !password) {
    return res.redirect(303, `/login?error=${encodeURIComponent('Ingrese usuario y contrasena.')}&next=${encodeURIComponent(redirectTo)}`);
  }

  try {
    if (APP_ADMIN_USERNAME && username === APP_ADMIN_USERNAME) {
      const configuredAdmin = await authenticateConfiguredAdmin(username, password);
      if (configuredAdmin) {
        return establishLoginSession(req, res, configuredAdmin, redirectTo);
      }

      return res.redirect(303, `/login?error=${encodeURIComponent('Usuario o contrasena incorrectos.')}&next=${encodeURIComponent(redirectTo)}`);
    }

    const result = await pool.query('SELECT id_usuario, username, password FROM USUARIOS WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        return establishLoginSession(req, res, user, redirectTo);
      }
    }

    return res.redirect(303, `/login?error=${encodeURIComponent('Usuario o contrasena incorrectos.')}&next=${encodeURIComponent(redirectTo)}`);
  } catch (err) {
    console.error(err);
    return res.redirect(303, `/login?error=${encodeURIComponent('No se pudo validar el acceso. Intente nuevamente.')}&next=${encodeURIComponent(redirectTo)}`);
  }
});

app.post('/logout', (req, res) => {
  clearAuthCookie(res);

  if (!req.session) {
    return res.redirect(303, '/login?logged_out=1');
  }

  return req.session.destroy(() => {
    res.redirect(303, '/login?logged_out=1');
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  if (wantsJson) {
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
  return res.status(500).send('Error interno del servidor');
});

// Iniciar servidor
async function startServer() {
  const maxAttempts = 5;
  let currentPort = port;

  async function tryListen(p) {
    return new Promise((resolve, reject) => {
      const server = app.listen(p, () => resolve(server));
      server.on('error', (err) => reject(err));
    });
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const server = await tryListen(currentPort);
      console.log(`Servidor corriendo en http://localhost:${currentPort}`);
      return;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`Puerto ${currentPort} ya está en uso.`);
        if (attempt < maxAttempts - 1) {
          currentPort += 1;
          console.log(`Intentando puerto ${currentPort}...`);
          continue;
        }
        console.error('No se pudo iniciar el servidor: puerto en uso. Usa otra variable PORT o libera el puerto.');
        process.exit(1);
      }

      logStartupDbError(err);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
