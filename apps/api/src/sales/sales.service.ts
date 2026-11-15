import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { Product } from '../products/schemas/product.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { LoyaltyLedger, LoyaltyLedgerDocument } from '../customers/schemas/loyalty-ledger.schema';
import { LoyaltyRewardVoucher, LoyaltyRewardVoucherDocument } from '../customers/schemas/loyalty-reward-voucher.schema';
import { Tenant } from '../tenants/schemas/tenant.schema';
import { InventoryMovement } from '../inventory/schemas/inventory-movement.schema';
import { Warehouse } from '../branches/schemas/warehouse.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { WarehouseStock, WarehouseStockDocument } from '../inventory/schemas/warehouse-stock.schema';
import { tenantFilter } from '../common/tenant-scoped.service';

import { SalesInvoice } from './schemas/sales-invoice.schema';
import { InvoiceCounter } from './schemas/invoice-counter.schema';
import { CreditNote } from './schemas/credit-note.schema';
import { CreditNoteCounter } from './schemas/credit-note-counter.schema';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesDto } from './dto/list-sales.dto';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto';
import { AddCreditNoteRefundDto } from './dto/add-credit-note-refund.dto';
import { AccountingService } from '../accounting/accounting.service';
import { TaxPeriodsService } from '../accounting/tax-periods.service';
import { Promotion, PromotionDocument } from './schemas/promotion.schema';
import { Warranty, WarrantyDocument } from './schemas/warranty.schema';
import { WarrantyClaim, WarrantyClaimDocument } from './schemas/warranty-claim.schema';
import { PriceRule, PriceRuleDocument } from './schemas/price-rule.schema';
import { CreatePriceRuleDto } from './dto/create-price-rule.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionStatusDto } from './dto/update-promotion-status.dto';
import { CreateWarrantyClaimDto, ReviewWarrantyClaimDto } from './dto/warranty-claim.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,

    @InjectModel(Product.name)
    private readonly products: Model<Product>,

    @InjectModel(Customer.name)
    private readonly customers: Model<CustomerDocument>,

    @InjectModel(Tenant.name)
    private readonly tenants: Model<Tenant>,

    @InjectModel(InventoryMovement.name)
    private readonly movements: Model<InventoryMovement>,

    @InjectModel(SalesInvoice.name)
    private readonly invoices: Model<SalesInvoice>,

    @InjectModel(InvoiceCounter.name)
    private readonly counters: Model<InvoiceCounter>,

    @InjectModel(CreditNote.name)
    private readonly creditNotes: Model<CreditNote>,

    @InjectModel(CreditNoteCounter.name)
    private readonly creditNoteCounters: Model<CreditNoteCounter>,

    private readonly accounting: AccountingService,
    private readonly taxPeriods: TaxPeriodsService,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<Warehouse>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<WarehouseStockDocument>,
    @InjectModel(LoyaltyLedger.name) private readonly loyaltyLedger: Model<LoyaltyLedgerDocument>,
    @InjectModel(LoyaltyRewardVoucher.name) private readonly loyaltyVouchers: Model<LoyaltyRewardVoucherDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(Warranty.name) private readonly warranties: Model<WarrantyDocument>,
    @InjectModel(WarrantyClaim.name) private readonly warrantyClaims: Model<WarrantyClaimDocument>,
    @InjectModel(PriceRule.name) private readonly priceRules: Model<PriceRuleDocument>,
  ) {}

  private loyaltyTier(points: number): 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' {
    if (points >= 5000) return 'PLATINUM';
    if (points >= 2000) return 'GOLD';
    if (points >= 500) return 'SILVER';
    return 'BRONZE';
  }

  private toPaise(value: number): number {
    return Math.round((value + Number.EPSILON) * 100);
  }

  private fromPaise(value: number): number {
    return value / 100;
  }

  private financialYear(date: Date): string {
    const indiaDate = new Date(date.getTime() + 330 * 60 * 1000);
    const month = indiaDate.getUTCMonth();
    const year = indiaDate.getUTCFullYear();
    const startYear = month >= 3 ? year : year - 1;

    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  private async ensureInvoiceCounter(
    tenantId: string,
    financialYear: string,
  ): Promise<void> {
    const filter = {
      tenantId: new Types.ObjectId(tenantId),
      financialYear,
    };

    try {
      await this.counters.updateOne(
        filter,
        {
          $setOnInsert: { sequence: 0 },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      const mongoError = error as { code?: number };

      if (mongoError.code !== 11000) {
        throw error;
      }

      const existing = await this.counters.exists(filter);

      if (!existing) {
        throw error;
      }
    }
  }

  private async nextInvoiceNumber(
    tenantId: string,
    financialYear: string,
    session: any,
  ): Promise<string> {
    const counter = await this.counters.findOneAndUpdate(
      {
        tenantId: new Types.ObjectId(tenantId),
        financialYear,
      },
      {
        $inc: { sequence: 1 },
      },
      {
        new: true,
        session,
      },
    );

    if (!counter) {
      throw new ConflictException(
        'Invoice counter is not initialized. Please retry the sale.',
      );
    }

    return `SR/${financialYear}/${String(counter.sequence).padStart(6, '0')}`;
  }

  private async ensureCreditNoteCounter(
    tenantId: string,
    financialYear: string,
  ): Promise<void> {
    const filter = {
      tenantId: new Types.ObjectId(tenantId),
      financialYear,
    };

    try {
      await this.creditNoteCounters.updateOne(
        filter,
        { $setOnInsert: { sequence: 0 } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      const mongoError = error as { code?: number };

      if (mongoError.code !== 11000) {
        throw error;
      }

      const existing = await this.creditNoteCounters.exists(filter);

      if (!existing) {
        throw error;
      }
    }
  }

  private async nextCreditNoteNumber(
    tenantId: string,
    financialYear: string,
    session: any,
  ): Promise<string> {
    const counter = await this.creditNoteCounters.findOneAndUpdate(
      {
        tenantId: new Types.ObjectId(tenantId),
        financialYear,
      },
      { $inc: { sequence: 1 } },
      { new: true, session },
    );

    if (!counter) {
      throw new ConflictException(
        'Credit-note counter is not initialized. Please retry.',
      );
    }

    return `CN/${financialYear}/${String(counter.sequence).padStart(6, '0')}`;
  }
  async createPromotion(tenantId: string, userId: string, dto: CreatePromotionDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid tenant or user identity');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const code = dto.code.trim().toUpperCase();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new BadRequestException('Promotion end date must be after its start date');
    if (dto.discountType === 'PERCENT' && dto.discountValue > 100) throw new BadRequestException('Percentage discount cannot exceed 100%');
    if (dto.maximumDiscount !== undefined && dto.maximumDiscount <= 0) throw new BadRequestException('Maximum discount must be positive');
    try {
      return await this.promotions.create({
        tenantId: new Types.ObjectId(tenantId), code, name: dto.name.trim(),
        description: dto.description?.trim() || '', discountType: dto.discountType,
        discountValue: dto.discountValue, minimumSubtotal: dto.minimumSubtotal ?? 0,
        maximumDiscount: dto.maximumDiscount ?? null, startsAt, endsAt,
        usageLimit: dto.usageLimit ?? null, usageCount: 0, status: 'ACTIVE',
        createdBy: new Types.ObjectId(userId),
      });
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('A promotion with this code already exists in this business');
      throw error;
    }
  }

  async listPromotions(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.promotions.find(tenantFilter(tenantId, {})).sort({ createdAt: -1 }).lean();
  }

  async updatePromotionStatus(tenantId: string, userId: string, id: string, dto: UpdatePromotionStatusDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid tenant, user or promotion ID');
    const promotion = await this.promotions.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }));
    if (!promotion) throw new NotFoundException('Promotion not found');
    if (dto.status === 'ACTIVE' && promotion.endsAt <= new Date()) throw new ConflictException('An expired promotion cannot be reactivated');
    promotion.status = dto.status;
    promotion.updatedBy = new Types.ObjectId(userId);
    await promotion.save();
    return promotion;
  }

  async createPriceRule(tenantId: string, userId: string, dto: CreatePriceRuleDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid tenant or user identity');
    if (dto.appliesTo === 'PRODUCT' && !dto.productId) throw new BadRequestException('Select a product for a product-specific price rule');
    if (dto.appliesTo === 'CATEGORY' && !dto.category?.trim()) throw new BadRequestException('Enter a category for a category price rule');
    if (dto.productId && !Types.ObjectId.isValid(dto.productId)) throw new BadRequestException('Invalid product ID');
    if (dto.ruleType === 'PERCENT_OFF' && dto.value > 100) throw new BadRequestException('Percentage reduction cannot exceed 100%');
    const startsAt = new Date(dto.startsAt), endsAt = new Date(dto.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new BadRequestException('Price rule end date must be after its start date');
    if (dto.productId) {
      const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false })).lean();
      if (!product) throw new NotFoundException('Product not found in this business');
    }
    return this.priceRules.create({ tenantId: new Types.ObjectId(tenantId), name: dto.name.trim(), appliesTo: dto.appliesTo, productId: dto.productId ? new Types.ObjectId(dto.productId) : null, category: dto.category?.trim() || '', ruleType: dto.ruleType, value: dto.value, minimumQuantity: dto.minimumQuantity ?? 1, startsAt, endsAt, priority: dto.priority ?? 0, status: 'ACTIVE', createdBy: new Types.ObjectId(userId) });
  }

  async listPriceRules(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.priceRules.find(tenantFilter(tenantId, {})).sort({ priority: -1, createdAt: -1 }).populate('productId', 'name sku').lean();
  }

  async updatePriceRuleStatus(tenantId: string, id: string, status: 'ACTIVE' | 'PAUSED') {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid tenant or price rule ID');
    const rule = await this.priceRules.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }));
    if (!rule) throw new NotFoundException('Price rule not found');
    if (status === 'ACTIVE' && rule.endsAt <= new Date()) throw new ConflictException('An expired price rule cannot be reactivated');
    rule.status = status; await rule.save(); return rule;
  }

  async createSale(
    tenantId: string,
    userId: string,
    dto: CreateSaleDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid tenant or user identity.');
    }

    const idempotencyKey = dto.idempotencyKey.trim().toLowerCase();

    const fingerprintPayload = {
      items: dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        discountAmount: item.discountAmount ?? 0,
        serialNumbers: [...(item.serialNumbers || [])].map(value => value.trim().toUpperCase()).sort(),
      })),
      customerId: dto.customerId ?? null,
      customerName: dto.customerName ?? '',
      customerPhone: dto.customerPhone ?? '',
      customerGstin: dto.customerGstin ?? null,
      placeOfSupplyStateCode: dto.placeOfSupplyStateCode,
      ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
      ...(dto.rewardVoucherCode ? { rewardVoucherCode: dto.rewardVoucherCode.trim().toUpperCase() } : {}),
      ...(dto.promotionCode ? { promotionCode: dto.promotionCode.trim().toUpperCase() } : {}),
      payments: (dto.payments ?? []).map((payment) => ({
        method: payment.method,
        amountPaise: this.toPaise(payment.amount),
        reference: payment.reference ?? '',
      })),
    };

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(fingerprintPayload))
      .digest('hex');

    const existingInvoice = await this.invoices
      .findOne(tenantFilter(tenantId, { idempotencyKey }))
      .lean();

    if (existingInvoice) {
      if (existingInvoice.requestFingerprint !== requestFingerprint) {
        throw new ConflictException(
          'This idempotency key has already been used for a different sale.',
        );
      }

      return existingInvoice;
    }
    const saleDate = new Date();
    const fy = this.financialYear(saleDate);

    await this.ensureInvoiceCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const transactionDuplicate = await this.invoices
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .session(session)
          .lean();

        if (transactionDuplicate) {
          if (transactionDuplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different sale.',
            );
          }

          result = transactionDuplicate;
          return;
        }
        await this.taxPeriods.assertOpen(tenantId, saleDate, session);
        const tenant = await this.tenants
          .findById(tenantId)
          .session(session)
          .lean();

        if (!tenant) {
          throw new NotFoundException('Business profile not found.');
        }

        if (!tenant.stateCode) {
          throw new BadRequestException(
            'Configure the business state code in the tenant profile before creating invoices.',
          );
        }

        const linkedCustomer = dto.customerId
          ? await this.customers
              .findOne(
                tenantFilter(tenantId, {
                  _id: new Types.ObjectId(dto.customerId),
                  isDeleted: false,
                }),
              )
              .session(session)
              .lean()
          : null;

        if (dto.customerId && !linkedCustomer) {
          throw new NotFoundException('Customer not found in this business.');
        }

        let rewardVoucher: any = null;
        let voucherDiscountPaise = 0;
        if (dto.rewardVoucherCode) {
          if (!linkedCustomer) throw new BadRequestException('A linked customer is required to redeem a loyalty voucher.');
          rewardVoucher = await this.loyaltyVouchers.findOne(tenantFilter(tenantId, {
            customerId: linkedCustomer._id,
            code: dto.rewardVoucherCode.trim().toUpperCase(),
            status: 'AVAILABLE',
            expiresAt: { $gt: saleDate },
          })).session(session);
          if (!rewardVoucher) throw new BadRequestException('Reward voucher is invalid, expired, already used, or belongs to another customer.');
          voucherDiscountPaise = this.toPaise(rewardVoucher.discountAmount);
        }

        const customerName = linkedCustomer?.name ?? dto.customerName ?? '';
        const customerPhone = linkedCustomer?.phone ?? dto.customerPhone ?? '';
        const customerGstin = linkedCustomer?.gstin ?? dto.customerGstin ?? null;

        const sellerGstin = tenant.gstin || null;
        const sellerStateCode = tenant.stateCode;
        const placeOfSupply = dto.placeOfSupplyStateCode;

        if (
          customerGstin && customerGstin.substring(0, 2) !== placeOfSupply
        ) {
          throw new BadRequestException(
            'Customer GSTIN state code must match the place-of-supply state code.',
          );
        }

        if (sellerGstin && sellerGstin.substring(0, 2) !== sellerStateCode) {
          throw new BadRequestException(
            'Seller GSTIN state code does not match the business state code.',
          );
        }

        const productMap = new Map<string, any>();
        const batchAllocationsByProduct = new Map<string, Array<{ batchId: Types.ObjectId; quantity: number }>>();
        const requestedQuantities = new Map<string, number>();

        for (const item of dto.items) {
          const id = item.productId;

          requestedQuantities.set(
            id,
            (requestedQuantities.get(id) || 0) + item.quantity,
          );
        }

        const allSerialNumbers = dto.items.flatMap(item => item.serialNumbers || []).map(value => value.trim().toUpperCase());
        if (new Set(allSerialNumbers).size !== allSerialNumbers.length) throw new BadRequestException('A serial number can be assigned only once per invoice');
        const serialCollection = this.connection.db?.collection('inventory_serials');
        for (const item of dto.items) {
          const serialNumbers = (item.serialNumbers || []).map(value => value.trim().toUpperCase());
          if (!serialCollection) throw new ConflictException('Serial registry is unavailable');
          const registeredCount = await serialCollection.countDocuments({
            tenantId: new Types.ObjectId(tenantId), productId: new Types.ObjectId(item.productId),
          }, { session });
          if (!dto.warehouseId) {
            if (serialNumbers.length || registeredCount > 0) throw new BadRequestException('Select a warehouse and the exact serial numbers when selling serialized products');
            continue;
          }
          if (registeredCount > 0 && serialNumbers.length !== item.quantity) throw new BadRequestException(`Select exactly ${item.quantity} serial number(s) for ${productMap.get(item.productId)?.name || 'this product'}.`);
          if (!serialNumbers.length) continue;
          if (serialNumbers.length !== item.quantity) throw new BadRequestException('The number of selected serials must equal the invoice line quantity');
          const registered = await serialCollection.find({
            tenantId: new Types.ObjectId(tenantId), productId: new Types.ObjectId(item.productId),
            warehouseId: new Types.ObjectId(dto.warehouseId), serialNumber: { $in: serialNumbers }, status: 'IN_STOCK',
          }, { session }).toArray();
          if (registered.length !== serialNumbers.length) throw new ConflictException('One or more serials are not available for this product in the selected warehouse');
        }

        for (const productId of requestedQuantities.keys()) {
          const product = await this.products
            .findOne(
              tenantFilter(tenantId, {
                _id: new Types.ObjectId(productId),
                isDeleted: false,
              }),
            )
            .session(session)
            .lean();

          if (!product) {
            throw new NotFoundException(
              `Product ${productId} was not found in this business.`,
            );
          }

          productMap.set(productId, product);
        }

        let promotion: any = null;
        let promotionDiscountPaise = 0;
        if (dto.promotionCode) {
          promotion = await this.promotions.findOne(tenantFilter(tenantId, {
            code: dto.promotionCode.trim().toUpperCase(),
            status: 'ACTIVE',
            startsAt: { $lte: saleDate },
            endsAt: { $gt: saleDate },
            $or: [{ usageLimit: null }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }],
          })).session(session);
          if (!promotion) throw new BadRequestException('Promotion code is invalid, inactive, expired, or has reached its usage limit');
          const eligibleSubtotal = dto.items.reduce((sum, item) => {
            const product = productMap.get(item.productId);
            return sum + Math.max(0, this.toPaise(product.sellingPrice) * item.quantity - this.toPaise(item.discountAmount || 0));
          }, 0);
          if (eligibleSubtotal < this.toPaise(promotion.minimumSubtotal || 0)) throw new BadRequestException('Sale does not meet the minimum subtotal for this promotion');
          const calculated = promotion.discountType === 'PERCENT'
            ? Math.round((eligibleSubtotal * promotion.discountValue) / 100)
            : this.toPaise(promotion.discountValue);
          promotionDiscountPaise = Math.min(calculated, promotion.maximumDiscount == null ? calculated : this.toPaise(promotion.maximumDiscount), eligibleSubtotal);
        }

        let selectedWarehouse: any = null;
        const warehouseStockMap = new Map<string, any>();
        if (!dto.warehouseId) {
          const allocatedCount = await this.warehouseStocks.countDocuments(tenantFilter(tenantId, {
            productId: { $in: Array.from(productMap.values()).map((product: any) => product._id) },
          })).session(session);
          if (allocatedCount > 0) throw new BadRequestException('Select a warehouse for this sale because this product has warehouse-level stock allocations.');
        }
        if (dto.warehouseId) {
          if (!Types.ObjectId.isValid(dto.warehouseId)) throw new BadRequestException('Invalid warehouse ID');
          selectedWarehouse = await this.warehouses.findOne(tenantFilter(tenantId, {
            _id: new Types.ObjectId(dto.warehouseId), isDeleted: false, isActive: true,
          })).session(session).lean();
          if (!selectedWarehouse) throw new NotFoundException('Active warehouse not found in this business');
          const branch = await this.branches.findOne(tenantFilter(tenantId, {
            _id: selectedWarehouse.branchId, isDeleted: false, isActive: true,
          })).session(session).lean();
          if (!branch) throw new ConflictException('The selected warehouse branch is inactive');
          const stockRows = await this.warehouseStocks.find(tenantFilter(tenantId, {
            warehouseId: selectedWarehouse._id,
            productId: { $in: Array.from(productMap.values()).map((product: any) => product._id) },
          })).session(session).lean();
          for (const stock of stockRows) warehouseStockMap.set(String(stock.productId), stock);
        }

        const now = saleDate;
        const invoiceNumber = await this.nextInvoiceNumber(
          tenantId,
          fy,
          session,
        );

        const intraState = sellerStateCode === placeOfSupply;
        let subtotalPaise = 0;
        let discountTotalPaise = 0;
        let taxableTotalPaise = 0;
        let cgstTotalPaise = 0;
        let sgstTotalPaise = 0;
        let igstTotalPaise = 0;

        const invoiceItems: any[] = [];
        let totalCogsPaise = 0;

        const allocateDiscount = (amount: number, bases: number[]) => {
          const allocations = bases.map(() => 0);
          const total = bases.reduce((sum, value) => sum + value, 0);
          if (amount <= 0 || total <= 0) return allocations;
          let remaining = amount;
          const eligible = bases.map((value, index) => ({ value, index })).filter((line) => line.value > 0);
          eligible.forEach((line, position) => {
            const allocation = position === eligible.length - 1 ? remaining : Math.min(remaining, Math.floor((amount * line.value) / total));
            allocations[line.index] = allocation;
            remaining -= allocation;
          });
          return allocations;
        };
        const activePriceRules = await this.priceRules.find(tenantFilter(tenantId, { status: 'ACTIVE', startsAt: { $lte: saleDate }, endsAt: { $gt: saleDate }, $or: [{ appliesTo: 'PRODUCT', productId: { $in: Array.from(productMap.values()).map((p: any) => p._id) } }, { appliesTo: 'CATEGORY' }] })).session(session).sort({ priority: -1, createdAt: 1 }).lean();
        const priceFor = (product: any, quantity: number) => {
          const rule: any = activePriceRules.find((candidate: any) => quantity >= candidate.minimumQuantity && (candidate.appliesTo === 'PRODUCT' ? String(candidate.productId) === String(product._id) : candidate.category === product.category));
          if (!rule) return this.toPaise(product.sellingPrice);
          const base = this.toPaise(product.sellingPrice);
          if (rule.ruleType === 'FIXED_PRICE') return this.toPaise(rule.value);
          if (rule.ruleType === 'PERCENT_OFF') return Math.max(0, base - Math.round(base * rule.value / 100));
          return Math.max(0, base - this.toPaise(rule.value));
        };
        const baseNetByLine = dto.items.map((item) => {
          const product = productMap.get(item.productId);
          return Math.max(0, priceFor(product, item.quantity) * item.quantity - this.toPaise(item.discountAmount || 0));
        });
        const promotionAllocations = allocateDiscount(promotionDiscountPaise, baseNetByLine);
        const afterPromotionBases = baseNetByLine.map((value, index) => value - promotionAllocations[index]);
        if (voucherDiscountPaise > afterPromotionBases.reduce((sum, value) => sum + value, 0)) throw new BadRequestException('Reward voucher discount exceeds the sale amount after promotions and line discounts.');
        const voucherAllocations = allocateDiscount(voucherDiscountPaise, afterPromotionBases);

        for (const [itemIndex, item] of dto.items.entries()) {
          const product = productMap.get(item.productId);
          const quantity = item.quantity;

          const unitPricePaise = priceFor(product, quantity);
          const grossPaise = unitPricePaise * quantity;
          const discountPaise = this.toPaise(item.discountAmount || 0) + (promotionAllocations[itemIndex] || 0) + (voucherAllocations[itemIndex] || 0);

          if (discountPaise > grossPaise) {
            throw new BadRequestException(
              `Discount exceeds the product amount for ${product.name}.`,
            );
          }

          const netPaise = grossPaise - discountPaise;
          const gstRate = product.gstRate;

          if (gstRate > 0 && !sellerGstin) {
            throw new BadRequestException(
              'A seller GSTIN must be configured before charging GST. Update the business profile first.',
            );
          }

          let taxablePaise: number;
          let taxPaise: number;

          if (product.priceIncludesTax) {
            taxablePaise = Math.round(
              (netPaise * 100) / (100 + gstRate),
            );
            taxPaise = netPaise - taxablePaise;
          } else {
            taxablePaise = netPaise;
            taxPaise = Math.round((taxablePaise * gstRate) / 100);
          }

          let cgstPaise = 0;
          let sgstPaise = 0;
          let igstPaise = 0;

          if (intraState) {
            cgstPaise = Math.round(taxPaise / 2);
            sgstPaise = taxPaise - cgstPaise;
          } else {
            igstPaise = taxPaise;
          }

          const lineTotalPaise = taxablePaise + taxPaise;

          subtotalPaise += grossPaise;
          discountTotalPaise += discountPaise;
          taxableTotalPaise += taxablePaise;
          cgstTotalPaise += cgstPaise;
          sgstTotalPaise += sgstPaise;
          igstTotalPaise += igstPaise;

          const warehouseStock = dto.warehouseId ? warehouseStockMap.get(String(product._id)) : null;
          const unitCostPaise = product.trackStock ? this.toPaise(dto.warehouseId ? (warehouseStock?.averageCost || 0) : (product.averageCost || 0)) : 0;
          if (product.trackStock && product.stockQty > 0 && !product.valuationInitialized) {
            throw new BadRequestException(`Inventory valuation is not initialized for ${product.name}. Reconcile opening stock before selling this item.`);
          }
          const lineCogsPaise = unitCostPaise * quantity;
          totalCogsPaise += lineCogsPaise;

          invoiceItems.push({
            productId: product._id,
            name: product.name,
            sku: product.sku || '',
            hsnCode: product.hsnCode || '',
            unit: product.unit,
            quantity,
            unitPrice: this.fromPaise(unitPricePaise),
            discountAmount: this.fromPaise(discountPaise),
            taxableValue: this.fromPaise(taxablePaise),
            gstRate,
            priceIncludesTax: product.priceIncludesTax,
            stockTracked: product.trackStock,
            unitCostAtSale: this.fromPaise(unitCostPaise),
            costOfGoodsSold: this.fromPaise(lineCogsPaise),
            cgstAmount: this.fromPaise(cgstPaise),
            sgstAmount: this.fromPaise(sgstPaise),
            igstAmount: this.fromPaise(igstPaise),
            totalTax: this.fromPaise(taxPaise),
            lineTotal: this.fromPaise(lineTotalPaise),
            serialNumbers: (item.serialNumbers || []).map(value => value.trim().toUpperCase()),
          });
        }

        const totalTaxPaise =
          cgstTotalPaise + sgstTotalPaise + igstTotalPaise;

        const grandTotalPaise =
          taxableTotalPaise + totalTaxPaise;

        const paymentInputs = dto.payments || [];
        const paymentTotalPaise = paymentInputs.reduce(
          (sum, payment) => sum + this.toPaise(payment.amount),
          0,
        );

        if (paymentTotalPaise > grandTotalPaise) {
          throw new BadRequestException(
            'Total payments cannot exceed the invoice grand total.',
          );
        }

        const duePaise = grandTotalPaise - paymentTotalPaise;

        const paymentStatus =
          paymentTotalPaise === 0
            ? 'UNPAID'
            : duePaise === 0
              ? 'PAID'
              : 'PARTIALLY_PAID';

        const payments = paymentInputs.map((payment) => ({
          method: payment.method,
          amount: this.fromPaise(this.toPaise(payment.amount)),
          reference: payment.reference || '',
          paidAt: now,
          receivedBy: new Types.ObjectId(userId),
        }));

        for (const [productId, quantity] of requestedQuantities) {
          const product = productMap.get(productId);

          if (!product.trackStock) {
            continue;
          }

          const previousQty = product.stockQty || 0;
          const warehouseStock = dto.warehouseId ? warehouseStockMap.get(String(product._id)) : null;
          if (dto.warehouseId && !warehouseStock) {
            throw new BadRequestException(`No stock is allocated for ${product.name} in the selected warehouse.`);
          }
          const availableQty = dto.warehouseId ? warehouseStock.quantity : previousQty;
          if (availableQty < quantity) {
            throw new BadRequestException(
              `Insufficient stock for ${product.name}. Available: ${availableQty}, requested: ${quantity}.`,
            );
          }
          const newQty = previousQty - quantity;
          let movementPreviousQty = previousQty;
          let movementNewQty = newQty;
          let warehousePreviousValuePaiseForMovement: number | undefined;
          let warehouseNewValuePaiseForMovement: number | undefined;
          const warehouseCostPaise = dto.warehouseId ? this.toPaise(warehouseStock.averageCost || 0) : this.toPaise(product.averageCost || 0);
          const relievedValuePaise = dto.warehouseId
            ? (quantity === warehouseStock.quantity ? this.toPaise(warehouseStock.inventoryValue || 0) : warehouseCostPaise * quantity)
            : this.toPaise(product.averageCost || 0) * quantity;
          if (dto.warehouseId) {
            const warehouseNewQty = warehouseStock.quantity - quantity;
            movementPreviousQty = warehouseStock.quantity;
            movementNewQty = warehouseNewQty;
            const warehouseValuePaise = this.toPaise(warehouseStock.inventoryValue || 0);
            warehousePreviousValuePaiseForMovement = warehouseValuePaise;
            if (relievedValuePaise > warehouseValuePaise) throw new ConflictException('Warehouse inventory valuation is inconsistent; reconcile before selling');
            const warehouseNewValuePaise = Math.max(0, this.toPaise(warehouseStock.inventoryValue || 0) - relievedValuePaise);
            warehouseNewValuePaiseForMovement = warehouseNewValuePaise;
            const warehouseUpdated = await this.warehouseStocks.findOneAndUpdate(
              tenantFilter(tenantId, { _id: warehouseStock._id, quantity: warehouseStock.quantity }),
              { $set: { quantity: warehouseNewQty, inventoryValue: this.fromPaise(warehouseNewValuePaise), averageCost: warehouseNewQty > 0 ? this.fromPaise(Math.round(warehouseNewValuePaise / warehouseNewQty)) : 0 } },
              { new: true, session, runValidators: true },
            );
            if (!warehouseUpdated) throw new ConflictException(`Warehouse stock changed while processing ${product.name}. Please retry.`);
          }

          const productValuePaise = this.toPaise(product.inventoryValue || 0);
          if (dto.warehouseId && relievedValuePaise > productValuePaise) throw new ConflictException('Product inventory valuation is inconsistent with warehouse stock; reconcile before selling');
          const nextInventoryValuePaise = Math.max(0, productValuePaise - relievedValuePaise);
          const updated = await this.products.findOneAndUpdate(
            tenantFilter(tenantId, {
              _id: product._id,
              isDeleted: false,
              trackStock: true,
              stockQty: previousQty,
            }),
            {
              $set: {
                stockQty: newQty,
                inventoryValue: this.fromPaise(nextInventoryValuePaise),
                averageCost: newQty > 0 ? this.fromPaise(Math.round(nextInventoryValuePaise / newQty)) : 0,
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          );

          if (!updated) {
            throw new ConflictException(
              `Stock changed while processing ${product.name}. Please retry the sale.`,
            );
          }

          await this.movements.create(
            [
              {
                tenantId: new Types.ObjectId(tenantId),
                productId: product._id,
                ...(dto.warehouseId ? { warehouseId: selectedWarehouse._id } : {}),
                type: 'SALE',
                quantityDelta: -quantity,
                previousQty: movementPreviousQty,
                newQty: movementNewQty,
                reason: `Sale invoice ${invoiceNumber}`,
                performedBy: new Types.ObjectId(userId),
                valuation: {
                  unitCostPaise: warehouseCostPaise,
                  productPreviousValuePaise: productValuePaise,
                  productValueDeltaPaise: -relievedValuePaise,
                  productNewValuePaise: nextInventoryValuePaise,
                  ...(dto.warehouseId ? {
                    warehousePreviousValuePaise: warehousePreviousValuePaiseForMovement ?? 0,
                    warehouseValueDeltaPaise: -relievedValuePaise,
                    warehouseNewValuePaise: warehouseNewValuePaiseForMovement ?? 0,
                  } : {}),
                },
              },
            ],
            { session },
          );

          const batchCollection = this.connection.db?.collection('inventory_batches');
          if (!batchCollection) throw new ConflictException('Inventory batch registry is unavailable');
          const batchScope: any = { tenantId: new Types.ObjectId(tenantId), productId: product._id };
          if (dto.warehouseId) batchScope.warehouseId = new Types.ObjectId(dto.warehouseId);
          const batchCount = await batchCollection.countDocuments(batchScope, { session });
          if (batchCount > 0) {
            if (!dto.warehouseId) throw new BadRequestException(`Select a warehouse to consume batches for ${product.name}.`);
            const availableBatches = await batchCollection.find({
              ...batchScope, status: 'ACTIVE', expiresAt: { $gt: now }, quantity: { $gt: 0 },
            }, { session }).sort({ expiresAt: 1, createdAt: 1 }).toArray();
            const availableBatchQty = availableBatches.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
            if (availableBatchQty < quantity) throw new ConflictException(`Insufficient unexpired batch quantity for ${product.name}. Available batch units: ${availableBatchQty}.`);
            let remaining = quantity;
            const allocations: Array<{ batchId: Types.ObjectId; quantity: number }> = [];
            for (const batchRow of availableBatches) {
              if (remaining <= 0) break;
              const take = Math.min(remaining, Number(batchRow.quantity));
              const nextQuantity = Number(batchRow.quantity) - take;
              const consumed = await batchCollection.updateOne(
                { _id: batchRow._id, tenantId: new Types.ObjectId(tenantId), quantity: batchRow.quantity, status: 'ACTIVE' },
                { $set: { quantity: nextQuantity, status: nextQuantity === 0 ? 'DEPLETED' : 'ACTIVE' } },
                { session },
              );
              if (consumed.modifiedCount !== 1) throw new ConflictException('Batch stock changed during checkout; please retry');
              allocations.push({ batchId: batchRow._id, quantity: take });
              remaining -= take;
            }
            batchAllocationsByProduct.set(String(product._id), allocations);
          }
        }

        for (const [productId, allocations] of batchAllocationsByProduct) {
          const remainingAllocations = allocations.map(item => ({ ...item }));
          for (const [index, item] of dto.items.entries()) {
            if (item.productId !== productId) continue;
            let needed = item.quantity;
            const lineAllocations: Array<{ batchId: Types.ObjectId; quantity: number }> = [];
            for (const allocation of remainingAllocations) {
              if (needed <= 0) break;
              if (allocation.quantity <= 0) continue;
              const take = Math.min(needed, allocation.quantity);
              lineAllocations.push({ batchId: allocation.batchId, quantity: take });
              allocation.quantity -= take;
              needed -= take;
            }
            if (needed !== 0) throw new ConflictException('Batch allocation did not cover all invoice line quantities');
            invoiceItems[index].batchAllocations = lineAllocations;
          }
        }

        const grandTotal = this.fromPaise(grandTotalPaise);
        const paidAmount = this.fromPaise(paymentTotalPaise);

        const invoice = new this.invoices({
          tenantId: new Types.ObjectId(tenantId),
          idempotencyKey,
          requestFingerprint,
          costingVersion: 1,
          invoiceNumber,
          financialYear: fy,
          invoiceDate: now,
          sellerName: tenant.name,
          sellerGstin,
          sellerStateCode,
          sellerAddress: [
            tenant.addressLine1,
            tenant.addressLine2,
            tenant.city,
            tenant.district,
            tenant.pincode,
          ]
            .filter(Boolean)
            .join(', '),
          customerId: linkedCustomer?._id ?? null,
          warehouseId: selectedWarehouse?._id ?? null,
          loyaltyVoucherCode: rewardVoucher?.code ?? null,
          loyaltyVoucherDiscount: this.fromPaise(voucherDiscountPaise),
          promotionCode: promotion?.code ?? null,
          promotionName: promotion?.name ?? null,
          promotionDiscount: this.fromPaise(promotionDiscountPaise),
          customerName,
          customerPhone,
          customerGstin,
          placeOfSupplyStateCode: placeOfSupply,
          items: invoiceItems,
          subtotal: this.fromPaise(subtotalPaise),
          discountTotal: this.fromPaise(discountTotalPaise),
          taxableValue: this.fromPaise(taxableTotalPaise),
          cgstTotal: this.fromPaise(cgstTotalPaise),
          sgstTotal: this.fromPaise(sgstTotalPaise),
          igstTotal: this.fromPaise(igstTotalPaise),
          totalTax: this.fromPaise(totalTaxPaise),
          grandTotal,
          paidAmount,
          dueAmount: this.fromPaise(duePaise),
          paymentStatus,
          payments,
          status: 'ISSUED',
          createdBy: new Types.ObjectId(userId),
        });

        await invoice.save({ session });
        for (const item of dto.items) {
          const serialNumbers = (item.serialNumbers || []).map(value => value.trim().toUpperCase());
          if (!serialNumbers.length) continue;
          const updatedSerials = await this.connection.db!.collection('inventory_serials').updateMany(
            { tenantId: new Types.ObjectId(tenantId), productId: new Types.ObjectId(item.productId), warehouseId: new Types.ObjectId(dto.warehouseId!), serialNumber: { $in: serialNumbers }, status: 'IN_STOCK' },
            { $set: { status: 'SOLD', saleInvoiceId: invoice._id, soldAt: now } },
            { session },
          );
          if (updatedSerials.modifiedCount !== serialNumbers.length) throw new ConflictException('Serial availability changed during checkout; please retry the sale');
        }
        if (promotion) {
          const usageFilter: any = { _id: promotion._id, tenantId: new Types.ObjectId(tenantId), status: 'ACTIVE', startsAt: { $lte: saleDate }, endsAt: { $gt: saleDate } };
          if (promotion.usageLimit != null) usageFilter.usageCount = { $lt: promotion.usageLimit };
          const used = await this.promotions.findOneAndUpdate(usageFilter, { $inc: { usageCount: 1 } }, { new: true, session });
          if (!used) throw new ConflictException('Promotion usage limit was reached while processing this sale. Please retry.');
        }
        const warrantyRows = invoiceItems.flatMap((line: any, lineIndex: number) => {
          const product = productMap.get(String(line.productId));
          const warrantyDays = Number(product?.warrantyDays || 0);
          if (warrantyDays <= 0) return [];
          const coverageEndsAt = new Date(now.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
          return [{
            tenantId: new Types.ObjectId(tenantId), invoiceId: invoice._id,
            productId: line.productId, customerId: linkedCustomer?._id ?? null,
            lineIndex, invoiceNumber, productName: line.name, sku: line.sku || '',
            customerName, customerPhone, quantity: line.quantity, claimedQuantity: 0,
            warrantyDays, terms: product.warrantyTerms || '', purchaseDate: now,
            coverageEndsAt, status: 'ACTIVE',
          }];
        });
        if (warrantyRows.length) await this.warranties.create(warrantyRows, { session });
        if (rewardVoucher) {
          rewardVoucher.status = 'REDEEMED';
          rewardVoucher.redeemedInvoiceId = invoice._id;
          rewardVoucher.redeemedAt = now;
          await rewardVoucher.save({ session });
        }

        // Loyalty rewards are earned only by linked customers and only on taxable value (GST excluded).
        const loyaltyPointsEarned = linkedCustomer ? Math.floor(taxableTotalPaise / 10000) : 0;
        if (linkedCustomer && loyaltyPointsEarned > 0) {
          const rewardedCustomer = await this.customers.findOneAndUpdate(
            tenantFilter(tenantId, { _id: linkedCustomer._id, isDeleted: false }),
            { $inc: { loyaltyPoints: loyaltyPointsEarned, lifetimeLoyaltyPoints: loyaltyPointsEarned } },
            { new: true, session, setDefaultsOnInsert: false },
          );
          if (!rewardedCustomer) throw new NotFoundException('Customer not found while applying loyalty rewards');
          rewardedCustomer.loyaltyTier = this.loyaltyTier(rewardedCustomer.lifetimeLoyaltyPoints ?? 0);
          await rewardedCustomer.save({ session });
          await this.loyaltyLedger.create([{
            tenantId: new Types.ObjectId(tenantId),
            customerId: linkedCustomer._id,
            eventType: 'SALE_EARN',
            sourceType: 'SALE',
            sourceId: invoice._id.toString(),
            points: loyaltyPointsEarned,
            pointsDelta: loyaltyPointsEarned,
            balanceAfter: rewardedCustomer.loyaltyPoints,
            reason: `Rewards earned on invoice ${invoiceNumber}`,
            createdBy: new Types.ObjectId(userId),
          }], { session });
        }
        const saleLines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];
        for (const payment of payments) {
          saleLines.push({
            accountCode: payment.method === 'CASH' ? '1000' : '1010',
            debit: payment.amount, credit: 0, description: `Invoice payment - ${payment.method}`,
          });
        }
        if (duePaise > 0) saleLines.push({
          accountCode: '1100', debit: this.fromPaise(duePaise), credit: 0,
          description: `Customer receivable - ${customerName || 'Walk-in'}`,
        });
        if (taxableTotalPaise > 0) saleLines.push({
          accountCode: '4000', debit: 0, credit: this.fromPaise(taxableTotalPaise),
          description: 'Sales revenue',
        });
        if (totalTaxPaise > 0) saleLines.push({
          accountCode: '2100', debit: 0, credit: this.fromPaise(totalTaxPaise),
          description: 'Output GST liability',
        });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: now, narration: `Sales invoice ${invoiceNumber}`,
          sourceType: 'SALES', sourceId: invoice._id.toString(), lines: saleLines, session,
        });
        if (totalCogsPaise > 0) {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: now,
            narration: `Cost of goods sold for ${invoiceNumber}`,
            sourceType: 'INVENTORY', sourceId: `SALE_COGS:${invoice._id.toString()}`,
            lines: [
              { accountCode: '5000', debit: this.fromPaise(totalCogsPaise), credit: 0, description: 'Cost of goods sold' },
              { accountCode: '1200', debit: 0, credit: this.fromPaise(totalCogsPaise), description: 'Inventory asset relieved' },
            ],
            session,
          });
        }
        result = invoice;
      });

      return result;
    } catch (error) {
      if ((error as any)?.code === 11000) {
        const duplicateInvoice = await this.invoices
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .lean();

        if (duplicateInvoice) {
          if (duplicateInvoice.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different sale.',
            );
          }

          return duplicateInvoice;
        }
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  async addPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: AddSalePaymentDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, or invoice ID.',
      );
    }

    const amountPaise = this.toPaise(dto.amount);

    if (amountPaise <= 0) {
      throw new BadRequestException(
        'Payment amount must be greater than zero.',
      );
    }

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(invoiceId),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may be cancelled or belong to another business.',
          );
        }

        const existingPayment = invoice.payments.find(
  (payment) => payment.idempotencyKey === dto.idempotencyKey,
);

if (existingPayment) {
  const samePayment =
    existingPayment.method === dto.method &&
    this.toPaise(existingPayment.amount) === amountPaise &&
    (existingPayment.reference || '') === (dto.reference || '');

  if (!samePayment) {
    throw new ConflictException(
      'This idempotency key has already been used for a different payment.',
    );
  }

  // Return the existing invoice without recording the payment again.
  result = invoice;
  return;
}

        const currentDuePaise = this.toPaise(invoice.dueAmount);

        if (currentDuePaise <= 0) {
          throw new ConflictException(
            'This invoice is already fully paid.',
          );
        }

        if (amountPaise > currentDuePaise) {
          throw new BadRequestException(
            `Payment exceeds the outstanding balance of ${this.fromPaise(currentDuePaise).toFixed(2)}.`,
          );
        }
        const newDuePaise = currentDuePaise - amountPaise;

        const paymentStatus =
          newDuePaise === 0 ? 'PAID' : 'PARTIALLY_PAID';

        const updated = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
            paidAmount: invoice.paidAmount,
            dueAmount: invoice.dueAmount,
          }),
          {
            $inc: {
              paidAmount: this.fromPaise(amountPaise),
              dueAmount: -this.fromPaise(amountPaise),
            },
            $set: {
              paymentStatus,
            },
            $push: {
              payments: {
  idempotencyKey: dto.idempotencyKey,
  method: dto.method,
  amount: this.fromPaise(amountPaise),
  reference: dto.reference || '',
  paidAt: new Date(),
  receivedBy: new Types.ObjectId(userId),
},
            },
          },
          {
            new: true,
            session,
          },
        );

        if (!updated) {
          throw new ConflictException(
            'Invoice balance changed while recording payment. Please refresh and retry.',
          );
        }

        const paymentAccount = dto.method === 'CASH' ? '1000' : '1010';
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(), narration: `Payment received for ${invoice.invoiceNumber}`,
          sourceType: 'PAYMENT', sourceId: `SALE_PAYMENT:${invoice._id.toString()}:${dto.idempotencyKey}`,
          lines: [
            { accountCode: paymentAccount, debit: this.fromPaise(amountPaise), credit: 0, description: `Received via ${dto.method}` },
            { accountCode: '1100', debit: 0, credit: this.fromPaise(amountPaise), description: 'Customer receivable settlement' },
          ], session,
        });
        result = updated;
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
  async createCreditNote(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: CreateCreditNoteDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, or invoice ID.',
      );
    }

    const reason = dto.reason?.trim();

    if (!reason || reason.length < 3 || reason.length > 250) {
      throw new BadRequestException(
        'Credit-note reason must contain 3 to 250 characters.',
      );
    }

    const lineIndexes = dto.items.map((item) => item.lineIndex);

    const requestedSerials = dto.items.flatMap(item => item.serialNumbers || []).map(value => value.trim().toUpperCase());
    if (new Set(requestedSerials).size !== requestedSerials.length) throw new BadRequestException('A serial number can be returned only once per credit note');

    if (new Set(lineIndexes).size !== lineIndexes.length) {
      throw new BadRequestException(
        'A credit note cannot contain the same invoice line more than once.',
      );
    }

    const idempotencyKey = dto.idempotencyKey.trim().toLowerCase();

    const fingerprintPayload = {
      invoiceId,
      reason,
      items: dto.items
        .map((item) => ({
          lineIndex: item.lineIndex,
          quantity: item.quantity,
          restock: item.restock !== false,
          serialNumbers: [...(item.serialNumbers || [])].map(value => value.trim().toUpperCase()).sort(),
        }))
        .sort((a, b) => a.lineIndex - b.lineIndex),
    };

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(fingerprintPayload))
      .digest('hex');

    const existingCreditNote = await this.creditNotes
      .findOne(tenantFilter(tenantId, { idempotencyKey }))
      .lean();

    if (existingCreditNote) {
      if (existingCreditNote.requestFingerprint !== requestFingerprint) {
        throw new ConflictException(
          'This idempotency key has already been used for a different credit note.',
        );
      }

      const existingInvoice = await this.invoices
        .findOne(tenantFilter(tenantId, { _id: existingCreditNote.invoiceId }))
        .lean();

      if (!existingInvoice) {
        throw new NotFoundException('Credit note invoice not found.');
      }

      return { creditNote: existingCreditNote, invoice: existingInvoice };
    }

    const creditNoteDate = new Date();
    const fy = this.financialYear(creditNoteDate);

    await this.ensureCreditNoteCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const transactionDuplicate = await this.creditNotes
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .session(session)
          .lean();

        if (transactionDuplicate) {
          if (transactionDuplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different credit note.',
            );
          }

          const duplicateInvoice = await this.invoices
            .findOne(
              tenantFilter(tenantId, { _id: transactionDuplicate.invoiceId }),
            )
            .session(session)
            .lean();

          if (!duplicateInvoice) {
            throw new NotFoundException('Credit note invoice not found.');
          }

          result = {
            creditNote: transactionDuplicate,
            invoice: duplicateInvoice,
          };
          return;
        }

        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(invoiceId),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may be cancelled or belong to another business.',
          );
        }

        await this.taxPeriods.assertOpen(tenantId, creditNoteDate, session);
        const previousNotes = await this.creditNotes
          .find(
            tenantFilter(tenantId, {
              invoiceId: invoice._id,
            }),
          )
          .session(session)
          .lean();

        const creditNumber = await this.nextCreditNoteNumber(
          tenantId,
          fy,
          session,
        );

        const creditLines: any[] = [];

        let discountTotalPaise = 0;
        let taxableTotalPaise = 0;
        let cgstTotalPaise = 0;
        let sgstTotalPaise = 0;
        let igstTotalPaise = 0;
        let taxTotalPaise = 0;
        let totalAmountPaise = 0;
        let restockedCostPaise = 0;

        for (const requested of dto.items) {
          const original = invoice.items[requested.lineIndex];

          if (!original) {
            throw new BadRequestException(
              `Invalid invoice line index: ${requested.lineIndex}.`,
            );
          }

          const previousReturnedQty = previousNotes.reduce(
            (sum, note) =>
              sum +
              note.items
                .filter(
                  (line: any) => line.lineIndex === requested.lineIndex,
                )
                .reduce(
                  (lineSum: number, line: any) =>
                    lineSum + line.quantity,
                  0,
                ),
            0,
          );

          const remainingQty =
            original.quantity - previousReturnedQty;

          if (requested.quantity > remainingQty) {
            throw new BadRequestException(
              `Return quantity exceeds the remaining quantity for "${original.name}". Remaining: ${remainingQty}.`,
            );
          }

          const originalSerials = (original.serialNumbers || []).map((value: string) => value.toUpperCase());
          const returnedSerials = previousNotes.flatMap((note: any) => note.items
            .filter((line: any) => line.lineIndex === requested.lineIndex)
            .flatMap((line: any) => line.serialNumbers || []));
          const requestedSerials = (requested.serialNumbers || []).map(value => value.trim().toUpperCase());
          if (originalSerials.length) {
            if (requestedSerials.length !== requested.quantity) throw new BadRequestException(`Select exactly ${requested.quantity} sold serial number(s) for "${original.name}".`);
            if (new Set(requestedSerials).size !== requestedSerials.length || requestedSerials.some(value => !originalSerials.includes(value) || returnedSerials.includes(value))) {
              throw new ConflictException(`One or more selected serials for "${original.name}" were not sold on this invoice or were already returned.`);
            }
          } else if (requestedSerials.length) {
            throw new BadRequestException(`This invoice line for "${original.name}" does not contain serialized units.`);
          }

          const previousLineReturns = previousNotes.flatMap((note) =>
            note.items.filter(
              (line: any) => line.lineIndex === requested.lineIndex,
            ),
          );

          const originalBatchAllocations = (original.batchAllocations || []).map((row: any) => ({ batchId: row.batchId, quantity: Number(row.quantity) }));
          const batchReturnAllocations: Array<{ batchId: Types.ObjectId; quantity: number }> = [];
          if (originalBatchAllocations.length) {
            let batchNeeded = requested.quantity;
            for (const allocation of originalBatchAllocations) {
              const alreadyReturned = previousLineReturns.reduce((sum: number, line: any) =>
                sum + (line.batchAllocations || []).filter((row: any) => String(row.batchId) === String(allocation.batchId)).reduce((value: number, row: any) => value + Number(row.quantity || 0), 0), 0);
              const availableFromBatch = Math.max(0, allocation.quantity - alreadyReturned);
              const take = Math.min(batchNeeded, availableFromBatch);
              if (take <= 0) continue;
              if (requested.restock !== false) {
                const batchRow: any = await this.connection.db!.collection('inventory_batches').findOne({
                  _id: allocation.batchId, tenantId: new Types.ObjectId(tenantId), productId: original.productId,
                }, { session });
                if (!batchRow || batchRow.status === 'EXPIRED' || new Date(batchRow.expiresAt) <= creditNoteDate) {
                  throw new ConflictException(`The original batch for "${original.name}" has expired or is unavailable. Issue this return without restocking the units.`);
                }
              }
              batchReturnAllocations.push({ batchId: allocation.batchId, quantity: take });
              batchNeeded -= take;
              if (batchNeeded <= 0) break;
            }
            if (batchNeeded > 0) throw new ConflictException(`Returned quantity for "${original.name}" exceeds its original batch allocation.`);
          }

          const cumulativeQty =
            previousReturnedQty + requested.quantity;

          const allocateComponent = (
            originalAmount: number,
            component: string,
          ): number => {
            const originalPaise = this.toPaise(originalAmount);

            const alreadyCreditedPaise = previousLineReturns.reduce(
              (sum: number, line: any) =>
                sum + this.toPaise(Number(line[component] || 0)),
              0,
            );

            const cumulativeCreditedPaise = Math.round(
              (originalPaise * cumulativeQty) / original.quantity,
            );

            return cumulativeCreditedPaise - alreadyCreditedPaise;
          };

          const discountPaise = allocateComponent(
            original.discountAmount,
            'discountAmount',
          );
          const taxablePaise = allocateComponent(
            original.taxableValue,
            'taxableValue',
          );
          const cgstPaise = allocateComponent(
            original.cgstAmount,
            'cgstAmount',
          );
          const sgstPaise = allocateComponent(
            original.sgstAmount,
            'sgstAmount',
          );
          const igstPaise = allocateComponent(
            original.igstAmount,
            'igstAmount',
          );
          const taxPaise = allocateComponent(
            original.totalTax,
            'totalTax',
          );
          const lineTotalPaise = allocateComponent(
            original.lineTotal,
            'lineTotal',
          );

          if (
            [
              discountPaise,
              taxablePaise,
              cgstPaise,
              sgstPaise,
              igstPaise,
              taxPaise,
              lineTotalPaise,
            ].some((amount) => amount < 0)
          ) {
            throw new ConflictException(
              'Credit-note calculation produced an invalid negative amount.',
            );
          }

          const shouldRestock = requested.restock !== false;
          const restocked = shouldRestock && original.stockTracked;

          creditLines.push({
            lineIndex: requested.lineIndex,
            productId: original.productId,
            name: original.name,
            sku: original.sku || '',
            quantity: requested.quantity,
            unitPrice: original.unitPrice,
            discountAmount: this.fromPaise(discountPaise),
            taxableValue: this.fromPaise(taxablePaise),
            gstRate: original.gstRate,
            cgstAmount: this.fromPaise(cgstPaise),
            sgstAmount: this.fromPaise(sgstPaise),
            igstAmount: this.fromPaise(igstPaise),
            totalTax: this.fromPaise(taxPaise),
            lineTotal: this.fromPaise(lineTotalPaise),
            restocked,
            serialNumbers: requestedSerials,
            batchAllocations: batchReturnAllocations,
          });

          discountTotalPaise += discountPaise;
          taxableTotalPaise += taxablePaise;
          cgstTotalPaise += cgstPaise;
          sgstTotalPaise += sgstPaise;
          igstTotalPaise += igstPaise;
          taxTotalPaise += taxPaise;
          totalAmountPaise += lineTotalPaise;

          if (restocked) {
            const product = await this.products
              .findOne(
                tenantFilter(tenantId, {
                  _id: original.productId,
                }),
              )
              .session(session);

            if (!product) {
              throw new ConflictException(
                `Cannot restore stock because product "${original.name}" no longer exists in this business.`,
              );
            }

            const previousQty = product.stockQty || 0;
            if (previousQty > 0 && !product.valuationInitialized) {
              throw new ConflictException(`Opening inventory valuation is required before restocking "${original.name}".`);
            }
            const newQty = previousQty + requested.quantity;
            let movementPreviousQty = previousQty;
            let movementNewQty = newQty;
            const returnedUnitCostPaise = invoice.costingVersion === 1
              ? this.toPaise(original.unitCostAtSale || 0)
              : this.toPaise(product.averageCost || 0);
            const returnedCostPaise = returnedUnitCostPaise * requested.quantity;
            const productPreviousValuePaise = this.toPaise(product.inventoryValue || 0);
            const productNewValuePaise = productPreviousValuePaise + returnedCostPaise;
            let warehousePreviousValuePaiseForMovement: number | undefined;
            let warehouseNewValuePaiseForMovement: number | undefined;
            restockedCostPaise += returnedCostPaise;

            if (invoice.warehouseId) {
              const warehouseStock = await this.warehouseStocks.findOne(tenantFilter(tenantId, {
                warehouseId: invoice.warehouseId, productId: product._id,
              })).session(session);
              const warehousePreviousQty = warehouseStock?.quantity || 0;
              const warehousePreviousValuePaise = this.toPaise(warehouseStock?.inventoryValue || 0);
              warehousePreviousValuePaiseForMovement = warehousePreviousValuePaise;
              const warehouseNextQty = warehousePreviousQty + requested.quantity;
              movementPreviousQty = warehousePreviousQty;
              movementNewQty = warehouseNextQty;
              const warehouseNextValuePaise = warehousePreviousValuePaise + returnedCostPaise;
              warehouseNewValuePaiseForMovement = warehouseNextValuePaise;
              if (warehouseStock) {
                const restoredWarehouse = await this.warehouseStocks.findOneAndUpdate(
                  tenantFilter(tenantId, { _id: warehouseStock._id, quantity: warehousePreviousQty }),
                  { $set: {
                    quantity: warehouseNextQty,
                    inventoryValue: this.fromPaise(warehouseNextValuePaise),
                    averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
                  } },
                  { new: true, session, runValidators: true },
                );
                if (!restoredWarehouse) throw new ConflictException(`Warehouse stock changed while returning "${original.name}". Please retry.`);
              } else {
                await this.warehouseStocks.create([{
                  tenantId: new Types.ObjectId(tenantId), warehouseId: invoice.warehouseId,
                  productId: product._id, quantity: warehouseNextQty,
                  inventoryValue: this.fromPaise(warehouseNextValuePaise),
                  averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
                }], { session });
              }
            }

            const updatedProduct = await this.products.findOneAndUpdate(
              tenantFilter(tenantId, {
                _id: product._id,
                stockQty: previousQty,
              }),
              { $set: {
                stockQty: newQty,
                inventoryValue: this.fromPaise(productNewValuePaise),
                averageCost: newQty > 0
                  ? this.fromPaise(Math.round(productNewValuePaise / newQty))
                  : product.averageCost,
                valuationInitialized: product.valuationInitialized || returnedCostPaise > 0,
              } },
              { new: true, session, runValidators: true },
            );

            if (!updatedProduct) {
              throw new ConflictException(
                `Stock changed while returning "${original.name}". Please retry.`,
              );
            }

            await this.movements.create(
              [
                {
                  tenantId: new Types.ObjectId(tenantId),
                  productId: product._id,
                  ...(invoice.warehouseId ? { warehouseId: invoice.warehouseId } : {}),
                  type: 'SALE_RETURN',
                  quantityDelta: requested.quantity,
                  previousQty: movementPreviousQty,
                  newQty: movementNewQty,
                  reason: `Credit note ${creditNumber}: ${reason}`.slice(
                    0,
                    250,
                  ),
                  performedBy: new Types.ObjectId(userId),
                  valuation: {
                    unitCostPaise: returnedUnitCostPaise,
                    productPreviousValuePaise,
                    productValueDeltaPaise: returnedCostPaise,
                    productNewValuePaise,
                    ...(invoice.warehouseId ? {
                      warehousePreviousValuePaise: warehousePreviousValuePaiseForMovement ?? 0,
                      warehouseValueDeltaPaise: returnedCostPaise,
                      warehouseNewValuePaise: warehouseNewValuePaiseForMovement ?? returnedCostPaise,
                    } : {}),
                  },
                },
              ],
              { session },
            );
          }
        }

        const creditTotalPaise = totalAmountPaise;
        const currentDuePaise = this.toPaise(invoice.dueAmount);
        const appliedToDuePaise = Math.min(
          creditTotalPaise,
          currentDuePaise,
        );
        const refundablePaise =
          creditTotalPaise - appliedToDuePaise;

        const newCreditedPaise =
          this.toPaise(Number(invoice.creditedAmount || 0)) +
          creditTotalPaise;

        const newDuePaise = currentDuePaise - appliedToDuePaise;
        const paidPaise = this.toPaise(invoice.paidAmount);

        const paymentStatus =
          newDuePaise === 0
            ? paidPaise === 0
              ? 'CREDITED'
              : 'PAID'
            : paidPaise > 0
              ? 'PARTIALLY_PAID'
              : 'UNPAID';

        const updatedInvoice = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
            dueAmount: invoice.dueAmount,
            creditedAmount: invoice.creditedAmount || 0,
          }),
          {
            $set: {
              creditedAmount: this.fromPaise(newCreditedPaise),
              dueAmount: this.fromPaise(newDuePaise),
              paymentStatus,
            },
          },
          { new: true, session },
        );

        if (!updatedInvoice) {
          throw new ConflictException(
            'Invoice balance changed while creating the credit note. Please retry.',
          );
        }

        const [created] = await this.creditNotes.create(
          [
            {
              tenantId: new Types.ObjectId(tenantId),
              invoiceId: invoice._id,
              idempotencyKey,
              requestFingerprint,
              creditNoteNumber: creditNumber,
              financialYear: fy,
              creditNoteDate,
              originalInvoiceNumber: invoice.invoiceNumber,
              items: creditLines,
              discountTotal: this.fromPaise(discountTotalPaise),
              taxableValue: this.fromPaise(taxableTotalPaise),
              cgstTotal: this.fromPaise(cgstTotalPaise),
              sgstTotal: this.fromPaise(sgstTotalPaise),
              igstTotal: this.fromPaise(igstTotalPaise),
              totalTax: this.fromPaise(taxTotalPaise),
              totalAmount: this.fromPaise(creditTotalPaise),
              appliedToDueAmount: this.fromPaise(appliedToDuePaise),
              refundableAmount: this.fromPaise(refundablePaise),
              refundedAmount: 0,
              refunds: [],
              reason,
              createdBy: new Types.ObjectId(userId),
            },
          ],
          { session },
        );

        for (const line of creditLines) {
          if (line.restocked) {
            for (const allocation of line.batchAllocations || []) {
              const restoredBatch = await this.connection.db!.collection('inventory_batches').updateOne(
                { _id: allocation.batchId, tenantId: new Types.ObjectId(tenantId), productId: line.productId, status: { $in: ['ACTIVE', 'DEPLETED'] }, expiresAt: { $gt: creditNoteDate } },
                { $inc: { quantity: allocation.quantity }, $set: { status: 'ACTIVE' } },
                { session },
              );
              if (restoredBatch.modifiedCount !== 1) throw new ConflictException('Original batch changed during return; please retry');
            }
          }
          const serialNumbers = line.serialNumbers || [];
          if (!serialNumbers.length) continue;
          const updatedSerials = await this.connection.db!.collection('inventory_serials').updateMany(
            { tenantId: new Types.ObjectId(tenantId), productId: line.productId, saleInvoiceId: invoice._id, serialNumber: { $in: serialNumbers }, status: 'SOLD' },
            { $set: { status: line.restocked ? 'IN_STOCK' : 'RETURNED' } },
            { session },
          );
          if (updatedSerials.modifiedCount !== serialNumbers.length) throw new ConflictException('Serial status changed while processing this return; please retry');
        }

        // Reverse earned loyalty points proportionally to cumulative taxable returns.
        // Already-spent points are not driven negative; the actual deduction is auditable.
        if (invoice.customerId && Number(invoice.taxableValue || 0) > 0) {
          const earned = await this.loyaltyLedger.findOne(tenantFilter(tenantId, {
            customerId: invoice.customerId, sourceType: 'SALE', sourceId: invoice._id.toString(), eventType: 'SALE_EARN',
          })).session(session).lean();
          if (earned && Number(earned.points || 0) > 0) {
            const previousCreditNoteIds = previousNotes.map((note: any) => note._id);
            const previousClawbacks = previousCreditNoteIds.length
              ? await this.loyaltyLedger.find(tenantFilter(tenantId, {
                  customerId: invoice.customerId, sourceType: 'CREDIT_NOTE', eventType: 'RETURN_CLAWBACK',
                  sourceId: { $in: previousCreditNoteIds.map((id: any) => String(id)) },
                })).session(session).lean()
              : [];
            const earnedPoints = Number(earned.points || 0);
            const previouslyClawedBack = previousClawbacks.reduce((sum: number, row: any) => sum + row.points, 0);
            const cumulativeReturnedTaxablePaise = previousNotes.reduce((sum: number, note: any) => sum + this.toPaise(note.taxableValue || 0), 0) + taxableTotalPaise;
            const originalTaxablePaise = this.toPaise(invoice.taxableValue);
            const targetClawback = Math.min(earnedPoints, cumulativeReturnedTaxablePaise >= originalTaxablePaise
              ? earnedPoints
              : Math.floor(earnedPoints * cumulativeReturnedTaxablePaise / originalTaxablePaise));
            const requestedClawback = Math.max(0, targetClawback - previouslyClawedBack);
            if (requestedClawback > 0) {
              const customer = await this.customers.findOne(tenantFilter(tenantId, { _id: invoice.customerId, isDeleted: false })).session(session);
              if (!customer) throw new ConflictException('Linked customer is unavailable for loyalty reversal');
              const actualClawback = Math.min(customer.loyaltyPoints || 0, requestedClawback);
              if (actualClawback > 0) {
                customer.loyaltyPoints = (customer.loyaltyPoints || 0) - actualClawback;
                await customer.save({ session });
                await this.loyaltyLedger.create([{
                  tenantId: new Types.ObjectId(tenantId), customerId: invoice.customerId,
                  eventType: 'RETURN_CLAWBACK', sourceType: 'CREDIT_NOTE', sourceId: String(created._id),
                  points: actualClawback, pointsDelta: -actualClawback, balanceAfter: customer.loyaltyPoints,
                  reason: `Loyalty points reversed for credit note ${creditNumber}; returned taxable value ₹${this.fromPaise(taxableTotalPaise).toFixed(2)}`,
                  createdBy: new Types.ObjectId(userId),
                }], { session });
              }
            }
          }
        }

        const creditJournalLines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];
        if (taxableTotalPaise > 0) creditJournalLines.push({
          accountCode: '4000', debit: this.fromPaise(taxableTotalPaise), credit: 0,
          description: 'Sales revenue reversal',
        });
        if (taxTotalPaise > 0) creditJournalLines.push({
          accountCode: '2100', debit: this.fromPaise(taxTotalPaise), credit: 0,
          description: 'Output GST liability reversal',
        });
        if (appliedToDuePaise > 0) creditJournalLines.push({
          accountCode: '1100', debit: 0, credit: this.fromPaise(appliedToDuePaise),
          description: 'Credit applied to customer receivable',
        });
        if (refundablePaise > 0) creditJournalLines.push({
          accountCode: '2200', debit: 0, credit: this.fromPaise(refundablePaise),
          description: 'Customer refund payable',
        });
        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: creditNoteDate,
          narration: `Credit note ${creditNumber} against ${invoice.invoiceNumber}: ${reason}`,
          sourceType: 'REFUND', sourceId: `CREDIT_NOTE:${created._id.toString()}`,
          lines: creditJournalLines, session,
        });
        if (restockedCostPaise > 0) {
          await this.accounting.postOperationalJournal({
            tenantId, userId, postingDate: creditNoteDate,
            narration: `Inventory restored by credit note ${creditNumber}`,
            sourceType: 'INVENTORY', sourceId: `CREDIT_NOTE_COGS:${created._id.toString()}`,
            lines: [
              { accountCode: '1200', debit: this.fromPaise(restockedCostPaise), credit: 0, description: 'Returned inventory at original cost' },
              { accountCode: '5000', debit: 0, credit: this.fromPaise(restockedCostPaise), description: 'Reverse cost of goods sold' },
            ],
            session,
          });
        }
        result = {
          creditNote: created,
          invoice: updatedInvoice,
        };
      });

      return result;
    } catch (error) {
      if ((error as any)?.code === 11000) {
        const duplicate = await this.creditNotes
          .findOne(tenantFilter(tenantId, { idempotencyKey }))
          .lean();

        if (duplicate) {
          if (duplicate.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'This idempotency key has already been used for a different credit note.',
            );
          }

          const duplicateInvoice = await this.invoices
            .findOne(tenantFilter(tenantId, { _id: duplicate.invoiceId }))
            .lean();

          if (!duplicateInvoice) {
            throw new NotFoundException('Credit note invoice not found.');
          }

          return { creditNote: duplicate, invoice: duplicateInvoice };
        }
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  async findInvoiceWarranties(tenantId: string, invoiceId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(invoiceId)) throw new BadRequestException('Invalid tenant or invoice ID');
    const invoice = await this.invoices.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(invoiceId) })).lean();
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.warranties.updateMany(
      tenantFilter(tenantId, { invoiceId: invoice._id, status: 'ACTIVE', coverageEndsAt: { $lte: new Date() } }),
      { $set: { status: 'EXPIRED' } },
    );
    return this.warranties.find(tenantFilter(tenantId, { invoiceId: invoice._id })).sort({ lineIndex: 1 }).lean();
  }

  async createWarrantyClaim(tenantId: string, userId: string, invoiceId: string, warrantyId: string, dto: CreateWarrantyClaimDto) {
    if (![tenantId, userId, invoiceId, warrantyId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user, invoice or warranty ID');
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1 || !dto.issueDescription?.trim()) throw new BadRequestException('A valid claim quantity and issue description are required');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const warranty = await this.warranties.findOne(tenantFilter(tenantId, {
          _id: new Types.ObjectId(warrantyId), invoiceId: new Types.ObjectId(invoiceId),
        })).session(session);
        if (!warranty) throw new NotFoundException('Warranty registration not found for this invoice');
        if (warranty.coverageEndsAt <= new Date()) {
          if (warranty.status !== 'EXPIRED') { warranty.status = 'EXPIRED'; await warranty.save({ session }); }
          throw new ConflictException('Warranty coverage has expired');
        }
        if (warranty.claimedQuantity + dto.quantity > warranty.quantity) throw new ConflictException('Claim quantity exceeds the unclaimed warranty quantity');
        const previousClaimed = warranty.claimedQuantity;
        const updated = await this.warranties.findOneAndUpdate(
          tenantFilter(tenantId, { _id: warranty._id, claimedQuantity: previousClaimed, coverageEndsAt: { $gt: new Date() } }),
          { $inc: { claimedQuantity: dto.quantity } },
          { new: true, session },
        );
        if (!updated) throw new ConflictException('Warranty claim quantity changed concurrently. Refresh and retry.');
        if (updated.claimedQuantity >= updated.quantity) {
          updated.status = 'CLAIMED';
          await updated.save({ session });
        }
        const [claim] = await this.warrantyClaims.create([{
          tenantId: new Types.ObjectId(tenantId), warrantyId: warranty._id,
          invoiceId: warranty.invoiceId, claimCode: 'WC' + randomBytes(6).toString('hex').toUpperCase(),
          quantity: dto.quantity, issueDescription: dto.issueDescription.trim(),
          status: 'OPEN', createdBy: new Types.ObjectId(userId), history: [{ status: 'OPEN', reason: 'Warranty claim submitted', actorId: new Types.ObjectId(userId), occurredAt: new Date() }],
        }], { session });
        result = claim;
      });
      return result;
    } finally { await session.endSession(); }
  }

  async listWarrantyClaims(tenantId: string, page = 1, limit = 20, status?: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const filter: any = tenantFilter(tenantId, {});
    if (status) {
      const normalized = status.toUpperCase();
      if (!['OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'].includes(normalized)) throw new BadRequestException('Invalid warranty claim status');
      filter.status = normalized;
    }
    const [items, total] = await Promise.all([
      this.warrantyClaims.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.warrantyClaims.countDocuments(filter),
    ]);
    return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async reviewWarrantyClaim(tenantId: string, userId: string, claimId: string, dto: ReviewWarrantyClaimDto) {
    if (![tenantId, userId, claimId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user or claim ID');
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 5 || reason.length > 500) throw new BadRequestException('Review reason must contain 5 to 500 characters');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const claim = await this.warrantyClaims.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(claimId) })).session(session);
        if (!claim) throw new NotFoundException('Warranty claim not found');
        if (claim.status === 'REJECTED' || claim.status === 'RESOLVED') throw new ConflictException('Rejected or resolved warranty claims cannot be changed');
        if (claim.status === 'APPROVED' && dto.status !== 'RESOLVED') throw new ConflictException('An approved claim can only be marked resolved');
        if (dto.status === 'RESOLVED' && !dto.resolutionType) throw new BadRequestException('Choose a resolution type before resolving the claim');
        if ((dto.status === 'APPROVED' || dto.status === 'RESOLVED') && !dto.resolutionType) throw new BadRequestException('An approved claim requires a resolution type');
        const warranty = await this.warranties.findOne(tenantFilter(tenantId, { _id: claim.warrantyId })).session(session);
        if (!warranty) throw new NotFoundException('Warranty registration not found');
        let creditNote: any = null;
        let replacementInvoice: any = null;
        if (dto.resolutionType === 'REFUND' || dto.resolutionType === 'EXCHANGE') {
          if (!dto.creditNoteId) throw new BadRequestException('A linked credit note is required for refund or exchange resolution');
          creditNote = await this.creditNotes.findOne(tenantFilter(tenantId, {
            _id: new Types.ObjectId(dto.creditNoteId), invoiceId: warranty.invoiceId,
          })).session(session).lean();
          if (!creditNote || !creditNote.items.some((line: any) => String(line.productId) === String(warranty.productId) && line.quantity >= claim.quantity)) {
            throw new BadRequestException('The credit note must return the claimed product and quantity from the original invoice');
          }
        }
        if (dto.resolutionType === 'EXCHANGE') {
          if (!dto.replacementInvoiceId) throw new BadRequestException('A replacement invoice is required for exchange resolution');
          replacementInvoice = await this.invoices.findOne(tenantFilter(tenantId, {
            _id: new Types.ObjectId(dto.replacementInvoiceId), status: 'ISSUED',
            ...(warranty.customerId ? { customerId: warranty.customerId } : {}),
          })).session(session).lean();
          if (!replacementInvoice || !replacementInvoice.items.some((line: any) => String(line.productId) === String(warranty.productId) && line.quantity >= claim.quantity)) {
            throw new BadRequestException('Replacement invoice must be issued to the same customer and contain the exchanged product quantity');
          }
        }
        if (dto.status === 'REJECTED') {
          await this.warranties.updateOne(
            tenantFilter(tenantId, { _id: warranty._id }),
            { $inc: { claimedQuantity: -claim.quantity }, $set: { status: warranty.coverageEndsAt > new Date() ? 'ACTIVE' : 'EXPIRED' } },
            { session },
          );
        }
        claim.status = dto.status;
        claim.history.push({ status: dto.status, reason, actorId: new Types.ObjectId(userId), occurredAt: new Date() } as any);
        claim.reviewReason = reason;
        claim.reviewedBy = new Types.ObjectId(userId);
        claim.reviewedAt = new Date();
        if (dto.resolutionType) claim.resolutionType = dto.resolutionType;
        if (creditNote) claim.creditNoteId = creditNote._id;
        if (replacementInvoice) claim.replacementInvoiceId = replacementInvoice._id;
        await claim.save({ session });
        result = claim;
      });
      return result;
    } finally { await session.endSession(); }
  }

  async findCreditNotes(tenantId: string, invoiceId: string) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(invoiceId)
    ) {
      throw new BadRequestException(
        'Invalid tenant or invoice ID.',
      );
    }

    const invoice = await this.invoices.findOne(
      tenantFilter(tenantId, {
        _id: new Types.ObjectId(invoiceId),
      }),
    );

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    return this.creditNotes
      .find(
        tenantFilter(tenantId, {
          invoiceId: invoice._id,
        }),
      )
      .sort({ creditNoteDate: -1, createdAt: -1 })
      .lean();
  }
  async addCreditNoteRefund(
    tenantId: string,
    userId: string,
    invoiceId: string,
    creditNoteId: string,
    dto: AddCreditNoteRefundDto,
  ) {
    if (
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(invoiceId) ||
      !Types.ObjectId.isValid(creditNoteId)
    ) {
      throw new BadRequestException(
        'Invalid tenant, user, invoice, or credit note ID.',
      );
    }

    const amountPaise = this.toPaise(Number(dto.amount));
    const reference = dto.reference?.trim() || '';

    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new BadRequestException('Refund amount must be positive.');
    }

    let result: any;
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        const filter = tenantFilter(tenantId, {
          _id: new Types.ObjectId(creditNoteId),
          invoiceId: new Types.ObjectId(invoiceId),
        });

        const creditNote = await this.creditNotes
          .findOne(filter)
          .session(session)
          .lean();

        if (!creditNote) {
          throw new NotFoundException('Credit note not found.');
        }

        const refunds = creditNote.refunds || [];

        const existingRefund = refunds.find(
          (refund: any) =>
            refund.idempotencyKey === dto.idempotencyKey,
        );

        if (existingRefund) {
          const sameRequest =
            this.toPaise(Number(existingRefund.amount)) === amountPaise &&
            existingRefund.method === dto.method &&
            (existingRefund.reference || '') === reference;

          if (!sameRequest) {
            throw new ConflictException(
              'This idempotency key was already used with different refund details.',
            );
          }

          result = {
            creditNote,
            refund: existingRefund,
            duplicate: true,
          };
          return;
        }

        const refundablePaise = this.toPaise(
          Number(creditNote.refundableAmount || 0),
        );

        const alreadyRefundedPaise = this.toPaise(
          Number(creditNote.refundedAmount || 0),
        );

        const remainingPaise =
          refundablePaise - alreadyRefundedPaise;

        if (amountPaise > remainingPaise) {
          throw new BadRequestException(
            `Refund exceeds the remaining refundable amount of ${this.fromPaise(Math.max(0, remainingPaise)).toFixed(2)}.`,
          );
        }

        const updatedCreditNote = await this.creditNotes
          .findOneAndUpdate(
            {
              ...filter,
              refundedAmount: creditNote.refundedAmount || 0,
            },
            {
              $set: {
                refundedAmount: this.fromPaise(
                  alreadyRefundedPaise + amountPaise,
                ),
              },
              $push: {
                refunds: {
                  idempotencyKey: dto.idempotencyKey,
                  method: dto.method,
                  amount: this.fromPaise(amountPaise),
                  reference,
                  refundedAt: new Date(),
                  refundedBy: new Types.ObjectId(userId),
                },
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          )
          .lean();

        if (!updatedCreditNote) {
          throw new ConflictException(
            'Credit note changed during refund. Please retry.',
          );
        }

        const savedRefund = (updatedCreditNote.refunds || []).find(
          (refund: any) =>
            refund.idempotencyKey === dto.idempotencyKey,
        );

        await this.accounting.postOperationalJournal({
          tenantId, userId, postingDate: new Date(),
          narration: `Refund paid for credit note ${creditNote.creditNoteNumber}`,
          sourceType: 'PAYMENT',
          sourceId: `CREDIT_NOTE_REFUND:${creditNote._id.toString()}:${dto.idempotencyKey}`,
          lines: [
            { accountCode: '2200', debit: this.fromPaise(amountPaise), credit: 0, description: 'Settle customer refund payable' },
            { accountCode: dto.method === 'CASH' ? '1000' : '1010', debit: 0, credit: this.fromPaise(amountPaise), description: `Refund via ${dto.method}` },
          ], session,
        });
        result = {
          creditNote: updatedCreditNote,
          refund: savedRefund,
          duplicate: false,
        };
      });
    } finally {
      await session.endSession();
    }

    return result;
  }
  async listAvailableSerials(tenantId: string, warehouseId: string, productId?: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(warehouseId) || (productId && !Types.ObjectId.isValid(productId))) {
      throw new BadRequestException('Invalid workspace, warehouse or product ID');
    }
    const filter: any = { tenantId: new Types.ObjectId(tenantId), warehouseId: new Types.ObjectId(warehouseId), status: 'IN_STOCK' };
    if (productId) filter.productId = new Types.ObjectId(productId);
    if (!this.connection.db) throw new ConflictException('Serial registry is unavailable');
    return this.connection.db.collection('inventory_serials').find(filter, {
      projection: { serialNumber: 1, productId: 1, warehouseId: 1 },
    }).sort({ serialNumber: 1 }).limit(500).toArray();
  }

  async findAll(tenantId: string, dto: ListSalesDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const filter: any = {};

    if (dto.status) {
      filter.status = dto.status;
    }

    if (dto.search) {
      const escaped = dto.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(escaped, 'i');

      filter.$or = [
        { invoiceNumber: expression },
        { customerName: expression },
        { customerPhone: expression },
      ];
    }

    const scopedFilter = tenantFilter(tenantId, filter);

    const [items, total] = await Promise.all([
      this.invoices
        .find(scopedFilter)
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      this.invoices.countDocuments(scopedFilter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid invoice ID.');
    }

    const invoice = await this.invoices
      .findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(id) }))
      .lean();

    if (!invoice) {
      throw new NotFoundException('Invoice not found.');
    }

    return invoice;
  }

  async cancelSale(
    tenantId: string,
    userId: string,
    id: string,
    reason: string,
  ) {
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(tenantId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new BadRequestException('Invalid invoice, tenant, or user ID.');
    }

    const saleDate = new Date();
    const fy = this.financialYear(saleDate);

    await this.ensureInvoiceCounter(tenantId, fy);

    const session = await this.connection.startSession();

    try {
      let result: any;

      await session.withTransaction(async () => {
        const invoice = await this.invoices
          .findOne(
            tenantFilter(tenantId, {
              _id: new Types.ObjectId(id),
              status: 'ISSUED',
            }),
          )
          .session(session);

        if (!invoice) {
          throw new NotFoundException(
            'Issued invoice not found. It may already be cancelled.',
          );
        }

        await this.taxPeriods.assertOpen(tenantId, invoice.invoiceDate, session);

        if (
  invoice.paidAmount > 0 ||
  Number(invoice.creditedAmount || 0) > 0
) {
  throw new ConflictException(
    'This invoice has payments or issued credit notes and cannot be cancelled.',
  );
}

        const restoreQuantities = new Map<string, number>();
        const restoreValuesPaise = new Map<string, number>();

        for (const item of invoice.items) {
          if (!item.stockTracked) continue;
          const productId = item.productId.toString();
          restoreQuantities.set(productId, (restoreQuantities.get(productId) || 0) + item.quantity);
          if (invoice.costingVersion === 1) {
            restoreValuesPaise.set(
              productId,
              (restoreValuesPaise.get(productId) || 0) + this.toPaise(item.costOfGoodsSold || 0),
            );
          }
        }

        for (const [productId, quantity] of restoreQuantities) {
          const product = await this.products
            .findOne(
              tenantFilter(tenantId, {
                _id: new Types.ObjectId(productId),
              }),
            )
            .session(session);

          if (!product) {
            throw new ConflictException(
              `Cannot restore stock because product ${productId} no longer exists.`,
            );
          }

          const previousQty = product.stockQty || 0;
          if (previousQty > 0 && !product.valuationInitialized) {
            throw new ConflictException('Opening inventory valuation is required before restoring stock for this invoice.');
          }
          const newQty = previousQty + quantity;
          let movementPreviousQty = previousQty;
          let movementNewQty = newQty;
          const restoredValuePaise = invoice.costingVersion === 1
            ? (restoreValuesPaise.get(productId) || 0)
            : this.toPaise(product.averageCost || 0) * quantity;
          const productPreviousValuePaise = this.toPaise(product.inventoryValue || 0);
          const productNewValuePaise = productPreviousValuePaise + restoredValuePaise;
          let warehousePreviousValuePaiseForMovement: number | undefined;
          let warehouseNewValuePaiseForMovement: number | undefined;

          if (invoice.warehouseId) {
            const warehouseStock = await this.warehouseStocks.findOne(tenantFilter(tenantId, {
              warehouseId: invoice.warehouseId, productId: product._id,
            })).session(session);
            const warehousePreviousQty = warehouseStock?.quantity || 0;
            const warehousePreviousValuePaise = this.toPaise(warehouseStock?.inventoryValue || 0);
            warehousePreviousValuePaiseForMovement = warehousePreviousValuePaise;
            const warehouseNextQty = warehousePreviousQty + quantity;
            movementPreviousQty = warehousePreviousQty;
            movementNewQty = warehouseNextQty;
            const warehouseNextValuePaise = warehousePreviousValuePaise + restoredValuePaise;
            warehouseNewValuePaiseForMovement = warehouseNextValuePaise;
            if (warehouseStock) {
              const restoredWarehouse = await this.warehouseStocks.findOneAndUpdate(
                tenantFilter(tenantId, { _id: warehouseStock._id, quantity: warehousePreviousQty }),
                { $set: {
                  quantity: warehouseNextQty,
                  inventoryValue: this.fromPaise(warehouseNextValuePaise),
                  averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
                } },
                { new: true, session, runValidators: true },
              );
              if (!restoredWarehouse) throw new ConflictException('Warehouse stock changed while cancelling this invoice');
            } else {
              await this.warehouseStocks.create([{
                tenantId: new Types.ObjectId(tenantId), warehouseId: invoice.warehouseId,
                productId: product._id, quantity: warehouseNextQty,
                inventoryValue: this.fromPaise(warehouseNextValuePaise),
                averageCost: this.fromPaise(Math.round(warehouseNextValuePaise / warehouseNextQty)),
              }], { session });
            }
          }

          const updated = await this.products.findOneAndUpdate(
            tenantFilter(tenantId, {
              _id: product._id,
              stockQty: previousQty,
            }),
            {
              $set: {
                stockQty: previousQty + quantity,
                inventoryValue: this.fromPaise(productNewValuePaise),
                averageCost: newQty > 0
                  ? this.fromPaise(Math.round(productNewValuePaise / newQty))
                  : product.averageCost,
                valuationInitialized: product.valuationInitialized || restoredValuePaise > 0,
              },
            },
            {
              new: true,
              session,
              runValidators: true,
            },
          );

          if (!updated) {
            throw new ConflictException(
              `Stock changed while cancelling invoice ${invoice.invoiceNumber}. Please retry.`,
            );
          }

          await this.movements.create(
            [
              {
                tenantId: new Types.ObjectId(tenantId),
                productId: product._id,
                ...(invoice.warehouseId ? { warehouseId: invoice.warehouseId } : {}),
                type: 'SALE_RETURN',
                quantityDelta: quantity,
                previousQty: movementPreviousQty,
                newQty: movementNewQty,
                reason: `Cancellation ${invoice.invoiceNumber}: ${reason}`.slice(
                  0,
                  250,
                ),
                performedBy: new Types.ObjectId(userId),
                valuation: {
                  unitCostPaise: quantity ? Math.round(restoredValuePaise / quantity) : 0,
                  productPreviousValuePaise,
                  productValueDeltaPaise: restoredValuePaise,
                  productNewValuePaise,
                  ...(invoice.warehouseId ? {
                    warehousePreviousValuePaise: warehousePreviousValuePaiseForMovement ?? 0,
                    warehouseValueDeltaPaise: restoredValuePaise,
                    warehouseNewValuePaise: warehouseNewValuePaiseForMovement ?? restoredValuePaise,
                  } : {}),
                },
              },
            ],
            { session },
          );
        }

        const cancelled = await this.invoices.findOneAndUpdate(
          tenantFilter(tenantId, {
            _id: invoice._id,
            status: 'ISSUED',
          }),
          {
            $set: {
              status: 'CANCELLED',
              cancelledBy: new Types.ObjectId(userId),
              cancelledAt: new Date(),
              cancellationReason: reason,
            },
          },
          {
            new: true,
            session,
          },
        );

        if (!cancelled) {
          throw new ConflictException(
            'Invoice status changed while cancelling. Please retry.',
          );
        }

        if (invoice.loyaltyVoucherCode) {
          const voucher = await this.loyaltyVouchers.findOne(tenantFilter(tenantId, {
            code: invoice.loyaltyVoucherCode,
            redeemedInvoiceId: invoice._id,
            status: 'REDEEMED',
          })).session(session);
          if (voucher) {
            voucher.status = voucher.expiresAt > new Date() ? 'AVAILABLE' : 'EXPIRED';
            voucher.redeemedInvoiceId = null;
            voucher.redeemedAt = null;
            await voucher.save({ session });
          }
        }

        await this.accounting.reverseOperationalJournal({
          tenantId, userId, sourceType: 'SALES', sourceId: invoice._id.toString(),
          reason: reason || 'Sales invoice cancelled', session,
        });
        await this.accounting.reverseOperationalJournal({
          tenantId, userId, sourceType: 'INVENTORY',
          sourceId: `SALE_COGS:${invoice._id.toString()}`,
          reason: reason || 'Sales invoice cancelled', session,
        });
        result = cancelled;
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
}














