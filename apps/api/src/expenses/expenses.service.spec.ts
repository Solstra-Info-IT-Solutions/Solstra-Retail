import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();

  const createService = () => {
    const expenses = { db: { startSession: jest.fn() } };
    const accounting = { postOperationalJournal: jest.fn() };
    return { service: new ExpensesService(expenses as any, accounting as any), expenses, accounting };
  };

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

  it('rejects invalid payment IDs and oversized payments before opening a transaction', async () => {
    const { service, expenses } = createService();
    await expect(service.addPayment(tenantId, userId, 'bad-id', {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000', method: 'UPI', amount: 1,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(expenses.db.startSession).not.toHaveBeenCalled();
  });
});
