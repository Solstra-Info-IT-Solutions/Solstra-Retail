import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountingService } from './accounting.service';

describe('AccountingService journal validation', () => {
  const tenantId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const accountId = new Types.ObjectId();

  const makeService = (accounts: any[] = []) => {
    const accountModel = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(accounts) }),
      updateOne: jest.fn(),
      create: jest.fn(),
    };
    const journalModel = { findOne: jest.fn(), create: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };
    return new AccountingService(accountModel as any, journalModel as any);
  };

  it('rejects unbalanced journal entries before persistence', async () => {
    const service = makeService([{ _id: accountId, code: '1000', name: 'Cash' }]);
    await expect(service.createJournal(tenantId, userId, {
      postingDate: '2026-11-12', narration: 'Opening entry',
      lines: [
        { accountId: accountId.toString(), debit: 100, credit: 0 },
        { accountId: accountId.toString(), debit: 0, credit: 90 },
      ],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a journal line with both debit and credit', async () => {
    const service = makeService();
    await expect(service.createJournal(tenantId, userId, {
      postingDate: '2026-11-12', narration: 'Invalid line',
      lines: [
        { accountId: accountId.toString(), debit: 10, credit: 10 },
        { accountId: accountId.toString(), debit: 0, credit: 10 },
      ],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
