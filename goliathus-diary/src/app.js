import express from 'express';
import { mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'public');
const defaultUploadsDir = join(rootDir, 'uploads');
const maxPhotoBytes = 5 * 1024 * 1024;
const allowedPhotoTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp']
]);

const EVENT_LABELS = {
  feeding: 'Krmeni',
  weight: 'Vazeni',
  molting: 'Svlekani',
  pupation: 'Kukleni',
  emergence: 'Vylihnuti'
};

export function createApp(options = {}) {
  const app = express();
  const repository = options.repository ?? openDatabase(options.databasePath);
  const notify = options.notify ?? (() => {});
  const uploadsDir = options.uploadsDir ?? defaultUploadsDir;

  mkdirSync(uploadsDir, { recursive: true });

  app.locals.repository = repository;
  app.use(express.json({ limit: '8mb' }));
  app.use('/uploads', express.static(uploadsDir));
  app.use(express.static(publicDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/beetles', (_req, res) => {
    res.json(repository.listBeetles());
  });

  app.post('/api/beetles', async (req, res, next) => {
    try {
      const photoPath = await savePhoto(req.body.photo, uploadsDir);
      const beetle = repository.createBeetle({ ...req.body, photoPath });
      notify('beetle-created', {
        title: 'Novy jedinec v deniku',
        message: `${beetle.species} byl pridan do evidence.`,
        beetle
      });
      res.status(201).json(beetle);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/beetles/:id', (req, res) => {
    const beetle = repository.getBeetle(Number(req.params.id));
    if (!beetle) return res.status(404).json({ error: 'Jedinec nenalezen.' });
    res.json(beetle);
  });

  app.put('/api/beetles/:id', async (req, res, next) => {
    try {
      const beetleId = Number(req.params.id);
      const current = repository.getBeetle(beetleId);
      if (!current) return res.status(404).json({ error: 'Jedinec nenalezen.' });

      const photoPath = req.body.photo ? await savePhoto(req.body.photo, uploadsDir) : undefined;
      const beetle = repository.updateBeetle(beetleId, { ...req.body, photoPath });
      if (!beetle) return res.status(404).json({ error: 'Jedinec nenalezen.' });
      if (photoPath && current.photoPath !== photoPath) {
        await deletePhoto(current.photoPath, uploadsDir);
      }
      notify('beetle-updated', {
        title: 'Jedinec upraven',
        message: `${beetle.species} ma aktualizovane udaje.`,
        beetle
      });
      res.json(beetle);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/beetles/:id', async (req, res, next) => {
    const deleted = repository.deleteBeetle(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Jedinec nenalezen.' });
    try {
      await deletePhoto(deleted.photoPath, uploadsDir);
      notify('beetle-deleted', {
        title: 'Jedinec odstranen',
        message: 'Zaznam byl smazan z deniku.',
        beetleId: deleted.id
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/beetles/:id/records', (req, res, next) => {
    try {
      const beetleId = Number(req.params.id);
      const record = repository.createRecord(beetleId, req.body);
      if (!record) return res.status(404).json({ error: 'Jedinec nenalezen.' });
      const beetle = repository.getBeetle(beetleId);

      notify('record-created', {
        title: 'Nova udalost',
        message: `${EVENT_LABELS[record.type]}: ${beetle.species}`,
        beetleId,
        record
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/records/:id', (req, res, next) => {
    try {
      const record = repository.updateRecord(Number(req.params.id), req.body);
      if (!record) return res.status(404).json({ error: 'Zaznam nenalezen.' });
      const beetle = repository.getBeetle(record.beetleId);

      notify('record-updated', {
        title: 'Udalost upravena',
        message: `${EVENT_LABELS[record.type]}: ${beetle.species}`,
        beetleId: record.beetleId,
        record
      });

      res.json(record);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/records/:id', (req, res) => {
    const deleted = repository.deleteRecord(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Zaznam nenalezen.' });
    notify('record-deleted', {
      title: 'Zaznam odstranen',
      message: 'Udalost byla smazana z deniku.',
      beetleId: deleted.beetleId,
      recordId: deleted.id
    });
    res.status(204).end();
  });

  app.get('/api/export.json', (_req, res) => {
    res.attachment('goliathus-denik.json');
    res.json(repository.exportDiary());
  });

  app.get('/api/export.csv', (_req, res) => {
    res.attachment('goliathus-denik.csv');
    res.type('text/csv').send(toCsv(repository.exportDiary()));
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode ?? error.status ?? 500;
    const message = statusCode === 500 ? 'Nastala neocekavana chyba serveru.' : error.message;
    res.status(statusCode).json({ error: message });
  });

  return app;
}

async function savePhoto(photo, uploadsDir) {
  if (!photo?.dataUrl) return null;

  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(photo.dataUrl);
  if (!match) {
    throw validationError('Fotka musi byt poslana jako base64 data URL.');
  }

  const extension = allowedPhotoTypes.get(match[1]);
  if (!extension) {
    throw validationError('Fotka musi byt JPEG, PNG, GIF nebo WebP.');
  }

  const base64 = match[2];
  if (!isBase64(base64)) {
    throw validationError('Fotka obsahuje neplatna base64 data.');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > maxPhotoBytes) {
    throw validationError('Fotka muze mit maximalne 5 MB.');
  }

  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  const filePath = join(uploadsDir, fileName);
  await writeFile(filePath, buffer);
  return `/uploads/${fileName}`;
}

async function deletePhoto(photoPath, uploadsDir) {
  if (!photoPath) return;

  const fileName = basename(photoPath);
  if (photoPath !== `/uploads/${fileName}`) return;

  try {
    await unlink(join(uploadsDir, fileName));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function isBase64(value) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function toCsv(diary) {
  const rows = [
    ['beetle_id', 'species', 'sex', 'record_id', 'record_type', 'happened_at', 'value', 'unit', 'feeding_type']
  ];

  for (const beetle of diary.beetles) {
    if (beetle.records.length === 0) {
      rows.push([beetle.id, beetle.species, beetle.sex, '', '', '', '', '', '']);
      continue;
    }

    for (const record of beetle.records) {
      rows.push([
        beetle.id,
        beetle.species,
        beetle.sex,
        record.id,
        record.type,
        record.happenedAt,
        record.value,
        record.unit,
        record.feedingType
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  return `"${String(value).replaceAll('"', '""')}"`;
}
