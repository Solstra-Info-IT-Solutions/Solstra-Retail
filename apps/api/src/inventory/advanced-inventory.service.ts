import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { tenantFilter } from '../common/tenant-scoped.service';
import { Product } from '../products/schemas/product.schema';
import { Warehouse } from '../branches/schemas/warehouse.schema';
import { WarehouseStock } from './schemas/warehouse-stock.schema';
import { InventoryMovement } from './schemas/inventory-movement.schema';
import { InventoryBatch } from './schemas/inventory-batch.schema';
import { InventorySerial } from './schemas/inventory-serial.schema';
import { Stocktake } from './schemas/stocktake.schema';
import { ReceiveBatchDto, RegisterSerialsDto, CreateStocktakeDto } from './dto/advanced-inventory.dto';

@Injectable()
export class AdvancedInventoryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Warehouse.name) private readonly warehouses: Model<Warehouse>,
    @InjectModel(WarehouseStock.name) private readonly warehouseStocks: Model<WarehouseStock>,
    @InjectModel(InventoryMovement.name) private readonly movements: Model<InventoryMovement>,
    @InjectModel(InventoryBatch.name) private readonly batches: Model<InventoryBatch>,
    @InjectModel(InventorySerial.name) private readonly serials: Model<InventorySerial>,
    @InjectModel(Stocktake.name) private readonly stocktakes: Model<Stocktake>,
  ) {}

  async receiveBatch(tenantId: string, userId: string, dto: ReceiveBatchDto) {
    if (![tenantId, userId, dto.productId, dto.warehouseId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user, product or warehouse ID');
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt <= new Date()) throw new BadRequestException('Batch expiry must be in the future');
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false, trackStock: true })).session(session);
        if (!product) throw new NotFoundException('Stock-tracked product not found');
        const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.warehouseId), isDeleted: false, isActive: true })).session(session);
        if (!warehouse) throw new NotFoundException('Active warehouse not found');
        const existing = await this.batches.findOne(tenantFilter(tenantId, { productId: product._id, warehouseId: warehouse._id, batchNumber: dto.batchNumber.trim().toUpperCase() })).session(session);
        if (existing) throw new ConflictException('This batch number already exists for the product and warehouse');
        const stock = await this.warehouseStocks.findOne(tenantFilter(tenantId, { productId: product._id, warehouseId: warehouse._id })).session(session);
        const oldQty = stock?.quantity || 0;
        const oldValue = Math.round((stock?.inventoryValue || 0) * 100);
        const incomingQty = dto.quantity;
        const incomingValue = Math.round(incomingQty * dto.unitCost * 100);
        const newQty = oldQty + incomingQty;
        const newValue = oldValue + incomingValue;
        if (stock) {
          stock.quantity = newQty; stock.inventoryValue = newValue / 100; stock.averageCost = newQty ? newValue / 100 / newQty : 0;
          await stock.save({ session });
        } else {
          await this.warehouseStocks.create([{ tenantId: new Types.ObjectId(tenantId), warehouseId: warehouse._id, productId: product._id, quantity: newQty, inventoryValue: newValue / 100, averageCost: newQty ? newValue / 100 / newQty : 0 }], { session });
        }
        const oldGlobalQty = product.stockQty || 0;
        const oldGlobalValue = Math.round((product.inventoryValue || 0) * 100);
        const globalQty = oldGlobalQty + incomingQty;
        const globalValue = oldGlobalValue + incomingValue;
        product.stockQty = globalQty; product.inventoryValue = globalValue / 100; product.averageCost = globalQty ? globalValue / 100 / globalQty : 0; product.valuationInitialized = true;
        await product.save({ session });
        const [batch] = await this.batches.create([{ tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouse._id, batchNumber: dto.batchNumber.trim().toUpperCase(), manufacturedAt: dto.manufacturedAt ? new Date(dto.manufacturedAt) : null, expiresAt, quantity: incomingQty, unitCost: dto.unitCost, createdBy: new Types.ObjectId(userId) }], { session });
        await this.movements.create([{ tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouse._id, type: 'IN', quantityDelta: incomingQty, previousQty: oldQty, newQty, reason: 'Batch receipt ' + batch.batchNumber, performedBy: new Types.ObjectId(userId) }], { session });
        result = batch;
      });
      return result;
    } finally { await session.endSession(); }
  }

  async listBatches(tenantId: string, productId?: string, warehouseId?: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const filter: any = tenantFilter(tenantId, { status: 'ACTIVE', expiresAt: { $gt: new Date() } });
    if (productId) { if (!Types.ObjectId.isValid(productId)) throw new BadRequestException('Invalid product ID'); filter.productId = new Types.ObjectId(productId); }
    if (warehouseId) { if (!Types.ObjectId.isValid(warehouseId)) throw new BadRequestException('Invalid warehouse ID'); filter.warehouseId = new Types.ObjectId(warehouseId); }
    return this.batches.find(filter).sort({ expiresAt: 1, createdAt: 1 }).populate('productId', 'name sku').populate('warehouseId', 'name code').lean();
  }

  async registerSerials(tenantId: string, userId: string, dto: RegisterSerialsDto) {
    if (![tenantId, userId, dto.productId, dto.warehouseId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user, product or warehouse ID');
    const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.productId), isDeleted: false, trackStock: true })).lean();
    if (!product) throw new NotFoundException('Stock-tracked product not found');
    const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.warehouseId), isDeleted: false, isActive: true })).lean();
    if (!warehouse) throw new NotFoundException('Active warehouse not found');
    const names = dto.serials.map(x => x.serialNumber.trim().toUpperCase());
    if (new Set(names).size !== names.length) throw new BadRequestException('Duplicate serial numbers in this request');
    const stock = await this.warehouseStocks.findOne(tenantFilter(tenantId, { productId: product._id, warehouseId: warehouse._id })).lean();
    if (!stock || stock.quantity < names.length) throw new ConflictException('Registered serial count cannot exceed available warehouse stock');
    try {
      return await this.serials.insertMany(names.map(serialNumber => ({ tenantId: new Types.ObjectId(tenantId), productId: product._id, warehouseId: warehouse._id, serialNumber, createdBy: new Types.ObjectId(userId) })), { ordered: true });
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('One or more serial numbers already exist in this business');
      throw error;
    }
  }

  async listSerials(tenantId: string, productId?: string, status?: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const filter: any = tenantFilter(tenantId, {});
    if (productId) { if (!Types.ObjectId.isValid(productId)) throw new BadRequestException('Invalid product ID'); filter.productId = new Types.ObjectId(productId); }
    if (status) { if (!['IN_STOCK','SOLD','RETURNED','DAMAGED'].includes(status)) throw new BadRequestException('Invalid serial status'); filter.status = status; }
    return this.serials.find(filter).sort({ createdAt: -1 }).limit(500).populate('productId', 'name sku').populate('warehouseId', 'name code').lean();
  }

  async createStocktake(tenantId: string, userId: string, dto: CreateStocktakeDto) {
    if (![tenantId, userId, dto.warehouseId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user or warehouse ID');
    const warehouse = await this.warehouses.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(dto.warehouseId), isDeleted: false, isActive: true })).lean();
    if (!warehouse) throw new NotFoundException('Active warehouse not found');
    const ids = dto.lines.map(x => x.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A product can appear only once in a stocktake');
    const lines: any[] = [];
    for (const line of dto.lines) {
      if (!Types.ObjectId.isValid(line.productId)) throw new BadRequestException('Invalid product ID in stocktake');
      const product = await this.products.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(line.productId), isDeleted: false })).lean();
      if (!product) throw new NotFoundException('Stocktake product not found');
      const stock = await this.warehouseStocks.findOne(tenantFilter(tenantId, { warehouseId: warehouse._id, productId: product._id })).lean();
      const expectedQty = stock?.quantity || 0;
      lines.push({ productId: product._id, expectedQty, countedQty: line.countedQty, variance: line.countedQty - expectedQty, note: line.note?.trim() || '' });
    }
    return this.stocktakes.create({ tenantId: new Types.ObjectId(tenantId), warehouseId: warehouse._id, reference: dto.reference.trim(), lines, createdBy: new Types.ObjectId(userId) });
  }

  async listStocktakes(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.stocktakes.find(tenantFilter(tenantId, {})).sort({ createdAt: -1 }).limit(100).populate('warehouseId', 'name code').populate('lines.productId', 'name sku').lean();
  }

  async completeStocktake(tenantId: string, userId: string, stocktakeId: string) {
    if (![tenantId, userId, stocktakeId].every(Types.ObjectId.isValid)) throw new BadRequestException('Invalid tenant, user or stocktake ID');
    const session = await this.connection.startSession();
    try {
      let completed: any;
      await session.withTransaction(async () => {
        const take = await this.stocktakes.findOne(tenantFilter(tenantId, { _id: new Types.ObjectId(stocktakeId), status: 'DRAFT' })).session(session);
        if (!take) throw new NotFoundException('Draft stocktake not found');
        for (const line of take.lines) {
          const product = await this.products.findOne(tenantFilter(tenantId, { _id: line.productId, isDeleted: false })).session(session);
          if (!product) throw new ConflictException('A stocktake product no longer exists');
          const stock = await this.warehouseStocks.findOne(tenantFilter(tenantId, { warehouseId: take.warehouseId, productId: line.productId })).session(session);
          const currentQty = stock?.quantity || 0;
          const delta = line.countedQty - currentQty;
          if (delta !== 0) {
            const unitCost = stock?.averageCost ?? product.averageCost ?? 0;
            if (stock) { stock.quantity = line.countedQty; stock.inventoryValue = Math.round(line.countedQty * unitCost * 100) / 100; await stock.save({ session }); }
            else await this.warehouseStocks.create([{ tenantId: take.tenantId, warehouseId: take.warehouseId, productId: line.productId, quantity: line.countedQty, averageCost: unitCost, inventoryValue: Math.round(line.countedQty * unitCost * 100) / 100 }], { session });
            product.stockQty = Math.max(0, (product.stockQty || 0) + delta);
            product.inventoryValue = Math.max(0, Math.round(((product.inventoryValue || 0) + delta * unitCost) * 100) / 100);
            if (product.stockQty === 0) product.inventoryValue = 0;
            else product.averageCost = product.inventoryValue / product.stockQty;
            await product.save({ session });
            await this.movements.create([{ tenantId: take.tenantId, productId: line.productId, warehouseId: take.warehouseId, type: 'ADJUSTMENT', quantityDelta: delta, previousQty: currentQty, newQty: line.countedQty, reason: 'Stocktake ' + take.reference, performedBy: new Types.ObjectId(userId) }], { session });
          }
        }
        take.status = 'COMPLETED'; take.completedBy = new Types.ObjectId(userId); take.completedAt = new Date();
        await take.save({ session }); completed = take;
      });
      return completed;
    } finally { await session.endSession(); }
  }
}
