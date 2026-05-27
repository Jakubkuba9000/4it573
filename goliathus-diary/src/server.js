import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
let io;

const app = createApp({
  notify(event, payload) {
    const target = payload.userId ? io.to(`user:${payload.userId}`) : io;
    target.emit(event, {
      ...payload,
      sentAt: new Date().toISOString()
    });
  }
});

const httpServer = createServer(app);
io = new Server(httpServer);

io.on('connection', (socket) => {
  const token = parseCookies(socket.handshake.headers.cookie || '')[app.locals.sessionCookieName];
  const session = token ? app.locals.repository.getSession(token) : null;
  if (!session) {
    socket.disconnect(true);
    return;
  }

  socket.join(`user:${session.user.id}`);
  socket.emit('connected', {
    title: 'Denik pripojen',
    message: 'Zive notifikace jsou aktivni.',
    sentAt: new Date().toISOString()
  });
});

httpServer.listen(port, host, () => {
  console.log(`Goliathus denik bezi na http://${host}:${port}`);
});

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}
