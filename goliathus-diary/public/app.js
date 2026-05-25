const beetleForm = document.getElementById('beetle-form');
const recordForm = document.getElementById('record-form');
const beetlesList = document.getElementById('beetles');
const recordsList = document.getElementById('records');
const selectedText = document.getElementById('selected');
const notificationsList = document.getElementById('notifications');
const unitRow = document.getElementById('unit-row');
const feedingTypeRow = document.getElementById('feeding-type-row');

let selectedBeetleId = null;

recordForm.elements.happenedAt.valueAsDate = new Date();
recordForm.elements.type.addEventListener('change', updateRecordFields);
updateRecordFields();

beetleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(beetleForm);
  const photo = form.get('photo');

  await request('/api/beetles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      species: form.get('species'),
      sex: form.get('sex'),
      photo: photo && photo.size ? {
        name: photo.name,
        dataUrl: await readFileAsDataUrl(photo)
      } : null
    })
  });

  beetleForm.reset();
  await loadBeetles();
});

recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedBeetleId) {
    alert('Nejdrive vyberte jedince.');
    return;
  }

  const form = new FormData(recordForm);
  const type = form.get('type');
  await request('/api/beetles/' + selectedBeetleId + '/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      happenedAt: form.get('happenedAt'),
      value: type === 'molting' || type === 'pupation' || type === 'emergence' ? null : form.get('value'),
      unit: type === 'weight' ? 'g' : form.get('unit'),
      feedingType: type === 'feeding' ? form.get('feedingType') : null
    })
  });

  recordForm.reset();
  recordForm.elements.happenedAt.valueAsDate = new Date();
  updateRecordFields();
  await loadBeetles();
  await showBeetle(selectedBeetleId);
});

function updateRecordFields() {
  const type = recordForm.elements.type.value;
  const isFeeding = type === 'feeding';
  const isWeight = type === 'weight';
  const dateOnly = type === 'molting' || type === 'pupation' || type === 'emergence';
  const valueInput = recordForm.elements.value;
  const unitInput = recordForm.elements.unit;
  const feedingTypeInput = recordForm.elements.feedingType;

  valueInput.parentElement.parentElement.hidden = dateOnly;
  unitRow.hidden = dateOnly || isWeight;
  feedingTypeRow.hidden = !isFeeding;
  valueInput.required = isFeeding || isWeight;
  unitInput.required = isFeeding;
  feedingTypeInput.required = isFeeding;

  if (isWeight) {
    valueInput.placeholder = 'napr. 38';
  } else if (isFeeding) {
    valueInput.placeholder = 'napr. 2';
  }
}

async function loadBeetles() {
  const beetles = await request('/api/beetles');
  beetlesList.innerHTML = '';

  if (beetles.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Zatim nejsou ulozeni zadni jedinci.';
    beetlesList.appendChild(item);
    return;
  }

  for (const beetle of beetles) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '#' + beetle.id + ' - ' + beetle.species + ' (' + beetle.sex + ', ' + beetle.recordCount + ' zaznamu)';
    button.addEventListener('click', () => showBeetle(beetle.id));
    item.appendChild(button);

    if (beetle.photoPath) {
      const link = document.createElement('a');
      link.href = beetle.photoPath;
      link.textContent = ' fotka';
      link.target = '_blank';
      item.appendChild(link);
    }

    beetlesList.appendChild(item);
  }
}

async function showBeetle(id) {
  const beetle = await request('/api/beetles/' + id);
  selectedBeetleId = beetle.id;
  selectedText.textContent = 'Vybran jedinec: #' + beetle.id + ' - ' + beetle.species;
  recordsList.innerHTML = '';

  if (beetle.records.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Tento jedinec zatim nema zaznamy.';
    recordsList.appendChild(item);
    return;
  }

  for (const record of beetle.records) {
    const item = document.createElement('li');
    item.textContent = record.happenedAt + ' - ' + record.type;
    if (record.value) item.textContent += ' - ' + record.value + (record.unit ? ' ' + record.unit : '');
    if (record.feedingType) item.textContent += ' - ' + record.feedingType;
    recordsList.appendChild(item);
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Neznama chyba.' }));
    alert(payload.error);
    throw new Error(payload.error);
  }
  if (response.status === 204) return null;
  return response.json();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function addNotification(payload) {
  const item = document.createElement('li');
  item.textContent = payload.title + ': ' + payload.message;
  notificationsList.prepend(item);
}

const socket = io();
socket.on('connected', addNotification);
socket.on('beetle-created', addNotification);
socket.on('beetle-updated', addNotification);
socket.on('beetle-deleted', addNotification);
socket.on('record-created', async (payload) => {
  addNotification(payload);
  await loadBeetles();
  if (selectedBeetleId === payload.beetleId) {
    await showBeetle(selectedBeetleId);
  }
});
socket.on('record-deleted', addNotification);

loadBeetles();
