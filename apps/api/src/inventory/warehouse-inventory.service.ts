import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Product } from '../products/schemas/product.schema';
import { Warehouse } from '../branches/schemas/warehouse.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { WarehouseStock, WarehouseStockDocument } from './schemas/warehouse-stock.schema';
import { WarehouseTransfer, WarehouseTransferDocument } from './schemas/warehouse-transfer.schema';
import { InventoryMovement, InventoryMovementDocument } from './schemas/inventory-movement.schema';
import { WarehouseOpeningStockDto } from './dto/warehouse-opening-stock.dto';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';

@Injectable()
export class WarehouseInventoryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<any>,
    @InjectModel(Branch.name) private readonly branches: Model<any>,
    @InjectModel(WarehouseStock.name) private readonly stocks: Model<WarehouseStockDocument>,
    @InjectModel(WarehouseTransfer.name) private readonly transfers: Model<WarehouseTransferDocument>,
    @InjectModel(InventoryMovement.name) private readonly movements: Model<InventoryMovementDocument>,
  ) {}

  async initializeOpeningStock(tenantId: string, userId: string, warehouseId: string, dto: WarehouseOpeningStockDto) {
    this.validateIdentity(tenantId, userId);
    if (!Types.ObjectId.isValid(warehouseId) || !Types.ObjectId.isValid(dto.productId)) throw new BadRequestException('Invalid warehouse or product ID');
    const session = await this.connection.startSession();
    let result: any;
    try {
      await session.withTransaction(async () => {
        const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(warehouseId), isDeleted: false, isActive: true })).session(session);
        if (!warehouse) throw new NotFoundException('Active warehouse not found');
        const branch = await this.branches.findOne(tenantFilter(tenantId, { _id: warehouse.branchId, isDeleted: false, isActive: true })).session(session);
        if (!branch) throw new ConflictException('Warehouse branch is not active');
        const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false, trackStock: true })).session(session);
        if (!product) throw new NotFoundException('Stock-tracked product not found');
        const existing = await this.stocks.findOne(tenantFilter(tenantId, { warehouseId: warehouse._id, productId: product._id })).session(session);
        if (existing) throw new ConflictException('Opening stock is already initialized for this product in this warehouse');
        if (dto.quantity > 0 && !product.valuationInitialized) throw new ConflictException('Initialize product inventory valuation before assigning warehouse stock');
        const allocations = await this.stocks.find(tenantFilter(tenantId, { productId: product._id })).session(session).lean();
        const allocatedQuantity = allocations.reduce((sum: number, item: any) => sum + item.quantity, 0);
        const allocatedValuePaise = allocations.reduce((sum: number, item: any) => sum + Math.round(((item.inventoryValue || 0) + Number.EPSILON) * 100), 0);
        if (allocatedQuantity + dto.quantity > product.stockQty) throw new ConflictException('Warehouse allocations cannot exceed the product total stock quantity');
        const productValuePaise = Math.round(((product.inventoryValue || 0) + Number.EPSILON) * 100);
        if (allocatedValuePaise > productValuePaise) throw new ConflictException('Existing warehouse valuation exceeds the product inventory value');
        const remainingQuantity = product.stockQty - allocatedQuantity;
        const remainingValuePaise = productValuePaise - allocatedValuePaise;
        const valuePaise = dto.quantity === remainingQuantity
          ? remainingValuePaise
          : Math.min(remainingValuePaise, Math.round(dto.quantity * ((product.averageCost || 0) + Number.EPSILON) * 100));
        const [created] = await this.stocks.create([{
          tenantId: new Types.ObjectId(tenantId), warehouseId: warehouse._id, productId: product._id,
          quantity: dto.quantity, inventoryValue: valuePaise / 100,
          averageCost: dto.quantity ? Math.round(valuePaise / dto.quantity) / 100 : 0,
        }], { session });
        await this.movements.create([{
          tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouse._id,
          type: 'OPENING', quantityDelta: dto.quantity, previousQty: 0, newQty: dto.quantity,
          reason: dto.reason.trim(), performedBy: new Types.ObjectId(userId),
        }], { session });
        result = created;
      });
    } finally { await session.endSession(); }
    return result;
  }

  async createTransfer(tenantId: string, userId: string, dto: CreateWarehouseTransferDto) {
    this.validateIdentity(tenantId, userId);
    if (![dto.productId, dto.sourceWarehouseId, dto.destinationWarehouseId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid product or warehouse ID');
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) throw new BadRequestException('Source and destination warehouses must be different');
    const session = await this.connection.startSession();
    let result: any;
    try {
      await session.withTransaction(async () => {
        const warehouseIds = [new Types.ObjectId(dto.sourceWarehouseId), new Types.ObjectId(dto.destinationWarehouseId)];
        const warehouses = await this.warehouses.find(tenantFilter(tenantId, { _id: { $in: warehouseIds }, isDeleted: false, isActive: true })).session(session).lean();
        if (warehouses.length !== 2) throw new NotFoundException('Both active warehouses must belong to this tenant');
        const activeBranches = await this.branches.countDocuments(tenantFilter(tenantId, { _id: { $in: warehouses.map((w: any) => w.branchId) }, isDeleted: false, isActive: true })).session(session);
        if (activeBranches !== new Set(warehouses.map((w: any) => String(w.branchId))).size) throw new ConflictException('Both warehouse branches must be active');
        const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false, trackStock: true })).session(session);
        if (!product) throw new NotFoundException('Stock-tracked product not found');
        const source = await this.stocks.findOne(tenantFilter(tenantId, { warehouseId: warehouseIds[0], productId: product._id })).session(session);
        if (!source) throw new ConflictException('Source warehouse stock is not initialized for this product');
        if (source.quantity < dto.quantity) throw new BadRequestException('Insufficient stock in the source warehouse');
        const sourceValuePaise = Math.round(((source.inventoryValue || 0) + Number.EPSILON) * 100);
        const valuePaise = dto.quantity === source.quantity
          ? sourceValuePaise
          : Math.round(sourceValuePaise * dto.quantity / source.quantity);
        const destination = await this.stocks.findOne(tenantFilter(tenantId, { warehouseId: warehouseIds[1], productId: product._id })).session(session);
        const sourceNewQty = source.quantity - dto.quantity;
        const sourceNewValuePaise = sourceValuePaise - valuePaise;
        if (sourceNewValuePaise < 0) throw new ConflictException('Source warehouse valuation is inconsistent; reconcile stock before transferring');
        const sourceUpdated = await this.stocks.findOneAndUpdate(
          tenantFilter(tenantId, { _id: source._id, quantity: source.quantity }),
          { $set: { quantity: sourceNewQty, inventoryValue: sourceNewValuePaise / 100 } },
          { new: true, session, runValidators: true },
        );
        if (!sourceUpdated) throw new ConflictException('Source stock changed during transfer; retry');
        if (destination) {
          const destinationQty = destination.quantity + dto.quantity;
          const destinationValuePaise = Math.round(((destination.inventoryValue || 0) + Number.EPSILON) * 100) + valuePaise;
          const updated = await this.stocks.findOneAndUpdate(
            tenantFilter(tenantId, { _id: destination._id, quantity: destination.quantity }),
            { $set: { quantity: destinationQty, inventoryValue: destinationValuePaise / 100, averageCost: destinationQty ? Math.round(destinationValuePaise / destinationQty) / 100 : 0 } },
            { new: true, session, runValidators: true },
          );
          if (!updated) throw new ConflictException('Destination stock changed during transfer; retry');
        } else {
          await this.stocks.create([{
            tenantId: new Types.ObjectId(tenantId), warehouseId: warehouseIds[1], productId: product._id,
            quantity: dto.quantity, inventoryValue: valuePaise / 100, averageCost: source.averageCost || 0,
          }], { session });
        }
        const [transfer] = await this.transfers.create([{
          tenantId: new Types.ObjectId(tenantId), productId: product._id,
          sourceWarehouseId: warehouseIds[0], destinationWarehouseId: warehouseIds[1],
          quantity: dto.quantity, unitCost: source.averageCost || 0, inventoryValue: valuePaise / 100,
          reason: dto.reason.trim(), performedBy: new Types.ObjectId(userId),
        }], { session });
        await this.movements.create([
          {
            tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouseIds[0],
            transferId: transfer._id, type: 'TRANSFER_OUT', quantityDelta: -dto.quantity,
            previousQty: source.quantity, newQty: sourceNewQty,
            reason: dto.reason.trim(), performedBy: new Types.ObjectId(userId),
          },
          {
            tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouseIds[1],
            transferId: transfer._id, type: 'TRANSFER_IN', quantityDelta: dto.quantity,
            previousQty: destination?.quantity || 0, newQty: (destination?.quantity || 0) + dto.quantity,
            reason: dto.reason.trim(), performedBy: new Types.ObjectId(userId),
          },
        ], { session });
        result = transfer;
      });
    } finally { await session.endSession(); }
    return result;
  }

  async reconciliation(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant context');
    const [products, allocations] = await Promise.all([
      this.products.find(tenantFilter(tenantId, { isDeleted: false, trackStock: true }))
        .select('_id name sku stockQty inventoryValue valuationInitialized').sort({ name: 1 }).lean(),
      this.stocks.find(tenantFilter(tenantId, {})).select('productId quantity inventoryValue').lean(),
    ]);
    const byProduct = new Map<string, { quantity: number; valuePaise: number }>();
    for (const allocation of allocations as any[]) {
      const key = String(allocation.productId);
      const current = byProduct.get(key) || { quantity: 0, valuePaise: 0 };
      current.quantity += Number(allocation.quantity) || 0;
      current.valuePaise += Math.round(((Number(allocation.inventoryValue) || 0) + Number.EPSILON) * 100);
      byProduct.set(key, current);
    }
    const items = products.map((product: any) => {
      const allocated = byProduct.get(String(product._id)) || { quantity: 0, valuePaise: 0 };
      const stockQty = Number(product.stockQty) || 0;
      const inventoryValuePaise = Math.round(((Number(product.inventoryValue) || 0) + Number.EPSILON) * 100);
      const issues: string[] = [];
      if (allocated.quantity > stockQty) issues.push('OVER_ALLOCATED_QUANTITY');
      if (allocated.valuePaise > inventoryValuePaise) issues.push('OVER_ALLOCATED_VALUE');
      return {
        productId: product._id,
        name: product.name,
        sku: product.sku || '',
        valuationInitialized: product.valuationInitialized === true,
        totalStock: stockQty,
        allocatedStock: allocated.quantity,
        unallocatedStock: Math.max(0, stockQty - allocated.quantity),
        totalInventoryValue: inventoryValuePaise / 100,
        allocatedInventoryValue: allocated.valuePaise / 100,
        unallocatedInventoryValue: Math.max(0, inventoryValuePaise - allocated.valuePaise) / 100,
        status: issues.length ? 'DISCREPANCY' : allocated.quantity === stockQty && allocated.valuePaise === inventoryValuePaise ? 'RECONCILED' : 'UNALLOCATED',
        issues,
      };
    });
    const discrepancies = items.filter((item) => item.status === 'DISCREPANCY');
    return {
      summary: {
        products: items.length,
        fullyAllocated: items.filter((item) => item.status === 'RECONCILED').length,
        partiallyOrNotAllocated: items.filter((item) => item.status === 'UNALLOCATED').length,
        discrepancies: discrepancies.length,
        totalStock: items.reduce((sum, item) => sum + item.totalStock, 0),
        allocatedStock: items.reduce((sum, item) => sum + item.allocatedStock, 0),
        unallocatedStock: items.reduce((sum, item) => sum + item.unallocatedStock, 0),
      },
      items,
      discrepancies,
      note: 'Unallocated stock is not an error; it remains in the business-wide stock pool until assigned to a warehouse. Over-allocation is a blocking reconciliation issue.',
    };
  }

  async listWarehouseStock(tenantId: string, warehouseId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(warehouseId)) throw new BadRequestException('Invalid tenant or warehouse ID');
    const warehouseObjectId = new Types.ObjectId(warehouseId);
    const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: warehouseObjectId, isDeleted: false })).lean();
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    const items = await this.stocks.find(tenantFilter(tenantId, { warehouseId: warehouseObjectId })).populate('productId', 'name sku barcode unit').sort({ updatedAt: -1 }).lean();
    return { items, total: items.length };
  }

  async listTransfers(tenantId: string, page = 1, limit = 20) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant context');
    const filter = tenantFilter(tenantId, {});
    const [items, total] = await Promise.all([
      this.transfers.find(filter).populate('productId', 'name sku').populate('sourceWarehouseId', 'name code').populate('destinationWarehouseId', 'name code').populate('performedBy', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.transfers.countDocuments(filter),
    ]);
    return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  private validateIdentity(tenantId: string, userId: string) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid tenant or authenticated user');
  }
}
