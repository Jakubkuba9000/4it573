# Goliathus denik

Semestralni aplikace v Node.js pro vedeni chovatelskeho deniku brouku rodu Goliathus.

## Funkce

- sprava jedincu: druh, pohlavi, fotka
- uprava a mazani jedincu
- zaznamy k jedincum: krmeni, vazeni, svlekani, kukleni a vylihnuti
- uprava a mazani zaznamu
- krmeni uklada hodnotu, jednotku a typ krmeni
- vazeni uklada hodnotu v gramech
- svlekani, kukleni a vylihnuti ukladaji jen datum
- export celeho deniku do JSON nebo CSV
- zive notifikace pres Socket.IO pri dulezitych udalostech
- ukladani fotek do souboru a dat do SQLite databaze
- jednoducha HTML stranka pro ovladani aplikace

## Spusteni

```bash
npm install
npm start
```

Aplikace potom bezi na adrese `http://127.0.0.1:3000`.

## API endpointy

### Stav serveru

```http
GET /api/health
```

### Jedinci

```http
GET /api/beetles
POST /api/beetles
GET /api/beetles/:id
PUT /api/beetles/:id
DELETE /api/beetles/:id
```

Ukazka tela pro vytvoreni jedince:

```json
{
  "species": "Goliathus goliatus",
  "sex": "female",
  "photo": {
    "name": "larva.jpg",
    "dataUrl": "data:image/jpeg;base64,..."
  }
}
```

`sex` muze byt `male`, `female` nebo `unknown`.
Fotka musi byt poslana jako base64 data URL, muze mit maximalne 5 MB a podporovane typy jsou JPEG, PNG, GIF a WebP.

### Zaznamy

```http
POST /api/beetles/:id/records
PUT /api/records/:id
DELETE /api/records/:id
```

Ukazka tela pro vytvoreni zaznamu:

```json
{
  "type": "weight",
  "happenedAt": "2026-05-20",
  "value": "38"
}
```

Ukazka krmeni:

```json
{
  "type": "feeding",
  "happenedAt": "2026-05-21",
  "value": "2",
  "unit": "ks",
  "feedingType": "banan"
}
```

Ukazka datumove udalosti:

```json
{
  "type": "molting",
  "happenedAt": "2026-05-22"
}
```

`type` muze byt `feeding`, `weight`, `molting`, `pupation` nebo `emergence`.
`happenedAt` musi byt platne datum ve formatu `RRRR-MM-DD` a nesmi byt v budoucnosti.

### Export

```http
GET /api/export.json
GET /api/export.csv
```

### Websockety

Server pouziva Socket.IO a emituje udalosti:

- `connected`
- `beetle-created`
- `beetle-updated`
- `beetle-deleted`
- `record-created`
- `record-updated`
- `record-deleted`

## Testy

```bash
npm test
```

## Struktura projektu

- `src/server.js` spousti HTTP server a websockety
- `src/app.js` definuje Express aplikaci a API endpointy
- `src/db.js` pracuje se SQLite databazi
- `public/index.html` je jednoducha HTML stranka pro ovladani aplikace
- `data/` vznikne pri spusteni a obsahuje databazi
- `uploads/` vznikne pri nahrani fotek
- `test/` obsahuje automatizovane testy
