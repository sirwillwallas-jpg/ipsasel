# Sistema de Gestión de Visitas INPSASEL

Sistema web para registrar, consultar, modificar y eliminar visitas, con autenticación por sesión, persistencia en PostgreSQL y soporte para despliegue en Vercel y Railway.

## Qué incluye el proyecto

- `server.js`: servidor principal en Express, con login, sesiones, rutas HTML y API.
- `api/index.js`: adaptador serverless para Vercel.
- `apply_migrations.js`: ejecuta las migraciones SQL de forma secuencial.
- `schema.sql`: esquema base de la base de datos.
- `migrations/`: evolución del esquema con cambios puntuales.
- `index.html`, `modify_visit.html`, `delete_visit.html`, `success.html`, `visitas_del_dia.html`, `menu_index.html`, `login.html`: vistas web principales.
- `style.css` y `menu_style.css`: estilos compartidos de formularios y menú.
- `mobile-viewer/`: visor móvil hecho con Expo / React Native.

## Requisitos

- Node.js 16 o superior.
- PostgreSQL.
- Dependencias instaladas con `npm install`.
- Base de datos creada con el esquema de `schema.sql` o con las migraciones.

## Estructura funcional

El backend centraliza estas responsabilidades:

- Autenticación de usuarios con sesión y cookie firmada.
- Carga de usuarios administrativos desde variables de entorno.
- Registro de visitas con contacto y orden de trabajo asociados.
- Consulta de visitas por fecha, código, resumen de calendario y eventos.
- Sincronización de tablas auxiliares como `ROLES` y `USUARIOS` cuando hace falta.

El frontend web se compone de formularios HTML clásicos servidos por Express, mientras que el visor móvil consume las rutas `/api/*`.

## Modelo de datos

Las tablas principales del esquema son:

- `MAESTRA`: tabla de parámetros generales o catálogos.
- `EMPRESA`: empresas registradas.
- `ROLES`: roles de usuario.
- `CONTACTOS`: personas o entidades asociadas a una visita.
- `ORDENES_TRABAJO`: órdenes de trabajo relacionadas con visitas.
- `DEPARTAMENTO`: departamentos de una empresa.
- `EMPLEADO`: empleados asociados a un departamento.
- `USUARIOS`: usuarios del sistema con rol y, opcionalmente, empleado asociado.
- `AUDITORIA`: historial de acciones del sistema.
- `VISITAS`: registro transaccional principal.

Relaciones relevantes:

- `EMPRESA` 1 a muchos `DEPARTAMENTO`.
- `DEPARTAMENTO` 1 a muchos `EMPLEADO`.
- `ROLES` 1 a muchos `USUARIOS`.
- `EMPLEADO` 1 a muchos `USUARIOS` cuando el usuario está vinculado a una persona interna.
- `USUARIOS` 1 a muchos `AUDITORIA`.
- `CONTACTOS` 1 a muchos `VISITAS`.
- `USUARIOS` 1 a muchos `VISITAS`.
- `ORDENES_TRABAJO` 1 a muchos `VISITAS` cuando una visita se asocia a una orden.

Campos importantes a tener en cuenta:

- `VISITAS.codigo_visita` identifica cada registro de forma única.
- `VISITAS.tipo_visita` y `VISITAS.estatus` usan enums definidos en el esquema.
- `CONTACTOS.tipo_contacto` también usa enum.
- `USUARIOS.password` almacena el hash bcrypt, no la contraseña en texto plano.

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto con valores parecidos a estos:

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

Variables opcionales útiles:

```env
APP_ADMIN_USERNAME=inpsaseladmin
APP_ADMIN_PASSWORD=sup3rusu4r10
APP_ADMIN_PASSWORD_HASH=
APP_ADMIN_NAME=Administrador INPSASEL
READONLY_USER_USERNAME=inpsaselusuario
READONLY_USER_PASSWORD=1nps4s3l4dm1n2026
READONLY_USER_PASSWORD_HASH=
READONLY_USER_NAME=Usuario de registro
READONLY_VISIT_ROLE_NAME=Registro y calendario
FULL_VISIT_ACCESS_ROLE_NAMES=Admin,Administrador
```

## Instalación

1. Instala Node.js desde [nodejs.org](https://nodejs.org/) si aún no lo tienes.
2. Clona o descarga el proyecto.
3. Instala dependencias:

   ```bash
   npm install
   ```

4. Crea la base de datos en PostgreSQL.
5. Aplica el esquema:

   ```bash
   npm run migrate
   ```

   Si prefieres hacerlo manualmente, ejecuta `schema.sql` y luego las migraciones.
6. Crea el archivo `.env` con tus credenciales.
7. Si vas a usar un administrador inicial, crea o sincroniza el usuario con hash bcrypt.

Para generar un hash bcrypt rápido:

```javascript
const bcrypt = require('bcryptjs');

bcrypt.hash('tu_password', 10).then((hash) => console.log(hash));
```

## Ejecución

En Windows, primero asegúrate de que PostgreSQL esté activo y luego inicia el servidor:

```powershell
Start-Service postgresql-x64-17
Get-Service postgresql-x64-17
npm start
```

Modo desarrollo:

```bash
npm run dev
```

El servidor queda disponible en `http://localhost:3000`.

## Cómo funciona el acceso

- La primera pantalla es `GET /` o `GET /login`.
- El login intenta validar primero al superusuario configurado por variables de entorno.
- Si no aplica, valida contra la tabla `USUARIOS` usando bcrypt.
- El usuario autenticado se guarda en sesión y además en una cookie firmada.
- Las rutas internas requieren sesión activa.
- El usuario con rol de solo lectura puede entrar, pero no tiene permisos para modificar o eliminar visitas.

## Rutas principales

### Autenticación y navegación

- `GET /`: pantalla inicial.
- `GET /login`: formulario de acceso.
- `POST /login`: valida credenciales.
- `POST /logout`: cierra sesión.
- `GET /menu`: menú principal.

### Vistas de visitas

- `GET /register-visit`: formulario para crear visitas.
- `POST /register-visit`: guarda una visita nueva.
- `GET /modify-visit`: pantalla para buscar y editar visitas.
- `POST /modify-visit`: actualiza una visita.
- `GET /delete-visit`: pantalla para eliminar visitas.
- `POST /delete-visit`: elimina una visita.
- `GET /success`: pantalla de confirmación.
- `GET /visitas-del-dia`: calendario y listado del día.

### API JSON

- `GET /api/visitas`: búsqueda por código o texto parcial.
- `GET /visitas`: listado resumido de visitas recientes.
- `GET /api/visitas-del-dia`: visitas del día actual.
- `GET /api/visitas-por-fecha`: visitas de una fecha puntual.
- `GET /api/visitas-calendario-resumen`: resumen de visitas por fecha.
- `GET /api/visitas-eventos`: eventos listos para calendarios.

## Visor móvil

La carpeta `mobile-viewer/` contiene una app Expo que consume la API del backend para mostrar:

- calendario mensual,
- visitas por día,
- conteo de eventos por fecha,
- tarjetas con detalle de cada visita.

La URL del backend se resuelve desde `mobile-viewer/src/config.js`, con soporte para red local y variable `EXPO_PUBLIC_API_BASE_URL`.

## Despliegue

- En Vercel, el entry point serverless es `api/index.js`.
- En Railway o un servidor Node tradicional, el entry point es `server.js`.
- Si cambias credenciales o roles, conviene reiniciar el servicio para que tome las nuevas variables de entorno.

## Notas

- Las contraseñas no deben guardarse en texto plano.
- El esquema y las migraciones pueden coexistir durante la evolución del proyecto.
- Si una tabla no existe aún en tu base de datos, revisa `schema.sql` antes de ejecutar el backend.
- Los nombres de algunos campos conservan la compatibilidad con datos antiguos para no romper formularios existentes.
