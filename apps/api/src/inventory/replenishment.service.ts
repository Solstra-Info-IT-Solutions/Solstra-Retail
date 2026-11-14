import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Warehouse, WarehouseDocument } from '../branches/schemas/warehouse.schema';
import { WarehouseStock, WarehouseStockDocument } from './schemas/warehouse-stock.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { ReplenishmentPolicy, ReplenishmentPolicyDocument } from './schemas/replenishment-policy.schema';
import { UpsertReplenishmentPolicyDto, ReplenishmentQueryDto } from './dto/replenishment.dto';

@Injectable()
export class ReplenishmentService {
  constructor(
    @InjectModel(ReplenishmentPolicy.name) private readonly policies: Model<ReplenishmentPolicyDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<WarehouseDocument>,
    @InjectModel(WarehouseStock.name) private readonly stocks: Model<WarehouseStockDocument>,
    @InjectModel(SalesInvoice.name) private readonly sales: Model<SalesInvoiceDocument>,
  ) {}

  async upsertPolicy(tenantId: string, userId: string, dto: UpsertReplenishmentPolicyDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or authenticated user');
    }
    if (!Types.ObjectId.isValid(dto.productId) || !Types.ObjectId.isValid(dto.warehouseId)) {
      throw new BadRequestException('Invalid product or warehouse ID');
    }
    if (dto.targetStock < dto.reorderPoint || dto.targetStock < dto.safetyStock) {
      throw new BadRequestException('Target stock must be at least the reorder point and safety stock');
    }
    const tenant = new Types.ObjectId(tenantId);
    const [product, warehouse] = await Promise.all([
      this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false, trackStock: true })).lean(),
      this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.warehouseId), isActive: true })).lean(),
    ]);
    if (!product) throw new NotFoundException('Stock-tracked product not found');
    if (!warehouse) throw new NotFoundException('Active warehouse not found');
    if (dto.preferredSupplierId) {
      if (!Types.ObjectId.isValid(dto.preferredSupplierId)) throw new BadRequestException('Invalid preferred supplier ID');
      const supplier = await this.products.db.collection('suppliers').findOne({
        _id: new Types.ObjectId(dto.preferredSupplierId),
        tenantId: tenant,
        isActive: { $ne: false },
      });
      if (!supplier) throw new NotFoundException('Preferred supplier not found');
    }
    const update = {
      reorderPoint: dto.reorderPoint,
      targetStock: dto.targetStock,
      safetyStock: dto.safetyStock,
      leadTimeDays: dto.leadTimeDays,
      minimumOrderQty: dto.minimumOrderQty,
      packSize: dto.packSize,
      preferredSupplierId: dto.preferredSupplierId ? new Types.ObjectId(dto.preferredSupplierId) : null,
      isActive: dto.isActive ?? true,
      updatedBy: new Types.ObjectId(userId),
    };
    return this.policies.findOneAndUpdate(
      { tenantId: tenant, productId: new Types.ObjectId(dto.productId), warehouseId: new Types.ObjectId(dto.warehouseId) },
      { $set: update, $setOnInsert: { tenantId: tenant, productId: new Types.ObjectId(dto.productId), warehouseId: new Types.ObjectId(dto.warehouseId) } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).populate('productId', 'name sku unit').populate('warehouseId', 'name code').populate('preferredSupplierId', 'name');
  }

  async listPolicies(tenantId: string, warehouseId?: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const filter: Record<string, unknown> = {};
    if (warehouseId) {
      if (!Types.ObjectId.isValid(warehouseId)) throw new BadRequestException('Invalid warehouse ID');
      filter.warehouseId = new Types.ObjectId(warehouseId);
    }
    return this.policies.find(tenantFilter(tenantId, filter))
      .sort({ isActive: -1, updatedAt: -1 })
      .populate('productId', 'name sku unit stockQty')
      .populate('warehouseId', 'name code')
      .populate('preferredSupplierId', 'name')
      .lean();
  }

  async suggestions(tenantId: string, query: ReplenishmentQueryDto) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    if (query.warehouseId && !Types.ObjectId.isValid(query.warehouseId)) throw new BadRequestException('Invalid warehouse ID');
    const lookbackDays = query.lookbackDays ?? 90;
    const forecastDays = query.forecastDays ?? 30;
    const policyFilter: Record<string, unknown> = { isActive: true };
    if (query.warehouseId) policyFilter.warehouseId = new Types.ObjectId(query.warehouseId);
    const policies = await this.policies.find(tenantFilter(tenantId, policyFilter))
      .populate('productId', 'name sku unit trackStock')
      .populate('warehouseId', 'name code')
      .populate('preferredSupplierId', 'name')
      .lean();
    if (!policies.length) return { generatedAt: new Date(), lookbackDays, forecastDays, summary: { policies: 0, reorderRequired: 0, recommendedUnits: 0 }, items: [] };
    const warehouseIds = [...new Set(policies.map(p => String(p.warehouseId?._id || p.warehouseId)))].map(id => new Types.ObjectId(id));
    const productIds = [...new Set(policies.map(p => String(p.productId?._id || p.productId)))].map(id => new Types.ObjectId(id));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);
    const [stocks, sales] = await Promise.all([
      this.stocks.find({ tenantId: new Types.ObjectId(tenantId), warehouseId: { $in: warehouseIds }, productId: { $in: productIds } }).select('warehouseId productId quantity').lean(),
      this.sales.aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), status: 'ISSUED', invoiceDate: { $gte: startDate } } },
        { $unwind: '$items' },
        { $match: { 'items.stockTracked': true, 'items.productId': { $in: productIds } } },
        { $group: { _id: '$items.productId', unitsSold: { $sum: '$items.quantity' } } },
      ]),
    ]);
    const stockByKey = new Map(stocks.map(s => [String(s.warehouseId) + ':' + String(s.productId), Number(s.quantity) || 0]));
    const salesByProduct = new Map(sales.map(s => [String(s._id), Number(s.unitsSold) || 0]));
    const items = policies.map(policy => {
      const product = policy.productId as any;
      const warehouse = policy.warehouseId as any;
      const productId = String(product?._id || policy.productId);
      const warehouseId = String(warehouse?._id || policy.warehouseId);
      const onHand = stockByKey.get(warehouseId + ':' + productId) || 0;
      const unitsSold = salesByProduct.get(productId) || 0;
      const averageDailyDemand = unitsSold / lookbackDays;
      const leadTimeDemand = averageDailyDemand * policy.leadTimeDays;
      const forecastDemand = averageDailyDemand * forecastDays;
      const reorderTrigger = Math.max(policy.reorderPoint, leadTimeDemand + policy.safetyStock);
      const needsReorder = onHand <= reorderTrigger;
      const rawOrderQty = needsReorder ? Math.max(0, policy.targetStock + policy.safetyStock - onHand) : 0;
      const roundedOrderQty = rawOrderQty > 0
        ? Math.max(policy.minimumOrderQty, Math.ceil(rawOrderQty / policy.packSize) * policy.packSize)
        : 0;
      return {
        policyId: policy._id,
        product: product ? { id: productId, name: product.name, sku: product.sku, unit: product.unit } : null,
        warehouse: warehouse ? { id: warehouseId, name: warehouse.name, code: warehouse.code } : null,
        preferredSupplier: policy.preferredSupplierId || null,
        onHand,
        unitsSoldInLookback: unitsSold,
        averageDailyDemand: Number(averageDailyDemand.toFixed(3)),
        forecastDemand: Number(forecastDemand.toFixed(2)),
        leadTimeDays: policy.leadTimeDays,
        leadTimeDemand: Number(leadTimeDemand.toFixed(2)),
        reorderPoint: policy.reorderPoint,
        safetyStock: policy.safetyStock,
        targetStock: policy.targetStock,
        needsReorder,
        suggestedOrderQty: roundedOrderQty,
        status: needsReorder ? 'REORDER' : 'HEALTHY',
      };
    }).sort((a, b) => Number(b.needsReorder) - Number(a.needsReorder) || b.suggestedOrderQty - a.suggestedOrderQty);
    return {
      generatedAt: new Date(),
      lookbackDays,
      forecastDays,
      summary: {
        policies: items.length,
        reorderRequired: items.filter(item => item.needsReorder).length,
        recommendedUnits: items.reduce((sum, item) => sum + item.suggestedOrderQty, 0),
      },
      items,
      note: 'Forecasts use historical issued invoice quantities as a simple average daily demand. They are planning estimates, not guaranteed demand or automatically submitted purchase orders.',
    };
  }
}
