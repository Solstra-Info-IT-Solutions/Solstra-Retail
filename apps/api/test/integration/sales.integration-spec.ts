import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as dotenv from 'dotenv';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { SalesService } from '../../src/sales/sales.service';
import { AccountingService } from '../../src/accounting/accounting.service';
import { TaxPeriodsService } from '../../src/accounting/tax-periods.service';
import { TaxPeriod, TaxPeriodSchema } from '../../src/accounting/schemas/tax-period.schema';
import { Account, AccountSchema } from '../../src/accounting/schemas/account.schema';
import { JournalEntry, JournalEntrySchema } from '../../src/accounting/schemas/journal-entry.schema';
import { CreateSaleDto } from '../../src/sales/dto/create-sale.dto';
import { CreateCreditNoteDto } from '../../src/sales/dto/create-credit-note.dto';

import { Product, ProductSchema } from '../../src/products/schemas/product.schema';
import { Tenant, TenantSchema } from '../../src/tenants/schemas/tenant.schema';
import {
  InventoryMovement,
  InventoryMovementSchema,
} from '../../src/inventory/schemas/inventory-movement.schema';
import {
  SalesInvoice,
  SalesInvoiceSchema,
} from '../../src/sales/schemas/sales-invoice.schema';
import {
  InvoiceCounter,
  InvoiceCounterSchema,
} from '../../src/sales/schemas/invoice-counter.schema';
import {
  CreditNote,
  CreditNoteSchema,
} from '../../src/sales/schemas/credit-note.schema';
import {
  CreditNoteCounter,
  CreditNoteCounterSchema,
} from '../../src/sales/schemas/credit-note-counter.schema';

// Load only the API environment file. Never fall back to MONGODB_URI.
const envCandidates = [
  resolve(process.cwd(), 'apps/api/.env'),
  resolve(process.cwd(), '.env'),
];

const envFile = envCandidates.find((candidate) => existsSync(candidate));

if (envFile) {
  dotenv.config({ path: envFile, override: false });
}

describe('SalesService MongoDB integration', () => {
  let connection: Connection;

  let ProductModel: Model<Product>;
  let TenantModel: Model<Tenant>;
  let MovementModel: Model<InventoryMovement>;
  let InvoiceModel: Model<SalesInvoice>;
  let CounterModel: Model<InvoiceCounter>;
  let CreditNoteModel: Model<CreditNote>;
  let CreditNoteCounterModel: Model<CreditNoteCounter>;
  let AccountModel: Model<Account>;
  let JournalEntryModel: Model<JournalEntry>;
  let TaxPeriodModel: Model<TaxPeriod>;

  let service: SalesService;
  let tenantId: Types.ObjectId;
  let userId: Types.ObjectId;
  let productId: Types.ObjectId;

  beforeAll(async () => {
    const uri = process.env.TEST_MONGODB_URI;

    if (!uri) {
      throw new Error(
        'TEST_MONGODB_URI is required. Integration tests will not use MONGODB_URI.',
      );
    }

    let parsedUri: URL;

    try {
      parsedUri = new URL(uri);
    } catch {
      throw new Error('TEST_MONGODB_URI is not a valid MongoDB URI.');
    }

    if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol)) {
      throw new Error('Unsupported test MongoDB protocol.');
    }

    const databaseName = decodeURIComponent(
      parsedUri.pathname.replace(/^\/+/, ''),
    );

    if (databaseName !== 'solstra_retail_test') {
      throw new Error(
        `Unsafe integration database "${databaseName}". Expected solstra_retail_test. No connection opened.`,
      );
    }

    connection = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 15000,
      autoIndex: false,
    }).asPromise();

    ProductModel = connection.model<Product>(Product.name, ProductSchema);
    TenantModel = connection.model<Tenant>(Tenant.name, TenantSchema);
    MovementModel = connection.model<InventoryMovement>(
      InventoryMovement.name,
      InventoryMovementSchema,
    );
    InvoiceModel = connection.model<SalesInvoice>(
      SalesInvoice.name,
      SalesInvoiceSchema,
    );
    CounterModel = connection.model<InvoiceCounter>(
      InvoiceCounter.name,
      InvoiceCounterSchema,
    );
    CreditNoteModel = connection.model<CreditNote>(
      CreditNote.name,
      CreditNoteSchema,
    );
    CreditNoteCounterModel = connection.model<CreditNoteCounter>(
      CreditNoteCounter.name,
      CreditNoteCounterSchema,
    );
    AccountModel = connection.model<Account>(Account.name, AccountSchema);
    JournalEntryModel = connection.model<JournalEntry>(JournalEntry.name, JournalEntrySchema);
    TaxPeriodModel = connection.model<TaxPeriod>(TaxPeriod.name, TaxPeriodSchema);

    // Build only the indexes declared by these test models.
    await Promise.all([
      ProductModel.createIndexes(),
      TenantModel.createIndexes(),
      MovementModel.createIndexes(),
      InvoiceModel.createIndexes(),
      CounterModel.createIndexes(),
      CreditNoteModel.createIndexes(),
      CreditNoteCounterModel.createIndexes(),
      AccountModel.createIndexes(),
      JournalEntryModel.createIndexes(),
      TaxPeriodModel.createIndexes(),
    ]);
  });

  beforeEach(async () => {
    tenantId = new Types.ObjectId();
    userId = new Types.ObjectId();

    const tenant = await TenantModel.create({
      _id: tenantId,
      name: 'Integration Test Business',
      slug: `integration-${randomUUID()}`,
      status: 'active',
      subscriptionStatus: 'trial',
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      stateCode: '09',
      gstin: null,
    });

    tenantId = tenant._id;

    const product = await ProductModel.create({
      tenantId,
      name: 'Integration Test Product',
      purchasePrice: 50,
      sellingPrice: 100,
      mrp: 100,
      gstRate: 0,
      priceIncludesTax: false,
      hsnCode: '',
      unit: 'pcs',
      stockQty: 10,
      lowStockThreshold: 2,
      trackStock: true,
      isDeleted: false,
    });

    productId = product._id;

    service = new SalesService(
      connection,
      ProductModel,
      {} as any,
      TenantModel,
      MovementModel,
      InvoiceModel,
      CounterModel,
      CreditNoteModel,
      CreditNoteCounterModel,
      new AccountingService(
        AccountModel as any,
        JournalEntryModel as any,
        new TaxPeriodsService(TaxPeriodModel as any),
      ),
      new TaxPeriodsService(TaxPeriodModel as any),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(async () => {
    if (!tenantId) return;

    // Delete only records belonging to this test's unique tenant.
    await Promise.all([
      InvoiceModel.deleteMany({ tenantId }),
      MovementModel.deleteMany({ tenantId }),
      ProductModel.deleteMany({ tenantId }),
      CounterModel.deleteMany({ tenantId }),
      CreditNoteModel.deleteMany({ tenantId }),
      CreditNoteCounterModel.deleteMany({ tenantId }),
      AccountModel.deleteMany({ tenantId }),
      JournalEntryModel.deleteMany({ tenantId }),
      TaxPeriodModel.deleteMany({ tenantId }),
      TenantModel.deleteOne({ _id: tenantId }),
    ]);
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
  });

  function makeSaleDto(
    idempotencyKey: string,
    quantity = 2,
  ): CreateSaleDto {
    return {
      idempotencyKey,
      items: [
        {
          productId: productId.toString(),
          quantity,
        },
      ],
      placeOfSupplyStateCode: '09',
    };
  }

  function makeCreditNoteDto(
    idempotencyKey: string,
    quantity = 1,
    reason = 'Customer return',
  ): CreateCreditNoteDto {
    return {
      idempotencyKey,
      items: [
        {
          lineIndex: 0,
          quantity,
          restock: true,
        },
      ],
      reason,
    };
  }
  it('creates invoice, decrements stock and records SALE movement atomically', async () => {
    const dto = makeSaleDto(randomUUID());

    const invoice = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      dto,
    );

    const updatedProduct = await ProductModel.findById(productId).lean();
    const movements = await MovementModel.find({
      tenantId,
      productId,
      type: 'SALE',
    }).lean();

    expect(invoice).toBeTruthy();
    expect(invoice.grandTotal).toBe(200);
    expect(updatedProduct?.stockQty).toBe(8);

    expect(movements).toHaveLength(1);
    expect(movements[0].quantityDelta).toBe(-2);
    expect(movements[0].previousQty).toBe(10);
    expect(movements[0].newQty).toBe(8);

    expect(
      await InvoiceModel.countDocuments({ tenantId }),
    ).toBe(1);
  });

  it('returns the existing invoice for an identical idempotent request', async () => {
    const dto = makeSaleDto(randomUUID());

    const first = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      dto,
    );

    const second = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      dto,
    );

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(second._id.toString()).toBe(first._id.toString());
    expect(updatedProduct?.stockQty).toBe(8);

    expect(
      await InvoiceModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE',
      }),
    ).toBe(1);
  });

  it('rejects a changed payload using an already-used idempotency key', async () => {
    const key = randomUUID();

    await service.createSale(
      tenantId.toString(),
      userId.toString(),
      makeSaleDto(key, 2),
    );

    await expect(
      service.createSale(
        tenantId.toString(),
        userId.toString(),
        makeSaleDto(key, 3),
      ),
    ).rejects.toThrow(
      'This idempotency key has already been used for a different sale.',
    );

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(updatedProduct?.stockQty).toBe(8);

    expect(
      await InvoiceModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE',
      }),
    ).toBe(1);
  });
  it('rolls back earlier stock deductions when a later product has insufficient stock', async () => {
    const secondProduct = await ProductModel.create({
      tenantId,
      name: 'Insufficient Stock Product',
      purchasePrice: 50,
      sellingPrice: 100,
      mrp: 100,
      gstRate: 0,
      priceIncludesTax: false,
      hsnCode: '',
      unit: 'pcs',
      stockQty: 1,
      lowStockThreshold: 1,
      trackStock: true,
      isDeleted: false,
    });

    const dto = makeSaleDto(randomUUID(), 2);
    dto.items.push({
      productId: secondProduct._id.toString(),
      quantity: 2,
    });

    await expect(
      service.createSale(
        tenantId.toString(),
        userId.toString(),
        dto,
      ),
    ).rejects.toThrow('Insufficient stock');

    const firstAfter = await ProductModel.findById(productId).lean();
    const secondAfter = await ProductModel.findById(secondProduct._id).lean();

    expect(firstAfter?.stockQty).toBe(10);
    expect(secondAfter?.stockQty).toBe(1);

    expect(
      await InvoiceModel.countDocuments({ tenantId }),
    ).toBe(0);

    expect(
      await MovementModel.countDocuments({ tenantId, type: 'SALE' }),
    ).toBe(0);
  });

  it('handles concurrent identical requests without duplicate invoices or stock deductions', async () => {
    const dto = makeSaleDto(randomUUID(), 2);

    const results = await Promise.all([
      service.createSale(
        tenantId.toString(),
        userId.toString(),
        dto,
      ),
      service.createSale(
        tenantId.toString(),
        userId.toString(),
        dto,
      ),
    ]);

    expect(results[0]._id.toString()).toBe(results[1]._id.toString());

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(updatedProduct?.stockQty).toBe(8);

    expect(
      await InvoiceModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE',
      }),
    ).toBe(1);
  });
  it('returns the existing credit note for an identical idempotent request', async () => {
    const sale = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      makeSaleDto(randomUUID(), 2),
    );

    const dto = makeCreditNoteDto(randomUUID(), 1);

    const first = await service.createCreditNote(
      tenantId.toString(),
      userId.toString(),
      sale._id.toString(),
      dto,
    );

    const second = await service.createCreditNote(
      tenantId.toString(),
      userId.toString(),
      sale._id.toString(),
      dto,
    );

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(second.creditNote._id.toString()).toBe(
      first.creditNote._id.toString(),
    );
    expect(second.creditNote.totalAmount).toBe(100);
    expect(updatedProduct?.stockQty).toBe(9);

    expect(
      await CreditNoteModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE_RETURN',
      }),
    ).toBe(1);
  });

  it('rejects a changed credit-note payload using an already-used idempotency key', async () => {
    const sale = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      makeSaleDto(randomUUID(), 2),
    );

    const key = randomUUID();

    await service.createCreditNote(
      tenantId.toString(),
      userId.toString(),
      sale._id.toString(),
      makeCreditNoteDto(key, 1, 'Customer return'),
    );

    await expect(
      service.createCreditNote(
        tenantId.toString(),
        userId.toString(),
        sale._id.toString(),
        makeCreditNoteDto(key, 1, 'Damaged product'),
      ),
    ).rejects.toThrow(
      'This idempotency key has already been used for a different credit note.',
    );

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(updatedProduct?.stockQty).toBe(9);

    expect(
      await CreditNoteModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE_RETURN',
      }),
    ).toBe(1);
  });

  it('handles concurrent identical credit-note requests without duplicate returns or stock restoration', async () => {
    const sale = await service.createSale(
      tenantId.toString(),
      userId.toString(),
      makeSaleDto(randomUUID(), 2),
    );

    const dto = makeCreditNoteDto(randomUUID(), 1);

    const results = await Promise.all([
      service.createCreditNote(
        tenantId.toString(),
        userId.toString(),
        sale._id.toString(),
        dto,
      ),
      service.createCreditNote(
        tenantId.toString(),
        userId.toString(),
        sale._id.toString(),
        dto,
      ),
    ]);

    expect(results[0].creditNote._id.toString()).toBe(
      results[1].creditNote._id.toString(),
    );

    const updatedProduct = await ProductModel.findById(productId).lean();

    expect(updatedProduct?.stockQty).toBe(9);

    expect(
      await CreditNoteModel.countDocuments({ tenantId }),
    ).toBe(1);

    expect(
      await MovementModel.countDocuments({
        tenantId,
        productId,
        type: 'SALE_RETURN',
      }),
    ).toBe(1);
  });

});

