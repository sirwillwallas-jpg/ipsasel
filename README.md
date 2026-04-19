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

5. Crea un archivo `.env` en la raíz del proyecto con tus credenciales:
   ```env
   DB_USER=tu_usuario
   DB_PASSWORD=tu_password
   DB_HOST=127.0.0.1
   DB_NAME=ipsasel_db
   DB_PORT=5432
   DEFAULT_USER_ID=1
   SESSION_SECRET=secreto_ipsasel
   PORT=3000
   ```

6. Inserta datos iniciales (ejemplo):
   - Crea un rol: `INSERT INTO ROLES (nombre_rol) VALUES ('Admin');`
   - Crea un usuario: `INSERT INTO USUARIOS (id_rol, nombre_completo, username, password) VALUES (1, 'Administrador', 'admin', '$2b$10$abcdefghijklmnopqrstuv');`  (usa un hash bcrypt real para password)

   Para generar un hash bcrypt, usa Node.js:
   ```javascript
   const bcrypt = require('bcrypt');
   bcrypt.hash('tu_password', 10).then(hash => console.log(hash));
   ```

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
