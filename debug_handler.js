const handler = require('./api/index');

const event = {
  httpMethod: 'GET',
  path: '/',
  headers: { host: 'localhost' },
  queryStringParameters: null,
  body: null,
  isBase64Encoded: false,
};

const context = {};

handler(event, context)
  .then((res) => {
    console.log('RESULT', res && res.statusCode, res && typeof res.body === 'string' ? res.body.slice(0, 200) : res.body);
  })
  .catch((err) => {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
  });
