import { ConflictException } from '@nestjs/common';
export function terminationDate(
  paidThrough: string | null,
  amount: number | null,
  now = new Date(),
): Date {
  if (amount === 0) return now;
  if (!paidThrough) return now;
  const end = new Date(`${paidThrough}T00:00:00.000-03:00`);
  if (!Number.isFinite(end.getTime()))
    throw new ConflictException('Período pago inválido.');
  return end > now ? end : now;
}
