import express from 'express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'public');
const uploadsDir = join(rootDir, 'uploads');

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

  app.post('/api/beetles', (req, res, next) => {
    try {
      const photoPath = savePhoto(req.body.photo);
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

  app.put('/api/beetles/:id', (req, res, next) => {
    try {
      const photoPath = req.body.photo ? savePhoto(req.body.photo) : undefined;
      const beetle = repository.updateBeetle(Number(req.params.id), { ...req.body, photoPath });
      if (!beetle) return res.status(404).json({ error: 'Jedinec nenalezen.' });
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

  app.delete('/api/beetles/:id', (req, res) => {
    const deleted = repository.deleteBeetle(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Jedinec nenalezen.' });
    notify('beetle-deleted', {
      title: 'Jedinec odstranen',
      message: 'Zaznam byl smazan z deniku.'
    });
    res.status(204).end();
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

  app.delete('/api/records/:id', (req, res) => {
    const deleted = repository.deleteRecord(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Zaznam nenalezen.' });
    notify('record-deleted', {
      title: 'Zaznam odstranen',
      message: 'Udalost byla smazana z deniku.'
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
    res.status(400).json({ error: error.message });
  });

  return app;
}

function savePhoto(photo) {
  if (!photo?.dataUrl) return null;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(photo.dataUrl);
  if (!match) {
    throw new Error('Fotka musi byt poslana jako base64 data URL.');
  }

  const extension = extensionForMime(match[1]) || extname(photo.name || '') || '.jpg';
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  const filePath = join(uploadsDir, fileName);
  writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return `/uploads/${fileName}`;
}

function extensionForMime(mime) {
  return {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  }[mime];
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
