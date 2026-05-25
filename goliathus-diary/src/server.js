import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
let io;

const app = createApp({
  notify(event, payload) {
    io.emit(event, {
      ...payload,
      sentAt: new Date().toISOString()
    });
  }
});

const httpServer = createServer(app);
io = new Server(httpServer);

io.on('connection', (socket) => {
  socket.emit('connected', {
    title: 'Denik pripojen',
    message: 'Zive notifikace jsou aktivni.',
    sentAt: new Date().toISOString()
  });
});

httpServer.listen(port, host, () => {
  console.log(`Goliathus denik bezi na http://${host}:${port}`);
});
