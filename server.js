require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);
const DEFAULT_USER_ID = Number(process.env.DEFAULT_USER_ID || 1);

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'tu_usuario',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'ipsasel_db',
  password: process.env.DB_PASSWORD || 'tu_password',
  port: Number(process.env.DB_PORT || 5432),
});

const ALLOWED_TIPOS = ['Técnica', 'Comercial', 'Soporte', 'Inspección', 'Personal', 'Administrativa'];
const ALLOWED_ESTATUS = ['Planificada', 'En Curso', 'Completada', 'Revisada', 'Cancelada', 'No Programada', 'Emergencia'];
const ALLOWED_TIPO_CONTACTO = ['Individual', 'Empresa', 'Organización'];

function validateVisitBody(body) {
  const errors = [];
  const { fecha, hora, tipo_visita, estatus, cedula_rif, nombre_entidad, telefono, tipo_contacto } = body;

  if (!fecha) errors.push('Fecha es obligatoria.');
  if (!hora) errors.push('Hora es obligatoria.');
  if (!tipo_visita) errors.push('Tipo de visita es obligatorio.');
  if (tipo_visita && !ALLOWED_TIPOS.includes(tipo_visita)) errors.push(`Tipo de visita inválido. Valores válidos: ${ALLOWED_TIPOS.join(', ')}.`);
  if (!estatus) errors.push('Estatus es obligatorio.');
  if (estatus && !ALLOWED_ESTATUS.includes(estatus)) errors.push(`Estatus inválido. Valores válidos: ${ALLOWED_ESTATUS.join(', ')}.`);
  if (!cedula_rif) errors.push('Cédula o RIF es obligatorio.');
  if (!nombre_entidad) errors.push('Nombre o entidad es obligatorio.');
  if (!telefono) errors.push('Teléfono es obligatorio.');
  if (!tipo_contacto) errors.push('Tipo de contacto es obligatorio.');
  if (tipo_contacto && !ALLOWED_TIPO_CONTACTO.includes(tipo_contacto)) errors.push(`Tipo de contacto inválido. Valores válidos: ${ALLOWED_TIPO_CONTACTO.join(', ')}.`);

  if (fecha && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha)) errors.push('Formato de fecha inválido. Use AAAA-MM-DD.');
  if (hora && !/^[0-9]{2}:[0-9]{2}$/.test(hora)) errors.push('Formato de hora inválido. Use HH:MM.');
  if (telefono && telefono.length < 7) errors.push('Teléfono parece demasiado corto.');

  return errors;
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secreto_ipsasel', // Cambia por un secreto seguro
  resave: false,
  saveUninitialized: true,
}));
app.use(express.static(path.join(__dirname), { index: false }));

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'menu_index.html'));
});

app.get('/register-visit', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/modify-visit', (req, res) => {
  res.sendFile(path.join(__dirname, 'modify_visit.html'));
});

app.get('/delete-visit', (req, res) => {
  res.sendFile(path.join(__dirname, 'delete_visit.html'));
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
  res.sendFile(path.join(__dirname, 'menu_index.html'));
});

app.get('/2index', (req, res) => {
  res.sendFile(path.join(__dirname, '2index.html'));
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'success.html'));
});

app.get('/visitas-del-dia', (req, res) => {
  res.sendFile(path.join(__dirname, 'visitas_del_dia.html'));
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
      await pool.query(
        'UPDATE CONTACTOS SET nombre_entidad = $1, telefono = $2, tipo_contacto = $3 WHERE id_contacto = $4',
        [nombre_entidad, telefono, tipo_contacto, id_contacto]
      );
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

    const codigo_visita = `VIS-${Date.now()}`;
    const id_usuario = req.session.userId || DEFAULT_USER_ID;

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
app.get('/api/visitas', async (req, res) => {
  const { codigo_visita } = req.query;
  if (!codigo_visita) {
    return res.status(400).json({ success: false, message: 'Código de visita requerido' });
  }

  try {
    const searchTerm = `%${codigo_visita.trim()}%`;
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             c.nombre_entidad, c.cedula_rif, c.telefono, c.tipo_contacto,
             o.codigo_ot, o.detalle AS detalle_ot
      FROM VISITAS v
      LEFT JOIN CONTACTOS c ON v.id_contacto = c.id_contacto
      LEFT JOIN ORDENES_TRABAJO o ON v.id_orden = o.id_orden
      WHERE v.codigo_visita ILIKE $1
         OR c.cedula_rif ILIKE $1
         OR c.nombre_entidad ILIKE $1
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
app.get('/visitas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             c.nombre_entidad, c.cedula_rif, c.telefono, c.tipo_contacto,
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
app.get('/api/visitas-del-dia', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             c.nombre_entidad, c.cedula_rif, c.telefono, c.tipo_contacto,
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
app.get('/api/visitas-por-fecha', async (req, res) => {
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
             c.nombre_entidad, c.cedula_rif, c.telefono, c.tipo_contacto,
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

// Eventos para FullCalendar
app.get('/api/visitas-eventos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.codigo_visita, v.fecha, v.hora, v.tipo_visita, v.estatus,
             TO_CHAR(v.fecha, 'YYYY-MM-DD') AS fecha_iso,
             TO_CHAR(v.hora, 'HH24:MI:SS') AS hora_iso,
             c.nombre_entidad, c.cedula_rif, c.telefono, c.tipo_contacto,
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
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error al obtener eventos de visitas' });
  }
});

// Ruta para modificar visita
app.post('/modify-visit', async (req, res) => {
  const {
    codigo_visita,
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
      await pool.query(
        'UPDATE CONTACTOS SET nombre_entidad = $1, telefono = $2, tipo_contacto = $3 WHERE id_contacto = $4',
        [nombre_entidad, telefono, tipo_contacto, id_contacto]
      );
    } else {
      const insertContacto = await pool.query(
        'INSERT INTO CONTACTOS (cedula_rif, nombre_entidad, telefono, tipo_contacto) VALUES ($1, $2, $3, $4) RETURNING id_contacto',
        [cedula_rif, nombre_entidad, telefono, tipo_contacto]
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