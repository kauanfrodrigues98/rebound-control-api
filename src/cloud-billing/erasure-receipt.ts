import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
export interface ErasureReceipt {
  version: 1;
  accountUuid: string;
  terminationId: string;
  effectiveAt: string;
  preserveUntil: string;
  erasedAt: string;
  signature: string;
}
export function receiptPayload(r: Omit<ErasureReceipt, 'signature'>): string {
  return JSON.stringify([
    r.version,
    r.accountUuid,
    r.terminationId,
    r.effectiveAt,
    r.preserveUntil,
    r.erasedAt,
  ]);
}
export function receiptSecret(): string {
  const key = process.env.DATA_ERASURE_LEDGER_SECRET;
  if (!key || Buffer.byteLength(key) < 32)
    throw new Error(
      'Configure DATA_ERASURE_LEDGER_SECRET com pelo menos 32 bytes.',
    );
  return key;
}
export function signReceipt(
  r: Omit<ErasureReceipt, 'signature'>,
): ErasureReceipt {
  return {
    ...r,
    signature: createHmac('sha256', receiptSecret())
      .update(receiptPayload(r))
      .digest('hex'),
  };
}
export function verifyReceipt(value: unknown): ErasureReceipt {
  if (!value || typeof value !== 'object')
    throw new Error('Registro de exclusão inválido.');
  const r = value as ErasureReceipt,
    uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    r.version !== 1 ||
    typeof r.accountUuid !== 'string' ||
    !uuid.test(r.accountUuid) ||
    typeof r.terminationId !== 'string' ||
    !uuid.test(r.terminationId) ||
    ![r.effectiveAt, r.preserveUntil, r.erasedAt].every(
      (d) => typeof d === 'string' && Number.isFinite(Date.parse(d)),
    ) ||
    Date.parse(r.preserveUntil) < Date.parse(r.effectiveAt) + 30 * 86400000 ||
    Date.parse(r.erasedAt) < Date.parse(r.preserveUntil) ||
    typeof r.signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.signature)
  )
    throw new Error('Registro de exclusão inválido.');
  const expected = signReceipt(r).signature;
  if (
    !timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(r.signature, 'hex'),
    )
  )
    throw new Error('Assinatura do registro de exclusão inválida.');
  return r;
}

export function receiptArchiveReady(): boolean {
  return (
    !!process.env.DATA_ERASURE_LEDGER_DIR &&
    Buffer.byteLength(process.env.DATA_ERASURE_LEDGER_SECRET ?? '') >= 32
  );
}
export async function archiveReceipt(record: ErasureReceipt): Promise<void> {
  const directory = process.env.DATA_ERASURE_LEDGER_DIR;
  if (!directory || !path.isAbsolute(directory))
    throw new Error('Configure diretório externo de registros de exclusão.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${record.terminationId}.json`),
    temporary = path.join(directory, `.receipt-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(record) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = verifyReceipt(
        JSON.parse(await fs.readFile(file, 'utf8')),
      );
      if (
        receiptPayload({ ...existing, erasedAt: record.erasedAt }) !==
        receiptPayload(record)
      )
        throw new Error('Registro de exclusão divergente.');
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
