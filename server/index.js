import { createServer as httpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipient = 'info@uhlenkoeper-camp.de';
const types = { strom: ['Strom', 'kWh'], wasser: ['Wasser', 'm³'], gas: ['Gas', 'm³'] };
const maxRequest = 12 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest();
const failure = (status, message) => Object.assign(new Error(message), { status });

function body(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxRequest) {
        if (!exceeded) reject(failure(413, 'Die Erfassung ist zu groß. Bitte insgesamt höchstens 8 MB an verkleinerten Fotos übermitteln.'));
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(failure(400, 'Die übermittelten Daten sind ungültig.')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(failure(400, 'Übermittlung abgebrochen.')));
  });
}

function validate(input) {
  if (!input || typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
    throw failure(400, 'Ungültige Erfassungsnummer.');
  }
  if (!Array.isArray(input.readings) || input.readings.length < 1 || input.readings.length > 50) throw failure(400, 'Bitte zwischen 1 und 50 Ablesungen übermitteln.');
  let total = 0;
  const ids = new Set();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  const readings = input.readings.map(record => {
    if (!record || !Number.isSafeInteger(record.localId) || record.localId < 1 || ids.has(record.localId)) throw failure(400, 'Ungültige oder doppelte Ablesungsnummer.');
    ids.add(record.localId);
    if (!Object.hasOwn(types, record.type) || typeof record.meter !== 'string' || !record.meter.trim() || record.meter.length > 80) throw failure(400, 'Zählerart oder Zählernummer fehlt.');
    if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date)) || new Date(record.date).toISOString().slice(0, 10) !== record.date || record.date > today) throw failure(400, 'Ungültiges Ablesedatum.');
    if (typeof record.value !== 'number' || !Number.isFinite(record.value) || record.value < 0 || record.value > Number.MAX_SAFE_INTEGER) throw failure(400, 'Ungültiger Zählerstand.');
    if (typeof record.note !== 'string' || record.note.length > 500) throw failure(400, 'Die Notiz ist zu lang.');
    if (typeof record.photo !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.photo)) throw failure(400, 'Ein Zählerfoto fehlt oder ist ungültig.');
    const photo = Buffer.from(record.photo, 'base64');
    if (photo.toString('base64') !== record.photo || photo.length < 5 || photo[0] !== 0xff || photo[1] !== 0xd8 || photo[2] !== 0xff || photo.at(-2) !== 0xff || photo.at(-1) !== 0xd9) throw failure(400, 'Bitte ein JPEG-Foto je Ablesung übermitteln.');
    total += photo.length;
    if (total > 8 * 1024 * 1024) throw failure(413, 'Die Fotos sind zusammen größer als 8 MB. Bitte kleinere Fotos verwenden.');
    return { localId: record.localId, type: record.type, meter: record.meter.trim(), date: record.date, value: record.value, note: record.note.trim(), photo };
  });
  if (typeof input.receiptToken !== 'string' || !/^[0-9a-f-]{72}$/i.test(input.receiptToken)) throw failure(400, 'Die automatische Empfangsbestätigung fehlt. Bitte die Seite neu laden.');
  return { id: input.id.toLowerCase(), receiptToken: input.receiptToken, readings };
}

function csv(readings) {
  const cell = value => `"${String(value).replace(/^\s*[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
  return '\uFEFF' + [['Zählerart', 'Zählernummer / Standort', 'Datum', 'Stand', 'Einheit', 'Notiz'], ...readings.map(r => [types[r.type][0], r.meter, r.date, String(r.value).replace('.', ','), types[r.type][1], r.note])].map(row => row.map(cell).join(';')).join('\r\n');
}

export function createMeterServer({ dataDir, accessCode, transport, from, allowedOrigin = '' }) {
  if (accessCode && accessCode.length < 20) throw new Error('Ein optionaler Verwaltungsschlüssel muss mindestens 20 Zeichen enthalten.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'readings.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, digest TEXT NOT NULL, created_at TEXT NOT NULL,
      state TEXT NOT NULL, metadata TEXT NOT NULL, sent_at TEXT, mail_id TEXT, receipt_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
      submission_id TEXT NOT NULL REFERENCES submissions(id), position INTEGER NOT NULL,
      jpeg BLOB NOT NULL, PRIMARY KEY(submission_id, position)
    );`);
  if (!db.prepare('PRAGMA table_info(submissions)').all().some(column => column.name === 'receipt_hash')) db.exec('ALTER TABLE submissions ADD COLUMN receipt_hash TEXT');
  // If a process stopped during SMTP submission, delivery cannot be inferred.
  db.prepare("UPDATE submissions SET state='uncertain' WHERE state='sending'").run();
  const passwordHash = accessCode ? hash(accessCode) : null;
  const attempts = new Map();
  const ready = Boolean(transport && from);

  const server = httpServer(async (req, res) => {
    const origin = req.headers.origin;
    // Only configured origins may use the API from another website.
    const ownOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const originAllowed = !origin || origin === ownOrigin || (allowedOrigin && origin === allowedOrigin);
    const cors = origin && originAllowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors });
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/script.js': ['script.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
        const asset = assets[path];
        if (req.method !== 'GET' || !asset) return reply(404, { error: 'Nicht gefunden.' });
        res.writeHead(200, { 'Content-Type': asset[1], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
        return res.end(readFileSync(resolve(root, asset[0])));
      }
      if (!originAllowed) return reply(403, { error: 'Diese Seitenadresse darf den Dienst nicht verwenden.' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
      if (path === '/api/status' && req.method === 'GET') return reply(200, { storageReady: true, mailReady: ready, recipient });
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const admin = passwordHash && timingSafeEqual(hash(token), passwordHash);
      const summary = row => ({ id: row.id, createdAt: row.created_at, status: row.state, sentAt: row.sent_at, readings: JSON.parse(row.metadata) });
      if (path === '/api/submissions' && req.method === 'GET') {
        if (!admin) return reply(401, { error: 'Die Gesamtübersicht ist nur für die Verwaltung verfügbar.' });
        const rows = db.prepare('SELECT id, created_at, state, metadata, sent_at FROM submissions ORDER BY created_at DESC LIMIT 100').all();
        return reply(200, { submissions: rows.map(summary) });
      }
      const photoPath = path.match(/^\/api\/submissions\/([0-9a-f-]{36})\/photos\/(\d+)$/);
      const submissionPath = path.match(/^\/api\/submissions\/([0-9a-f-]{36})$/);
      if ((photoPath || submissionPath) && req.method === 'GET') {
        const row = db.prepare('SELECT * FROM submissions WHERE id=?').get((photoPath || submissionPath)[1]);
        const ownReceipt = row?.receipt_hash && timingSafeEqual(hash(token), Buffer.from(row.receipt_hash, 'hex'));
        if (!row || (!admin && !ownReceipt)) return reply(404, { error: 'Erfassung nicht verfügbar.' });
        if (submissionPath) return reply(200, { submission: summary(row) });
      }
      if (photoPath && req.method === 'GET') {
        const photo = db.prepare('SELECT jpeg FROM photos WHERE submission_id=? AND position=?').get(photoPath[1], Number(photoPath[2]));
        if (!photo) return reply(404, { error: 'Foto nicht gefunden.' });
        res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="zaehler-${photoPath[1]}-${photoPath[2]}.jpg"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(photo.jpeg);
      }
      if (path !== '/api/submissions' || req.method !== 'POST') return reply(404, { error: 'Nicht gefunden.' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) throw failure(415, 'Bitte JSON übermitteln.');
      const batch = validate(await body(req));
      const metadata = batch.readings.map(({ photo, ...record }) => record);
      const digest = hash(JSON.stringify(metadata) + batch.readings.map(r => hash(r.photo).toString('hex')).join('')).toString('hex');
      let row = db.prepare('SELECT * FROM submissions WHERE id=?').get(batch.id);
      const receiptHash = hash(batch.receiptToken).toString('hex');
      if (row && row.receipt_hash !== receiptHash) throw failure(404, 'Erfassung nicht verfügbar.');
      if (row && row.digest !== digest) throw failure(409, 'Diese Erfassungsnummer gehört bereits zu anderen Daten.');
      if (!row) {
        // Bound public submissions; retries of an existing collection keep its ID.
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const entry = attempts.get(ip) || { count: 0, until: now + 3600000 };
        if (entry.count >= 30 || attempts.size >= 10000) return reply(429, { error: 'Zurzeit wurden zu viele Erfassungen übermittelt. Bitte später erneut versuchen.' });
        attempts.set(ip, { count: entry.count + 1, until: entry.until });
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare("INSERT INTO submissions(id,digest,created_at,state,metadata,receipt_hash) VALUES(?,?,?,'stored',?,?)").run(batch.id, digest, new Date().toISOString(), JSON.stringify(metadata), receiptHash);
          batch.readings.forEach((r, index) => db.prepare('INSERT INTO photos(submission_id,position,jpeg) VALUES(?,?,?)').run(batch.id, index, r.photo));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        row = db.prepare('SELECT * FROM submissions WHERE id=?').get(batch.id);
      }
      const result = status => ({ id: batch.id, stored: true, status, sentAt: row.sent_at || null });
      if (row.state === 'sent') return reply(200, result('sent'));
      if (row.state === 'uncertain') return reply(200, { ...result('uncertain'), error: 'Die Daten sind gespeichert. Der Versandstatus ist unklar; bitte im Camp-Postfach prüfen. Es wird keine zweite E-Mail automatisch ausgelöst.' });
      if (row.state === 'sending') return reply(202, result('sending'));
      if (!ready) return reply(200, { ...result('stored'), error: 'Daten und Fotos sind zentral gespeichert. Der E-Mail-Versand muss noch eingerichtet werden.' });
      const locked = db.prepare("UPDATE submissions SET state='sending' WHERE id=? AND state='stored'").run(batch.id);
      if (!locked.changes) return reply(202, result('sending'));
      try {
        const lines = batch.readings.map((r, index) => `${index + 1}. ${types[r.type][0]} · ${r.meter}\nDatum: ${r.date}\nStand: ${r.value.toLocaleString('de-DE', { maximumFractionDigits: 6 })} ${types[r.type][1]}${r.note ? `\nNotiz: ${r.note}` : ''}`).join('\n\n');
        const mail = await transport.sendMail({
          from, to: recipient,
          subject: `Zählerablesung Uhlenköper-Camp · ${batch.readings.length} Ablesung(en) · ${batch.id}`,
          text: `Die Erfassung ist abgeschlossen.\nErfassungsnummer: ${batch.id}\n\n${lines}\n\nDie Zählerfotos und eine CSV-Übersicht sind angehängt.`,
          attachments: [{ filename: `ablesungen-${batch.id}.csv`, content: Buffer.from(csv(batch.readings)), contentType: 'text/csv; charset=utf-8' }, ...batch.readings.map((r, i) => ({ filename: `zaehler-${i + 1}-${r.date}.jpg`, content: r.photo, contentType: 'image/jpeg' }))]
        });
        if (!mail.accepted?.some(address => String(address).toLowerCase() === recipient)) throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' });
        row.sent_at = new Date().toISOString();
        db.prepare("UPDATE submissions SET state='sent',sent_at=?,mail_id=? WHERE id=?").run(row.sent_at, mail.messageId || '', batch.id);
        return reply(200, result('sent'));
      } catch (error) {
        const rejected = ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNECTION'].includes(error.code) || Number(error.responseCode) >= 400;
        const state = rejected ? 'stored' : 'uncertain';
        db.prepare('UPDATE submissions SET state=? WHERE id=?').run(state, batch.id);
        return reply(200, { ...result(state), error: rejected ? 'Daten und Fotos sind gespeichert. Der Mailanbieter hat den Versand abgelehnt. Bitte die Versandeinstellungen prüfen und erneut versuchen.' : 'Daten und Fotos sind gespeichert. Der Versandstatus ist unklar. Bitte im Camp-Postfach prüfen, bevor erneut versendet wird.' });
      }
    } catch (error) {
      // Provider messages and credentials are never returned to browsers.
      reply(error.status || 500, { error: error.status ? error.message : 'Die Erfassung konnte nicht abgeschlossen werden. Bitte später erneut versuchen.' });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.on('close', () => { db.close(); if (transport?.close) transport.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const smtpReady = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM;
  const transport = smtpReady ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000
  }) : null;
  const server = createMeterServer({ dataDir: resolve(env.DATA_DIR || './data'), accessCode: env.METER_ADMIN_CODE || env.METER_ACCESS_CODE, transport, from: env.SMTP_FROM, allowedOrigin: env.ALLOWED_ORIGIN || '' });
  server.listen(Number(env.PORT || 8000), env.HOST || '127.0.0.1', () => console.log('Zählerdienst gestartet. Versand:', smtpReady ? 'konfiguriert' : 'noch nicht konfiguriert'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
