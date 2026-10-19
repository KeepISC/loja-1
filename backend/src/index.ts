import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);

const app = createApp();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;
