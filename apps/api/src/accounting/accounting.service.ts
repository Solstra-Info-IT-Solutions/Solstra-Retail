import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { Account, AccountDocument } from './schemas/account.schema';
import { JournalEntry, JournalEntryDocument } from './schemas/journal-entry.schema';

const DEFAULT_ACCOUNTS = [
  ['1000', 'Cash', 'ASSET'], ['1010', 'Bank', 'ASSET'],
  ['1100', 'Accounts Receivable', 'ASSET'], ['1200', 'Inventory', 'ASSET'],
  ['1300', 'Input GST', 'ASSET'], ['2000', 'Accounts Payable', 'LIABILITY'],
  ['2100', 'Output GST', 'LIABILITY'], ['3000', 'Owner Capital', 'EQUITY'],
  ['3100', 'Retained Earnings', 'EQUITY'], ['4000', 'Sales Revenue', 'INCOME'],
  ['4100', 'Other Income', 'INCOME'], ['5000', 'Cost of Goods Sold', 'EXPENSE'],
  ['5100', 'Purchase Expense', 'EXPENSE'], ['5200', 'Operating Expenses', 'EXPENSE'],
  ['5300', 'Bank Charges', 'EXPENSE'],
] as const;

@Injectable()
export class AccountingService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<AccountDocument>,
    @InjectModel(JournalEntry.name) private readonly journals: Model<JournalEntryDocument>,
  ) {}

  private paise(value: number): number {
    return Math.round((value + Number.EPSILON) * 100);
  }

  private financialYear(date: Date): string {
    const local = new Date(date.getTime() + 330 * 60 * 1000);
    const year = local.getUTCFullYear();
    const start = local.getUTCMonth() >= 3 ? year : year - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
  }

  async listAccounts(tenantId: string, userId: string) {
    this.validateIdentity(tenantId, userId);
    for (const [code, name, type] of DEFAULT_ACCOUNTS) {
      await this.accounts.updateOne(
        tenantFilter(tenantId, { code }),
        { $setOnInsert: {
          code, name, type, description: 'System default account',
          isSystem: true, isActive: true, createdBy: new Types.ObjectId(userId),
        } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
    return this.accounts.find(tenantFilter(tenantId, {}))
      .sort({ code: 1 }).lean();
  }

  async createAccount(tenantId: string, userId: string, dto: CreateAccountDto) {
    this.validateIdentity(tenantId, userId);
    let parentAccountId: Types.ObjectId | null = null;
    if (dto.parentAccountId) {
      if (!Types.ObjectId.isValid(dto.parentAccountId)) {
        throw new BadRequestException('Invalid parent account ID');
      }
      const parent = await this.accounts.findOne(tenantFilter(tenantId, {
        _id: new Types.ObjectId(dto.parentAccountId), isActive: true,
      }));
      if (!parent) throw new NotFoundException('Parent account not found');
      if (parent.type !== dto.type) {
        throw new BadRequestException('Parent and child account types must match');
      }
      parentAccountId = parent._id;
    }
    try {
      return await this.accounts.create({
        tenantId: new Types.ObjectId(tenantId), createdBy: new Types.ObjectId(userId),
        code: dto.code.trim().toUpperCase(), name: dto.name.trim(),
        type: dto.type, description: dto.description?.trim() ?? '',
        parentAccountId, isSystem: false, isActive: true,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('An account with this code already exists');
      }
      throw error;
    }
  }

  async createJournal(tenantId: string, userId: string, dto: CreateJournalEntryDto) {
    this.validateIdentity(tenantId, userId);
    const date = new Date(dto.postingDate);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid posting date');
    if (!dto.narration.trim()) throw new BadRequestException('Narration is required');

    const normalized = dto.lines.map((line) => {
      if (!Types.ObjectId.isValid(line.accountId)) {
        throw new BadRequestException('Invalid account ID');
      }
      const debit = this.paise(line.debit);
      const credit = this.paise(line.credit);
      if (debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new BadRequestException('Each journal line must contain either a positive debit or a positive credit');
      }
      return { accountId: new Types.ObjectId(line.accountId), debit, credit, description: line.description?.trim() ?? '' };
    });

    const accountIds = [...new Set(normalized.map((line) => line.accountId.toString()))];
    const accounts = await this.accounts.find(tenantFilter(tenantId, {
      _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) }, isActive: true,
    })).lean();
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One or more accounts are inactive or do not belong to this business');
    }
    const accountMap = new Map(accounts.map((account) => [account._id.toString(), account]));
    const totalDebitPaise = normalized.reduce((sum, line) => sum + line.debit, 0);
    const totalCreditPaise = normalized.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebitPaise <= 0 || totalDebitPaise !== totalCreditPaise) {
      throw new BadRequestException('Journal entry is not balanced: total debit must equal total credit');
    }

    const sourceType = dto.sourceType ?? 'MANUAL';
    const sourceId = dto.sourceId?.trim() || null;
    if (sourceId) {
      const existing = await this.journals.findOne(tenantFilter(tenantId, { sourceType, sourceId })).lean();
      if (existing) throw new ConflictException('A journal entry already exists for this source');
    }

    const objectId = new Types.ObjectId();
    const entryNumber = `JV/${this.financialYear(date)}/${objectId.toString().slice(-8).toUpperCase()}`;
    const lines = normalized.map((line) => {
      const account = accountMap.get(line.accountId.toString())!;
      return {
        accountId: line.accountId, accountCode: account.code, accountName: account.name,
        debit: line.debit / 100, credit: line.credit / 100, description: line.description,
      };
    });
    try {
      return await this.journals.create({
        _id: objectId, tenantId: new Types.ObjectId(tenantId), entryNumber,
        postingDate: date, financialYear: this.financialYear(date),
        narration: dto.narration.trim(), sourceType, sourceId, lines,
        totalDebit: totalDebitPaise / 100, totalCredit: totalCreditPaise / 100,
        status: 'POSTED', createdBy: new Types.ObjectId(userId), postedAt: new Date(),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Duplicate journal source or entry number');
      }
      throw error;
    }
  }

  async listJournals(tenantId: string, page = 1, limit = 20) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const filter = tenantFilter(tenantId, {});
    const [items, total] = await Promise.all([
      this.journals.find(filter).sort({ postingDate: -1, createdAt: -1 })
        .skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      this.journals.countDocuments(filter),
    ]);
    return { items, pagination: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) } };
  }

  async reverseJournal(tenantId: string, userId: string, id: string, reason: string) {
    this.validateIdentity(tenantId, userId);
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid journal entry ID');
    if (!reason?.trim()) throw new BadRequestException('Reversal reason is required');
    const original = await this.journals.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }));
    if (!original) throw new NotFoundException('Journal entry not found');
    if (original.status !== 'POSTED' || original.reversalOf) {
      throw new ConflictException('Only an unreversed posted journal can be reversed');
    }
    const reversalId = new Types.ObjectId();
    const reversalNumber = `JV/${this.financialYear(new Date())}/${reversalId.toString().slice(-8).toUpperCase()}`;
    const reversed = await this.journals.create({
      _id: reversalId, tenantId: new Types.ObjectId(tenantId), entryNumber: reversalNumber,
      postingDate: new Date(), financialYear: this.financialYear(new Date()),
      narration: `Reversal of ${original.entryNumber}: ${reason.trim()}`,
      sourceType: 'REVERSAL', sourceId: original._id.toString(),
      lines: original.lines.map((line) => ({
        accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName,
        debit: line.credit, credit: line.debit, description: `Reversal: ${line.description ?? ''}`,
      })),
      totalDebit: original.totalCredit, totalCredit: original.totalDebit,
      status: 'POSTED', reversalOf: original._id,
      createdBy: new Types.ObjectId(userId), postedAt: new Date(),
    });
    const updated = await this.journals.findOneAndUpdate(
      tenantFilter(tenantId, { _id: original._id, status: 'POSTED', reversedBy: null }),
      { $set: { status: 'REVERSED', reversedBy: reversed._id } },
      { new: true },
    );
    if (!updated) {
      await this.journals.deleteOne(tenantFilter(tenantId, { _id: reversed._id }));
      throw new ConflictException('Journal was reversed by another request; retry after refreshing');
    }
    return { original: updated, reversal: reversed };
  }

  private validateIdentity(tenantId: string, userId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or user identity');
    }
  }
}
