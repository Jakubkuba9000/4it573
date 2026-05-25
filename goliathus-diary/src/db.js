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
      hatched_at TEXT,
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
      note TEXT,
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
      const result = db.prepare('DELETE FROM beetles WHERE id = ?').run(id);
      return result.changes > 0;
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

    deleteRecord(id) {
      const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
      return result.changes > 0;
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
  if (!input.species || input.species.trim().length < 2) {
    throw new Error('Druh musi mit alespon 2 znaky.');
  }

  if (!['male', 'female', 'unknown'].includes(input.sex)) {
    throw new Error('Pohlavi musi byt male, female nebo unknown.');
  }
}

function validateRecord(input) {
  if (!EVENT_TYPES.has(input.type)) {
    throw new Error('Neznamy typ zaznamu.');
  }

  if (!input.happenedAt) {
    throw new Error('Datum udalosti je povinne.');
  }

  if (input.type === 'feeding') {
    if (!input.value || !input.unit || !input.feedingType) {
      throw new Error('Krmeni musi mit hodnotu, jednotku a typ krmeni.');
    }
    return;
  }

  if (input.type === 'weight') {
    if (!input.value) {
      throw new Error('Vazeni musi mit hodnotu v gramech.');
    }
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
