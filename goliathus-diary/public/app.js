const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutButton = document.getElementById('logout');
const currentUser = document.getElementById('current-user');
const beetleForm = document.getElementById('beetle-form');
const recordForm = document.getElementById('record-form');
const beetleFormTitle = document.getElementById('beetle-form-title');
const beetleSubmit = document.getElementById('beetle-submit');
const beetleCancel = document.getElementById('beetle-cancel');
const recordFormTitle = document.getElementById('record-form-title');
const recordSubmit = document.getElementById('record-submit');
const recordCancel = document.getElementById('record-cancel');
const beetlesList = document.getElementById('beetles');
const recordsList = document.getElementById('records');
const selectedText = document.getElementById('selected');
const notificationsList = document.getElementById('notifications');
const unitRow = document.getElementById('unit-row');
const feedingTypeRow = document.getElementById('feeding-type-row');

const sexLabels = {
  male: 'samec',
  female: 'samice',
  unknown: 'nezname'
};

const recordTypeLabels = {
  feeding: 'krmeni',
  weight: 'vazeni',
  molting: 'svlekani',
  pupation: 'kukleni',
  emergence: 'vylihnuti'
};

let selectedBeetleId = null;
let selectedBeetle = null;
let editingBeetleId = null;
let editingRecordId = null;
let socket = null;

recordForm.elements.happenedAt.max = todayDateValue();
recordForm.elements.happenedAt.value = todayDateValue();
recordForm.elements.type.addEventListener('change', updateRecordFields);
updateRecordFields();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const payload = {
    username: form.get('username'),
    password: form.get('password')
  };

  const session = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  loginForm.reset();
  await enterApp(session.user);
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(registerForm);
  const payload = {
    username: form.get('username'),
    password: form.get('password')
  };

  const session = await request('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  registerForm.reset();
  await enterApp(session.user);
});

logoutButton.addEventListener('click', async () => {
  await request('/api/logout', { method: 'POST' });
  leaveApp();
});

beetleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(beetleForm);
  const photo = form.get('photo');
  const payload = {
    species: form.get('species'),
    sex: form.get('sex'),
    photo: photo && photo.size ? {
      name: photo.name,
      dataUrl: await readFileAsDataUrl(photo)
    } : null
  };

  if (!payload.photo) {
    delete payload.photo;
  }

  const beetle = await request(editingBeetleId ? '/api/beetles/' + editingBeetleId : '/api/beetles', {
    method: editingBeetleId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  resetBeetleForm();
  await loadBeetles();
  await showBeetle(beetle.id);
});

beetleCancel.addEventListener('click', resetBeetleForm);

recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedBeetleId) {
    alert('Nejdrive vyberte jedince.');
    return;
  }

  const form = new FormData(recordForm);
  const type = form.get('type');
  await request(editingRecordId ? '/api/records/' + editingRecordId : '/api/beetles/' + selectedBeetleId + '/records', {
    method: editingRecordId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      happenedAt: form.get('happenedAt'),
      value: type === 'molting' || type === 'pupation' || type === 'emergence' ? null : form.get('value'),
      unit: type === 'weight' ? 'g' : form.get('unit'),
      feedingType: type === 'feeding' ? form.get('feedingType') : null
    })
  });

  resetRecordForm();
  await loadBeetles();
  await showBeetle(selectedBeetleId);
});

recordCancel.addEventListener('click', resetRecordForm);

async function enterApp(user) {
  currentUser.textContent = user.username;
  authSection.hidden = true;
  appSection.hidden = false;
  clearSelectedBeetle();
  notificationsList.innerHTML = '';
  connectSocket();
  await loadBeetles();
}

function leaveApp() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentUser.textContent = '';
  authSection.hidden = false;
  appSection.hidden = true;
  beetlesList.innerHTML = '';
  notificationsList.innerHTML = '';
  clearSelectedBeetle();
  resetBeetleForm();
}

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
  } else {
    valueInput.placeholder = '';
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
    button.textContent = '#' + beetle.id + ' - ' + beetle.species + ' (' + labelFor(sexLabels, beetle.sex) + ', ' + beetle.recordCount + ' zaznamu)';
    button.addEventListener('click', () => showBeetle(beetle.id));
    item.appendChild(button);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Upravit';
    editButton.addEventListener('click', () => editBeetle(beetle.id));
    item.appendChild(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Smazat';
    deleteButton.addEventListener('click', () => deleteBeetle(beetle.id));
    item.appendChild(deleteButton);

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
  selectedBeetle = beetle;
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
    item.textContent = record.happenedAt + ' - ' + labelFor(recordTypeLabels, record.type);
    if (record.value) item.textContent += ' - ' + record.value + (record.unit ? ' ' + record.unit : '');
    if (record.feedingType) item.textContent += ' - ' + record.feedingType;

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = ' Upravit';
    editButton.addEventListener('click', () => editRecord(record));
    item.appendChild(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = ' Smazat';
    deleteButton.addEventListener('click', () => deleteRecord(record.id));
    item.appendChild(deleteButton);

    recordsList.appendChild(item);
  }
}

async function editBeetle(id) {
  const beetle = selectedBeetleId === id && selectedBeetle ? selectedBeetle : await request('/api/beetles/' + id);
  editingBeetleId = beetle.id;
  beetleForm.elements.species.value = beetle.species;
  beetleForm.elements.sex.value = beetle.sex;
  beetleForm.elements.photo.value = '';
  beetleFormTitle.textContent = 'Upravit jedince';
  beetleSubmit.textContent = 'Ulozit jedince';
  beetleCancel.hidden = false;
}

async function deleteBeetle(id) {
  if (!confirm('Opravdu smazat jedince i vsechny jeho zaznamy?')) return;

  await request('/api/beetles/' + id, { method: 'DELETE' });
  if (selectedBeetleId === id) {
    clearSelectedBeetle();
  }
  if (editingBeetleId === id) {
    resetBeetleForm();
  }
  await loadBeetles();
}

function editRecord(record) {
  editingRecordId = record.id;
  recordForm.elements.type.value = record.type;
  recordForm.elements.happenedAt.value = record.happenedAt;
  recordForm.elements.value.value = record.value || '';
  recordForm.elements.unit.value = record.unit || '';
  recordForm.elements.feedingType.value = record.feedingType || '';
  recordFormTitle.textContent = 'Upravit zaznam';
  recordSubmit.textContent = 'Ulozit zaznam';
  recordCancel.hidden = false;
  updateRecordFields();
}

async function deleteRecord(id) {
  if (!confirm('Opravdu smazat zaznam?')) return;

  await request('/api/records/' + id, { method: 'DELETE' });
  await loadBeetles();
  if (selectedBeetleId) {
    await showBeetle(selectedBeetleId);
  }
  if (editingRecordId === id) {
    resetRecordForm();
  }
}

function resetBeetleForm() {
  editingBeetleId = null;
  beetleForm.reset();
  beetleFormTitle.textContent = 'Pridat jedince';
  beetleSubmit.textContent = 'Pridat jedince';
  beetleCancel.hidden = true;
}

function resetRecordForm() {
  editingRecordId = null;
  recordForm.reset();
  recordForm.elements.happenedAt.value = todayDateValue();
  recordFormTitle.textContent = 'Pridat zaznam k vybranemu jedinci';
  recordSubmit.textContent = 'Pridat zaznam';
  recordCancel.hidden = true;
  updateRecordFields();
}

function clearSelectedBeetle() {
  selectedBeetleId = null;
  selectedBeetle = null;
  selectedText.textContent = 'Neni vybran zadny jedinec.';
  recordsList.innerHTML = '';
  resetRecordForm();
}

function labelFor(labels, value) {
  return labels[value] || value;
}

function todayDateValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
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

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connected', addNotification);
  socket.on('beetle-created', async (payload) => {
    addNotification(payload);
    await loadBeetles();
  });
  socket.on('beetle-updated', async (payload) => {
    addNotification(payload);
    await loadBeetles();
    if (selectedBeetleId === payload.beetle.id) {
      await showBeetle(selectedBeetleId);
    }
  });
  socket.on('beetle-deleted', async (payload) => {
    addNotification(payload);
    await loadBeetles();
    if (selectedBeetleId === payload.beetleId) {
      clearSelectedBeetle();
    }
  });
  socket.on('record-created', async (payload) => {
    addNotification(payload);
    await loadBeetles();
    if (selectedBeetleId === payload.beetleId) {
      await showBeetle(selectedBeetleId);
    }
  });
  socket.on('record-updated', async (payload) => {
    addNotification(payload);
    await loadBeetles();
    if (selectedBeetleId === payload.beetleId) {
      await showBeetle(selectedBeetleId);
    }
  });
  socket.on('record-deleted', async (payload) => {
    addNotification(payload);
    await loadBeetles();
    if (selectedBeetleId === payload.beetleId) {
      await showBeetle(selectedBeetleId);
    }
  });
}

request('/api/session')
  .then(async (session) => {
    if (session.user) {
      await enterApp(session.user);
    } else {
      leaveApp();
    }
  })
  .catch(() => leaveApp());
