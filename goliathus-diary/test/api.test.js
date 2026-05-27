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
  let userIndex = 0;

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

  it('requires authentication for diary endpoints', async () => {
    const response = await fetch(`${baseUrl}/api/beetles`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Nejdrive se prihlaste.' });
  });

  it('registers, logs out and logs in', async () => {
    const client = createRawClient();
    const username = nextUsername();

    const registered = await client.request('/api/register', {
      method: 'POST',
      body: {
        username,
        password: 'password123'
      }
    });
    assert.equal(registered.user.username, username);

    let session = await client.request('/api/session');
    assert.equal(session.user.username, username);

    await client.requestNoContent('/api/logout', { method: 'POST' });
    session = await client.request('/api/session');
    assert.equal(session.user, null);

    const loggedIn = await client.request('/api/login', {
      method: 'POST',
      body: {
        username,
        password: 'password123'
      }
    });
    assert.equal(loggedIn.user.username, username);
  });

  it('creates beetle and record', async () => {
    const client = await createClient();
    const beetle = await client.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus goliatus',
        sex: 'female'
      }
    });

    assert.equal(beetle.species, 'Goliathus goliatus');
    assert.equal(beetle.sex, 'female');
    assert.equal('hatchedAt' in beetle, false);

    const record = await client.request(`/api/beetles/${beetle.id}/records`, {
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

    const detail = await client.request(`/api/beetles/${beetle.id}`);
    assert.equal(detail.records.length, 1);
    assert.equal(detail.records[0].value, '38');
    assert.equal(detail.records[0].unit, 'g');
  });

  it('creates feeding and date-only records', async () => {
    const client = await createClient();
    const beetle = await client.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus regius',
        sex: 'male'
      }
    });

    const feeding = await client.request(`/api/beetles/${beetle.id}/records`, {
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

    const molting = await client.request(`/api/beetles/${beetle.id}/records`, {
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

  it('exports only current user diary', async () => {
    const first = await createClient();
    const second = await createClient();

    await first.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus first',
        sex: 'female'
      }
    });
    await second.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus second',
        sex: 'male'
      }
    });

    const diary = await first.request('/api/export.json');
    assert.equal(diary.beetles.length, 1);
    assert.equal(diary.beetles[0].species, 'Goliathus first');

    const csvResponse = await first.fetch('/api/export.csv');
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /Goliathus first/);
    assert.doesNotMatch(csv, /Goliathus second/);
  });

  it('prevents cross-user access', async () => {
    const first = await createClient();
    const second = await createClient();

    const beetle = await first.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus private',
        sex: 'female'
      }
    });
    const record = await first.request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: '2026-05-20',
        value: '38'
      }
    });

    await second.requestError(`/api/beetles/${beetle.id}`, {}, 'Jedinec nenalezen.', 404);
    await second.requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: '2026-05-20',
        value: '40'
      }
    }, 'Jedinec nenalezen.', 404);
    await second.requestError(`/api/records/${record.id}`, {
      method: 'PUT',
      body: {
        type: 'weight',
        happenedAt: '2026-05-20',
        value: '41'
      }
    }, 'Zaznam nenalezen.', 404);
    await second.requestError(`/api/records/${record.id}`, { method: 'DELETE' }, 'Zaznam nenalezen.', 404);
  });

  it('updates and deletes beetles and records', async () => {
    const client = await createClient();
    const beetle = await client.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus atlas',
        sex: 'unknown'
      }
    });

    const updatedBeetle = await client.request(`/api/beetles/${beetle.id}`, {
      method: 'PUT',
      body: {
        species: 'Goliathus atlas updated',
        sex: 'male'
      }
    });

    assert.equal(updatedBeetle.species, 'Goliathus atlas updated');
    assert.equal(updatedBeetle.sex, 'male');

    const record = await client.request(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'feeding',
        happenedAt: '2026-05-21',
        value: '2',
        unit: 'ks',
        feedingType: 'banan'
      }
    });

    const updatedRecord = await client.request(`/api/records/${record.id}`, {
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

    await client.requestNoContent(`/api/records/${record.id}`, { method: 'DELETE' });
    const detail = await client.request(`/api/beetles/${beetle.id}`);
    assert.equal(detail.records.length, 0);

    await client.requestNoContent(`/api/beetles/${beetle.id}`, { method: 'DELETE' });
    await client.requestError(`/api/beetles/${beetle.id}`, {}, 'Jedinec nenalezen.', 404);
  });

  it('deletes beetle photo from uploads', async () => {
    const client = await createClient();
    const beetle = await client.request('/api/beetles', {
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

    await client.requestNoContent(`/api/beetles/${beetle.id}`, { method: 'DELETE' });
    assert.equal(existsSync(photoPath), false);
  });

  it('deletes old beetle photo after replacement', async () => {
    const client = await createClient();
    const beetle = await client.request('/api/beetles', {
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

    const updatedBeetle = await client.request(`/api/beetles/${beetle.id}`, {
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

  it('rejects invalid auth, beetles, records and photos', async () => {
    const raw = createRawClient();
    await raw.requestError('/api/register', {
      method: 'POST',
      body: {
        username: 'ab',
        password: 'password123'
      }
    }, 'Uzivatelske jmeno musi mit 3 az 50 znaku a smi obsahovat pismena, cisla, tecku, podtrzitko nebo pomlcku.');

    const client = await createClient();
    await client.requestError('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus',
        sex: 'other'
      }
    }, 'Pohlavi musi byt male, female nebo unknown.');

    const beetle = await client.request('/api/beetles', {
      method: 'POST',
      body: {
        species: 'Goliathus cacicus',
        sex: 'unknown'
      }
    });

    await client.requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'sleeping',
        happenedAt: '2026-05-21'
      }
    }, 'Neznamy typ zaznamu.');

    await client.requestError(`/api/beetles/${beetle.id}/records`, {
      method: 'POST',
      body: {
        type: 'weight',
        happenedAt: futureDateValue(),
        value: '38'
      }
    }, 'Datum udalosti nesmi byt v budoucnosti.');

    await client.requestError('/api/beetles', {
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
  });

  async function createClient() {
    const client = createRawClient();
    await client.request('/api/register', {
      method: 'POST',
      body: {
        username: nextUsername(),
        password: 'password123'
      }
    });
    return client;
  }

  function createRawClient() {
    let cookie = '';

    return {
      async fetch(path, options = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: options.method ?? 'GET',
          headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {})
          },
          body: options.body ? JSON.stringify(options.body) : undefined
        });

        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          cookie = setCookie.split(';')[0];
        }

        return response;
      },

      async request(path, options = {}) {
        const response = await this.fetch(path, options);
        if (!response.ok) {
          assert.fail(`${response.status} ${await response.text()}`);
        }
        if (response.status === 204) return null;
        return response.json();
      },

      async requestNoContent(path, options = {}) {
        const response = await this.fetch(path, options);
        assert.equal(response.status, 204);
        assert.equal(await response.text(), '');
      },

      async requestError(path, options, expectedError, expectedStatus = 400) {
        const response = await this.fetch(path, options);
        assert.equal(response.status, expectedStatus);
        assert.deepEqual(await response.json(), { error: expectedError });
      }
    };
  }

  function nextUsername() {
    userIndex += 1;
    return `user${userIndex}`;
  }

  function futureDateValue() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
});
