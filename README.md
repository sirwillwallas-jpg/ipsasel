# Sistema de Gestión de Visitas INPSASEL

Backend en Node.js con Express y PostgreSQL para el registro y gestión de visitas.

## Requisitos

- Node.js (versión 16 o superior)
- PostgreSQL
- Base de datos creada con el esquema en `schema.sql`

## Instalación

1. Instala Node.js desde [nodejs.org](https://nodejs.org/) si no lo tienes.

2. Clona o descarga el proyecto.

3. Instala las dependencias:
   ```
   npm install
   ```

4. Configura la base de datos:
   - Crea la base de datos en PostgreSQL.
   - Ejecuta el esquema desde `schema.sql`.

5. Edita `server.js` con tus credenciales de PostgreSQL:
   ```javascript
   const pool = new Pool({
     user: 'tu_usuario',
     host: 'localhost',
     database: 'ipsasel_db',
     password: 'tu_password',
     port: 5432,
   });
   ```

6. Inserta datos iniciales (ejemplo):
   - Crea un rol: `INSERT INTO ROLES (nombre_rol) VALUES ('Admin');`
   - Crea un usuario: `INSERT INTO USUARIOS (id_rol, nombre_completo, username, password) VALUES (1, 'Admin', 'admin', 'hash_de_password');`

## Ejecutar

```
npm start
```

O para desarrollo:
```
npm run dev
```

El servidor correrá en `http://localhost:3000`.

## Rutas

- `GET /`: Formulario de registro de visitas
- `POST /register-visit`: Registrar una visita
- `GET /menu`: Menú del sistema
- `POST /login`: Login de usuarios

## Notas

- Las contraseñas se hashean con bcrypt.
- Ajusta las rutas y lógica según necesites.
- Para producción, usa variables de entorno para credenciales.
