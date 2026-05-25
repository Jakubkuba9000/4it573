import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
});
