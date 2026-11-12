/**
 * The on-device encryption self-test's logic, against SYNTHETIC fakes of the op-sqlite API (the real
 * native module only exists on a phone). Proves the test fails when SQLCipher is absent or a wrong
 * key can read the data — it can never report "encrypted" without those checks passing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { runEncryptionSelfTest } from '../../mobile/src/storage/encryptionSelfTest.ts';
import type { OpSqliteOpen } from '../../mobile/src/storage/drivers/opSqlite.ts';

const rb = (n: number) => new Uint8Array(randomBytes(n));
const now = () => '2026-11-12T12:00:00.000Z';

/** SYNTHETIC fake: a file store keyed by name; `encrypted` decides whether keys are enforced. */
function fakeOpen(o: { cipher: string; encrypted: boolean }): OpSqliteOpen & { files: Map<string, unknown> } {
  const files = new Map<string, { key: string; rows: { v: string }[] }>();
  const open = ((opts: { name: string; encryptionKey: string }) => {
    const f = files.get(opts.name) ?? { key: opts.encryptionKey, rows: [] };
    files.set(opts.name, f);
    const locked = o.encrypted && f.key !== opts.encryptionKey;
    return {
      async execute(sql: string, params: (string | number | null)[] = []) {
        if (/cipher_version/.test(sql)) return { rows: [{ cipher_version: o.cipher }], rowsAffected: 0 };
        if (locked) throw new Error('file is not a database');
        if (/^INSERT/.test(sql)) f.rows.push({ v: String(params[0]) });
        if (/^DELETE/.test(sql)) f.rows = [];
        if (/^SELECT/.test(sql)) return { rows: f.rows.map((r) => ({ ...r })), rowsAffected: 0 };
        return { rows: [], rowsAffected: 0 };
      },
      close() {},
      delete() {
        files.delete(opts.name);
      },
    };
  }) as unknown as OpSqliteOpen & { files: Map<string, unknown> };
  open.files = files;
  return open;
}

test('passes only when SQLCipher is present and a different key cannot read the data', async () => {
  const open = fakeOpen({ cipher: '4.6.1 community', encrypted: true });
  const r = await runEncryptionSelfTest(open, rb, now);
  assert.equal(r.passed, true, JSON.stringify(r.steps));
  assert.equal(open.files.size, 0, 'test database deleted');
});

test('fails when SQLCipher is not compiled in (plain SQLite ignores the key)', async () => {
  const r = await runEncryptionSelfTest(fakeOpen({ cipher: '', encrypted: false }), rb, now);
  assert.equal(r.passed, false);
  assert.ok(r.steps.some((s) => s.name === 'SQLCipher compiled in' && !s.passed));
  assert.ok(r.steps.some((s) => s.name === 'Unreadable with a different key' && !s.passed));
});

test('fails when the open function throws', async () => {
  const r = await runEncryptionSelfTest((() => { throw new Error('native module missing'); }) as OpSqliteOpen, rb, now);
  assert.equal(r.passed, false);
});
