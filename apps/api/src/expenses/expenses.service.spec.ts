import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();

  const createService = () => {
    const expenses = { db: { startSession: jest.fn() } };
    const journals = { find: jest.fn() };
    const accounting = { postOperationalJournal: jest.fn() };
    return { service: new ExpensesService(expenses as any, accounting as any, journals as any), expenses, accounting, journals };
  };

  it('rejects an invalid tenant before querying the expense reconciliation', async () => {
    const { service, journals } = createService();
    await expect(service.reconciliation('invalid-tenant', {} as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(journals.find).not.toHaveBeenCalled();
  });

  it('rejects an invalid reconciliation date range before querying data', async () => {
    const { service, journals } = createService();
    await expect(service.reconciliation(tenantId, { from: 'not-a-date' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(journals.find).not.toHaveBeenCalled();
  });

  it('rejects invalid tenant and user identities before opening a transaction', async () => {
    const { service, expenses } = createService();
    await expect(service.create('bad-tenant', userId, 'owner', {
      title: 'Internet', category: 'Utilities', amount: 500,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(tenantId, 'bad-user', 'owner', {
      title: 'Internet', category: 'Utilities', amount: 500,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(expenses.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects zero and invalid amounts before opening a transaction', async () => {
    const { service, expenses } = createService();
    await expect(service.create(tenantId, userId, 'owner', {
      title: 'Internet', category: 'Utilities', amount: 0,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(expenses.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects reuse of an expense payment idempotency key with different payment details', () => {
    const { service } = createService();
    const existing = { method: 'UPI', amount: 100, reference: 'UPI-REF-1' };
    expect((service as any).samePayment(existing, {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'UPI', amount: 100, reference: 'UPI-REF-1',
    })).toBe(true);
    expect((service as any).samePayment(existing, {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'CASH', amount: 100, reference: 'UPI-REF-1',
    })).toBe(false);
    expect((service as any).samePayment(existing, {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'UPI', amount: 101, reference: 'UPI-REF-1',
    })).toBe(false);
    expect((service as any).samePayment(existing, {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'UPI', amount: 100, reference: 'OTHER',
    })).toBe(false);
  });

  it('rejects invalid payment IDs and oversized payments before opening a transaction', async () => {
    const { service, expenses } = createService();
    await expect(service.addPayment(tenantId, userId, 'bad-id', {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'UPI', amount: 1,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(expenses.db.startSession).not.toHaveBeenCalled();
  });
});
