import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const EVENT_TYPES = new Set(['feeding', 'weight', 'molting', 'pupation', 'emergence']);
const DATE_ONLY_TYPES = new Set(['molting', 'pupation', 'emergence']);

export function openDatabase(filePath = './data/goliathus.sqlite') {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return createRepository(db);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beetles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      species TEXT NOT NULL,
      sex TEXT NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
      photo_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beetle_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      happened_at TEXT NOT NULL,
      value TEXT,
      unit TEXT,
      feeding_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (beetle_id) REFERENCES beetles(id) ON DELETE CASCADE
    );
  `);

  addColumnIfMissing(db, 'records', 'unit', 'TEXT');
  addColumnIfMissing(db, 'records', 'feeding_type', 'TEXT');
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function createRepository(db) {
  return {
    close() {
      db.close();
    },

    listBeetles() {
      const beetles = db.prepare(`
        SELECT
          b.*,
          COUNT(r.id) AS record_count,
          MAX(r.happened_at) AS last_record_at
        FROM beetles b
        LEFT JOIN records r ON r.beetle_id = b.id
        GROUP BY b.id
        ORDER BY b.created_at DESC, b.id DESC
      `).all();

      return beetles.map(normalizeBeetle);
    },

    getBeetle(id) {
      const beetle = db.prepare('SELECT * FROM beetles WHERE id = ?').get(id);
      if (!beetle) return null;

      const records = db.prepare(`
        SELECT * FROM records
        WHERE beetle_id = ?
        ORDER BY happened_at DESC, id DESC
      `).all(id);

      return {
        ...normalizeBeetle(beetle),
        records: records.map(normalizeRecord)
      };
    },

    createBeetle(input) {
      validateBeetle(input);
      const result = db.prepare(`
        INSERT INTO beetles (species, sex, photo_path)
        VALUES (?, ?, ?)
      `).run(input.species.trim(), input.sex, input.photoPath || null);

      return this.getBeetle(Number(result.lastInsertRowid));
    },

    updateBeetle(id, input) {
      const current = this.getBeetle(id);
      if (!current) return null;

      const next = {
        species: input.species ?? current.species,
        sex: input.sex ?? current.sex,
        photoPath: input.photoPath ?? current.photoPath
      };

      validateBeetle(next);
      db.prepare(`
        UPDATE beetles
        SET species = ?, sex = ?, photo_path = ?
        WHERE id = ?
      `).run(next.species.trim(), next.sex, next.photoPath || null, id);

      return this.getBeetle(id);
    },

    deleteBeetle(id) {
      const beetle = db.prepare('SELECT * FROM beetles WHERE id = ?').get(id);
      if (!beetle) return null;

      const result = db.prepare('DELETE FROM beetles WHERE id = ?').run(id);
      return result.changes > 0 ? normalizeBeetle(beetle) : null;
    },

    createRecord(beetleId, input) {
      if (!this.getBeetle(beetleId)) return null;
      validateRecord(input);

      const result = db.prepare(`
        INSERT INTO records (beetle_id, type, happened_at, value, unit, feeding_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        beetleId,
        input.type,
        input.happenedAt,
        input.value || null,
        input.unit || null,
        input.feedingType || null
      );

      const record = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(result.lastInsertRowid));
      return normalizeRecord(record);
    },

    updateRecord(id, input) {
      const current = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
      if (!current) return null;

      const next = {
        type: input.type ?? current.type,
        happenedAt: input.happenedAt ?? current.happened_at,
        value: input.value ?? current.value,
        unit: input.unit ?? current.unit,
        feedingType: input.feedingType ?? current.feeding_type
      };

      validateRecord(next);
      db.prepare(`
        UPDATE records
        SET type = ?, happened_at = ?, value = ?, unit = ?, feeding_type = ?
        WHERE id = ?
      `).run(
        next.type,
        next.happenedAt,
        next.value || null,
        next.unit || null,
        next.feedingType || null,
        id
      );

      const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
      return normalizeRecord(record);
    },

    deleteRecord(id) {
      const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
      if (!record) return null;

      const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
      return result.changes > 0 ? normalizeRecord(record) : null;
    },

    exportDiary() {
      const beetles = this.listBeetles().map((beetle) => this.getBeetle(beetle.id));
      return {
        exportedAt: new Date().toISOString(),
        beetles
      };
    }
  };
}

function validateBeetle(input) {
  if (!input || typeof input !== 'object') {
    throw validationError('Jedinec musi byt objekt.');
  }

  if (typeof input.species !== 'string' || input.species.trim().length < 2) {
    throw validationError('Druh musi mit alespon 2 znaky.');
  }

  if (!['male', 'female', 'unknown'].includes(input.sex)) {
    throw validationError('Pohlavi musi byt male, female nebo unknown.');
  }
}

function validateRecord(input) {
  if (!input || typeof input !== 'object') {
    throw validationError('Zaznam musi byt objekt.');
  }

  if (!EVENT_TYPES.has(input.type)) {
    throw validationError('Neznamy typ zaznamu.');
  }

  if (!isValidDate(input.happenedAt)) {
    throw validationError('Datum udalosti musi byt ve formatu RRRR-MM-DD.');
  }

  if (isFutureDate(input.happenedAt)) {
    throw validationError('Datum udalosti nesmi byt v budoucnosti.');
  }

  if (input.type === 'feeding') {
    input.value = normalizePositiveNumber(input.value, 'Hodnota krmeni');
    input.unit = normalizeRequiredText(input.unit, 'Jednotka krmeni');
    input.feedingType = normalizeRequiredText(input.feedingType, 'Typ krmeni');

    if (!input.unit || !input.feedingType) {
      throw validationError('Krmeni musi mit hodnotu, jednotku a typ krmeni.');
    }
    return;
  }

  if (input.type === 'weight') {
    input.value = normalizePositiveNumber(input.value, 'Hodnota vazeni');
    input.unit = 'g';
    input.feedingType = null;
    return;
  }

  if (DATE_ONLY_TYPES.has(input.type)) {
    input.value = null;
    input.unit = null;
    input.feedingType = null;
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isFutureDate(value) {
  const today = new Date().toISOString().slice(0, 10);
  return value > today;
}

function normalizePositiveNumber(value, label) {
  const text = String(value ?? '').trim();
  const number = Number(text);
  if (!text || !Number.isFinite(number) || number <= 0) {
    throw validationError(`${label} musi byt kladne cislo.`);
  }
  return text;
}

function normalizeRequiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw validationError(`${label} je povinny udaj.`);
  }
  return text;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeBeetle(row) {
  return {
    id: row.id,
    species: row.species,
    sex: row.sex,
    photoPath: row.photo_path,
    createdAt: row.created_at,
    recordCount: row.record_count ?? 0,
    lastRecordAt: row.last_record_at ?? null
  };
}

function normalizeRecord(row) {
  return {
    id: row.id,
    beetleId: row.beetle_id,
    type: row.type,
    happenedAt: row.happened_at,
    value: row.value,
    unit: row.unit,
    feedingType: row.feeding_type,
    createdAt: row.created_at
  };
}
