# IPSASEL Mobile Viewer (React Native + Expo)

App separada de solo lectura para ver visitas por fecha.

## 1) Requisitos

- Node.js 18+
- Expo Go en el telefono (Android/iOS)
- Backend corriendo en `http://TU_IP_LOCAL:3000`

## 2) Configurar API

Edita `src/config.js` y cambia la URL:

```js
export const API_BASE_URL = 'http://192.168.1.100:3000';
```

Usa la IP local de tu PC en la misma red Wi-Fi del telefono.

## 3) Instalar y ejecutar

```bash
cd mobile-viewer
npm install
npm start
```

Luego escanea el QR con Expo Go.

## 4) Funcionalidad

- Carga fechas disponibles desde `/api/visitas-eventos`
- Al tocar una fecha, consulta `/api/visitas-por-fecha?fecha=AAAA-MM-DD`
- Solo muestra datos (sin registrar/modificar/eliminar)

## 5) Modo dummy de acceso

- Puedes compartir solo esta app a usuarios finales.
- No ven SQL ni credenciales de la base.
- Solo consumen endpoints de lectura.
