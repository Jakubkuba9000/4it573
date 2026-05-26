import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';

describe('Goliathus API', () => {
  let baseUrl;
  let server;
  let app;
  let tempDir;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'goliathus-test-'));
    app = createApp({
      databasePath: join(tempDir, 'test.sqlite'),
      uploadsDir: join(tempDir, 'uploads'),
      notify() {}
    });

    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    app.locals.repository.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates beetle and record', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus goliatus',
        sex: 'female'
      }
    });

    assert.equal(beetle.species, 'Goliathus goliatus');
    assert.equal(beetle.sex, 'female');
    assert.equal('hatchedAt' in beetle, false);

    const record = await request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: '2026-05-20',
        value: '38'
      }
    });

    assert.equal(record.type, 'weight');
    assert.equal(record.unit, 'g');
    assert.equal('note' in record, false);

    const detail = await request(`/api/beetles/${beetle.id}`);
    assert.equal(detail.records.length, 1);
    assert.equal(detail.records[0].value, '38');
    assert.equal(detail.records[0].unit, 'g');
  });

  it('creates feeding and date-only records', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus regius',
        sex: 'male'
      }
    });

    const feeding = await request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'feeding',
        happenedAt: '2026-05-21',
        value: '2',
        unit: 'ks',
        feedingType: 'banan'
      }
    });

    assert.equal(feeding.value, '2');
    assert.equal(feeding.unit, 'ks');
    assert.equal(feeding.feedingType, 'banan');

    const molting = await request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'molting',
        happenedAt: '2026-05-22',
        value: 'ignored',
        unit: 'ignored',
        feedingType: 'ignored'
      }
    });

    assert.equal(molting.value, null);
    assert.equal(molting.unit, null);
    assert.equal(molting.feedingType, null);
  });

  it('exports diary as json and csv', async () => {
    const jsonResponse = await fetch(`${baseUrl}/api/export.json`);
    assert.equal(jsonResponse.status, 200);
    const diary = await jsonResponse.json();
    assert.ok(Array.isArray(diary.beetles));

    const csvResponse = await fetch(`${baseUrl}/api/export.csv`);
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /"beetle_id","species","sex","record_id"/);
    assert.match(csv, /Goliathus goliatus/);
  });

  it('updates and deletes beetles and records', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus atlas',
        sex: 'unknown'
      }
    });

    const updatedBeetle = await request(`/api/beetles/${beetle.id}`, {
      method: 'PUT',
      body: {
        species: 'Goliathus atlas updated',
        sex: 'male'
      }
    });

    assert.equal(updatedBeetle.species, 'Goliathus atlas updated');
    assert.equal(updatedBeetle.sex, 'male');

    const record = await request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'feeding',
        happenedAt: '2026-05-21',
        value: '2',
        unit: 'ks',
        feedingType: 'banan'
      }
    });

    const updatedRecord = await request(`/api/records/${record.id}`, {
      method: 'PUT',
      body: {
        type: 'weight',
        happenedAt: '2026-05-22',
        value: '41'
      }
    });

    assert.equal(updatedRecord.type, 'weight');
    assert.equal(updatedRecord.value, '41');
    assert.equal(updatedRecord.unit, 'g');
    assert.equal(updatedRecord.feedingType, null);

    await requestNoContent(`/api/records/${record.id}`, { method: 'DELETE' });
    const detail = await request(`/api/beetles/${beetle.id}`);
    assert.equal(detail.records.length, 0);

    await requestNoContent(`/api/beetles/${beetle.id}`, { method: 'DELETE' });
    await requestError(`/api/beetles/${beetle.id}`, {}, 'Jedinec nenalezen.', 404);
  });

  it('deletes beetle photo from uploads', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus meleagris',
        sex: 'female',
        photo: {
          name: 'photo.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo='
        }
      }
    });

    const photoPath = join(tempDir, beetle.photoPath);
    assert.equal(existsSync(photoPath), true);

    await requestNoContent(`/api/beetles/${beetle.id}`, { method: 'DELETE' });
    assert.equal(existsSync(photoPath), false);
  });

  it('deletes old beetle photo after replacement', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus albosignatus',
        sex: 'male',
        photo: {
          name: 'old.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo='
        }
      }
    });

    const oldPhotoPath = join(tempDir, beetle.photoPath);
    assert.equal(existsSync(oldPhotoPath), true);

    const updatedBeetle = await request(`/api/beetles/${beetle.id}`, {
      method: 'PUT',
      body: {
        species: beetle.species,
        sex: beetle.sex,
        photo: {
          name: 'new.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgpOZXc='
        }
      }
    });

    const newPhotoPath = join(tempDir, updatedBeetle.photoPath);
    assert.notEqual(updatedBeetle.photoPath, beetle.photoPath);
    assert.equal(existsSync(oldPhotoPath), false);
    assert.equal(existsSync(newPhotoPath), true);
  });

  it('rejects invalid beetles', async () => {
    await requestError('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus',
        sex: 'other'
      }
    }, 'Pohlavi musi byt male, female nebo unknown.');

    await requestError('/api/beetles', {
      method: 'POST',
      body: {
        species: 'A',
        sex: 'unknown'
      }
    }, 'Druh musi mit alespon 2 znaky.');
  });

  it('rejects invalid records', async () => {
    const beetle = await request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus cacicus',
        sex: 'unknown'
      }
    });

    await requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'sleeping',
        happenedAt: '2026-05-21'
      }
    }, 'Neznamy typ zaznamu.');

    await requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: '2026-02-31',
        value: '38'
      }
    }, 'Datum udalosti musi byt ve formatu RRRR-MM-DD.');

    await requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: '2026-05-21',
        value: '0'
      }
    }, 'Hodnota vazeni musi byt kladne cislo.');

    await requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: futureDateValue(),
        value: '38'
      }
    }, 'Datum udalosti nesmi byt v budoucnosti.');

    await requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'feeding',
        happenedAt: '2026-05-21',
        value: '2',
        unit: ' ',
        feedingType: 'banan'
      }
    }, 'Jednotka krmeni je povinny udaj.');
  });

  it('rejects invalid photos', async () => {
    await requestError('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus orientalis',
        sex: 'female',
        photo: {
          name: 'photo.txt',
          dataUrl: 'data:text/plain;base64,SGVsbG8='
        }
      }
    }, 'Fotka musi byt JPEG, PNG, GIF nebo WebP.');

    await requestError('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus orientalis',
        sex: 'female',
        photo: {
          name: 'photo.png',
          dataUrl: 'data:image/png;base64,not-valid'
        }
      }
    }, 'Fotka obsahuje neplatna base64 data.');
  });

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      assert.fail(`${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  async function requestNoContent(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  }

  async function requestError(path, options, expectedError, expectedStatus = 400) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { error: expectedError });
  }

  function futureDateValue() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
});
