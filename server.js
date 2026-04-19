const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
  user: 'tu_usuario', // Cambia por tu usuario de PostgreSQL
  host: 'localhost',
  database: 'ipsasel_db', // Cambia por el nombre de tu base de datos
  password: 'tu_password', // Cambia por tu contraseña
  port: 5432,
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secreto_ipsasel', // Cambia por un secreto seguro
  resave: false,
  saveUninitialized: true,
}));
app.use(express.static(path.join(__dirname)));

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'menu_index.html'));
});

app.get('/2index', (req, res) => {
  res.sendFile(path.join(__dirname, '2index.html'));
});

// Ruta para registrar visita
app.post('/register-visit', async (req, res) => {
  const {
    fecha,
    hora,
    tipo_visita,
    estatus,
    cedula_rif,
    nombre_entidad,
    telefono,
    tipo_contacto,
    codigo_ot,
    detalle_ot
  } = req.body;

  try {
    // Insertar o actualizar contacto
    let contactoResult = await pool.query(
      'SELECT id_contacto FROM CONTACTOS WHERE cedula_rif = $1',
      [cedula_rif]
    );

    let id_contacto;
    if (contactoResult.rows.length > 0) {
      id_contacto = contactoResult.rows[0].id_contacto;
    } else {
      const insertContacto = await pool.query(
        'INSERT INTO CONTACTOS (cedula_rif, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4) RETURNING id_contacto',
        [cedula_rif, nombre_entidad, telefono, tipo_contacto]
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

    // Generar código de visita único
    const codigo_visita = `VIS-${Date.now()}`;

    // Insertar visita (asumiendo id_usuario = 1 por ahora, cambiar según autenticación)
    const id_usuario = 1; // TODO: Obtener del session
    await pool.query(
      'INSERT INTO VISITAS (codigo_visita, fecha, hora, tipo_visita, estatus, id_contacto, id_usuario, id_orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [codigo_visita, fecha, hora, tipo_visita, estatus, id_contacto, id_usuario, id_orden]
    );

    res.send('Visita registrada exitosamente. Código: ' + codigo_visita);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al registrar la visita');
  }
});

// Ruta para login (básico)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM USUARIOS WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.userId = user.id_usuario;
        res.redirect('/menu');
      } else {
        res.send('Contraseña incorrecta');
      }
    } else {
      res.send('Usuario no encontrado');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error en login');
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});