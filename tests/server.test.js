import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { createMeterServer } from '../server/index.js';

const code = 'test-access-code-at-least-20-characters';
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217]);
const payload = () => ({ id: randomUUID(), readings: [{ localId: 1, type: 'strom', meter: 'Stellplatz 12', date: '2026-01-01', value: 1234.56, note: '=example', photo: jpeg.toString('base64') }] });

async function fixture(t, options = {}) {
  const dataDir = options.dataDir || mkdtempSync(join(tmpdir(), 'meter-test-'));
  const server = createMeterServer({ dataDir, accessCode: code, from: 'camp@example.test', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (!options.dataDir) rmSync(dataDir, { recursive: true, force: true });
  });
  async function request(path, body, headers = {}) {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${code}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  return { server, origin, dataDir, request };
}

test('completion persists values/photos before a single mail, includes attachments, survives restart', async t => {
  let calls = 0;
  let mime;
  let storedBeforeMail = false;
  let dataDir;
  const mailer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const transport = { async sendMail(message) {
    calls++;
    assert.equal(message.to, 'info@uhlenkoeper-camp.de');
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(message.attachments[1].content, jpeg);
    assert.match(message.attachments[0].content.toString(), /'=example/);
    const check = new DatabaseSync(join(dataDir, 'readings.sqlite'));
    storedBeforeMail = check.prepare('SELECT count(*) AS count FROM photos').get().count === 1;
    check.close();
    const result = await mailer.sendMail(message);
    mime = result.message.toString();
    return { accepted: ['info@uhlenkoeper-camp.de'], messageId: result.messageId };
  } };
  const app = await fixture(t, { transport });
  dataDir = app.dataDir;
  const batch = payload();
  let result = await app.request('/api/submissions', batch);
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'sent');
  assert.ok(result.data.sentAt);
  assert.ok(storedBeforeMail);
  assert.match(mime, /To: info@uhlenkoeper-camp.de/);
  assert.match(mime, /Content-Type: image\/jpeg/);
  assert.match(mime, /text\/csv/);
  result = await app.request('/api/submissions', batch);
  assert.equal(result.data.status, 'sent');
  assert.equal(calls, 1, 'repeated completion does not resend');
  const conflict = structuredClone(batch);
  conflict.readings[0].value = 9;
  assert.equal((await app.request('/api/submissions', conflict)).status, 409);
  const archive = await app.request('/api/submissions');
  assert.equal(archive.data.submissions.length, 1);
  assert.equal(archive.data.submissions[0].readings[0].meter, 'Stellplatz 12');
  const photo = await fetch(`${app.origin}/api/submissions/${batch.id}/photos/0`, { headers: { Authorization: `Bearer ${code}` } });
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), jpeg);
  const restarted = await fixture(t, { dataDir, transport });
  assert.equal((await restarted.request('/api/submissions', batch)).data.status, 'sent');
  assert.equal(calls, 1, 'stored state prevents duplicate mail in another process instance');
});

test('authorization, origin and input validation protect the archive and writes', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/submissions', undefined, { Authorization: '' })).status, 401);
  assert.equal((await app.request('/api/submissions', payload(), { Origin: 'https://untrusted.example' })).status, 403);
  const invalids = [
    batch => { batch.id = '../invalid'; },
    batch => { batch.readings = []; },
    batch => { batch.readings[0].meter = '   '; },
    batch => { batch.readings[0].type = '__proto__'; },
    batch => { batch.readings[0].date = '2026-02-30'; },
    batch => { batch.readings[0].date = '2999-01-01'; },
    batch => { batch.readings[0].value = -1; },
    batch => { batch.readings[0].note = 'x'.repeat(501); },
    batch => { batch.readings[0].photo = Buffer.from('<script>').toString('base64'); },
    batch => { batch.readings.push({ ...batch.readings[0] }); }
  ];
  for (const mutate of invalids) {
    const batch = payload();
    mutate(batch);
    assert.equal((await app.request('/api/submissions', batch)).status, 400);
  }
  assert.equal((await app.request('/api/submissions')).data.submissions.length, 0);
  assert.equal((await fetch(app.origin + '/.env')).status, 404);
  assert.equal((await fetch(app.origin + '/data/readings.sqlite')).status, 404);
});

test('without mail configuration storage succeeds but no delivery success is reported', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/status')).data.mailReady, false);
  const response = await app.request('/api/submissions', payload());
  assert.equal(response.data.stored, true);
  assert.equal(response.data.status, 'stored');
  assert.equal(response.data.sentAt, null);
  assert.match(response.data.error, /eingerichtet/);
});

test('known mail rejection preserves data and permits retry with the same collection', async t => {
  let calls = 0;
  const app = await fixture(t, { transport: { async sendMail() {
    calls++;
    if (calls === 1) throw Object.assign(new Error('private provider detail'), { code: 'EAUTH' });
    return { accepted: ['info@uhlenkoeper-camp.de'], messageId: 'test' };
  } } });
  const batch = payload();
  const first = await app.request('/api/submissions', batch);
  assert.equal(first.data.status, 'stored');
  assert.equal(first.data.stored, true);
  assert.doesNotMatch(JSON.stringify(first), /private provider detail/);
  assert.equal((await app.request('/api/submissions', batch)).data.status, 'sent');
  assert.equal((await app.request('/api/submissions')).data.submissions.length, 1);
});

test('uncertain SMTP result does not trigger a second mail', async t => {
  let calls = 0;
  const app = await fixture(t, { transport: { async sendMail() { calls++; throw new Error('Connection lost during DATA'); } } });
  const batch = payload();
  assert.equal((await app.request('/api/submissions', batch)).data.status, 'uncertain');
  assert.equal((await app.request('/api/submissions', batch)).data.status, 'uncertain');
  assert.equal(calls, 1);
});

test('simultaneous completion requests share one in-flight mail', async t => {
  let release;
  let calls = 0;
  const app = await fixture(t, { transport: { async sendMail() { calls++; await new Promise(resolve => { release = resolve; }); return { accepted: ['info@uhlenkoeper-camp.de'], messageId: 'test' }; } } });
  const batch = payload();
  const first = app.request('/api/submissions', batch);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  const second = await app.request('/api/submissions', batch);
  assert.equal(second.status, 202);
  assert.equal(second.data.status, 'sending');
  release();
  assert.equal((await first).data.status, 'sent');
  assert.equal(calls, 1);
});
