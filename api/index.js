const serverless = require('serverless-http');
const app = require('../server');

// Adaptador para exponer el mismo servidor Express como funcion serverless en Vercel.
module.exports = serverless(app);
