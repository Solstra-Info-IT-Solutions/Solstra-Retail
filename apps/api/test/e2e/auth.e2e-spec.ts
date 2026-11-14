import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import helmet from 'helmet';
import request = require('supertest');

import { AppModule } from '../../src/app.module';
import { User } from '../../src/auth/schemas/user.schema';
import { Tenant } from '../../src/tenants/schemas/tenant.schema';
import { Product } from '../../src/products/schemas/product.schema';
import { InventoryMovement } from '../../src/inventory/schemas/inventory-movement.schema';
import { SalesInvoice } from '../../src/sales/schemas/sales-invoice.schema';
import { InvoiceCounter } from '../../src/sales/schemas/invoice-counter.schema';
import { Customer } from '../../src/customers/schemas/customer.schema';

describe('Authentication HTTP E2E', () => {
  let app: INestApplication;
  let users: Model<User>;
  let tenants: Model<Tenant>;
  let products: Model<Product>;
  let movements: Model<InventoryMovement>;
  let invoices: Model<SalesInvoice>;
  let invoiceCounters: Model<InvoiceCounter>;
  let customers: Model<Customer>;

  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  const password = 'E2eTestPassword123!';

  async function registerAccount() {
    const unique = randomUUID();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'E2E Test Owner',
        email: `e2e-${unique}@example.test`,
        password,
        businessName: `E2E Business ${unique}`,
      });

    if (response.status === 201) {
      if (response.body.user?.id) {
        createdUserIds.push(response.body.user.id);
      }

      if (response.body.tenant?.id) {
        createdTenantIds.push(response.body.tenant.id);
      }
    }

    return response;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.use(helmet());

    app.enableCors({
      origin: (process.env.CORS_ORIGIN ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      credentials: true,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    tenants = app.get<Model<Tenant>>(getModelToken(Tenant.name));
    products = app.get<Model<Product>>(getModelToken(Product.name));
    movements = app.get<Model<InventoryMovement>>(
      getModelToken(InventoryMovement.name),
    );
    invoices = app.get<Model<SalesInvoice>>(
      getModelToken(SalesInvoice.name),
    );
    invoiceCounters = app.get<Model<InvoiceCounter>>(
      getModelToken(InvoiceCounter.name),
    );
    customers = app.get<Model<Customer>>(
      getModelToken(Customer.name),
    );

    await Promise.all([
      users.createIndexes(),
      tenants.createIndexes(),
      products.createIndexes(),
      movements.createIndexes(),
      invoices.createIndexes(),
      invoiceCounters.createIndexes(),
      customers.createIndexes(),
    ]);
  });

  afterAll(async () => {
    try {
      if (createdTenantIds.length) {
        const tenantIds = createdTenantIds;

        await Promise.all([
          products.deleteMany({ tenantId: { $in: tenantIds } }),
          movements.deleteMany({ tenantId: { $in: tenantIds } }),
          invoices.deleteMany({ tenantId: { $in: tenantIds } }),
          invoiceCounters.deleteMany({ tenantId: { $in: tenantIds } }),
          customers.deleteMany({ tenantId: { $in: tenantIds } }),
        ]);
      }

      if (createdUserIds.length) {
        await users.deleteMany({
          _id: { $in: createdUserIds },
        });
      }

      if (createdTenantIds.length) {
        await tenants.deleteMany({
          _id: { $in: createdTenantIds },
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('registers a new owner and returns a JWT and trial workspace', async () => {
    const response = await registerAccount();

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        user: expect.objectContaining({
          id: expect.any(String),
          role: 'owner',
        }),
        tenant: expect.objectContaining({
          id: expect.any(String),
          trialEndsAt: expect.any(String),
        }),
      }),
    );
  });

  it('rejects duplicate email registration', async () => {
    const first = await registerAccount();

    expect(first.status).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Duplicate Owner',
        email: first.body.user.email,
        password,
        businessName: 'Duplicate Business',
      });

    expect(duplicate.status).toBe(409);
  });

  it('logs in and returns the authenticated database-backed user from /auth/me', async () => {
    const registration = await registerAccount();

    expect(registration.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registration.body.user.email,
        password,
      });

    expect(login.status).toBe(201);
    expect(login.body.accessToken).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.user).toEqual(
      expect.objectContaining({
        userId: registration.body.user.id,
        tenantId: registration.body.tenant.id,
        role: 'owner',
      }),
    );
  });

  it('rejects invalid login credentials', async () => {
    const registration = await registerAccount();

    expect(registration.status).toBe(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registration.body.user.email,
        password: 'WrongPassword123!',
      });

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated and malformed JWT requests', async () => {
    const missingToken = await request(app.getHttpServer())
      .get('/api/v1/auth/me');

    expect(missingToken.status).toBe(401);

    const malformedToken = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.value');

    expect(malformedToken.status).toBe(401);
  });

  it('rejects invalid registration data and unknown properties', async () => {
    const invalidEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Invalid Owner',
        email: 'not-an-email',
        password: 'weak',
        businessName: 'Invalid Business',
      });

    expect(invalidEmail.status).toBe(400);

    const unknownProperty = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Invalid Owner',
        email: `extra-${randomUUID()}@example.test`,
        password,
        businessName: 'Invalid Business',
        unexpectedField: true,
      });

    expect(unknownProperty.status).toBe(400);
  });
  it('prevents one tenant from reading another tenant product', async () => {
    const first = await registerAccount();
    const second = await registerAccount();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .send({
        name: 'Tenant A Private Product',
        purchasePrice: 50,
        sellingPrice: 100,
        mrp: 100,
        stockQty: 0,
      });

    expect(product.status).toBe(201);

    const secondTenantDetail = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body._id}`)
      .set('Authorization', `Bearer ${second.body.accessToken}`);

    expect(secondTenantDetail.status).toBe(404);

    const secondTenantList = await request(app.getHttpServer())
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${second.body.accessToken}`);

    expect(secondTenantList.status).toBe(200);
    expect(secondTenantList.body.items).toHaveLength(0);
  });

  it('denies staff product creation, update, and deletion', async () => {
    const registration = await registerAccount();

    expect(registration.status).toBe(201);

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${registration.body.accessToken}`)
      .send({
        name: 'Staff Restricted Product',
        purchasePrice: 40,
        sellingPrice: 80,
        mrp: 80,
        stockQty: 0,
      });

    expect(product.status).toBe(201);

    await users.updateOne(
      { _id: registration.body.user.id },
      { $set: { role: 'staff' } },
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registration.body.user.email,
        password,
      });

    expect(login.status).toBe(201);
    expect(login.body.user.role).toBe('staff');

    const headers = {
      Authorization: `Bearer ${login.body.accessToken}`,
    };

    const create = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'Staff Cannot Create',
        purchasePrice: 10,
        sellingPrice: 20,
        mrp: 20,
      });

    expect(create.status).toBe(403);
    expect(create.body.code).toBe('INSUFFICIENT_ROLE');

    const update = await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.body._id}`)
      .set(headers)
      .send({ name: 'Staff Cannot Update' });

    expect(update.status).toBe(403);

    const remove = await request(app.getHttpServer())
      .delete(`/api/v1/products/${product.body._id}`)
      .set(headers);

    expect(remove.status).toBe(403);
  });

  it('allows an owner to create, update, and soft-delete a product', async () => {
    const registration = await registerAccount();

    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const created = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'Owner Lifecycle Product',
        purchasePrice: 25,
        sellingPrice: 50,
        mrp: 50,
        stockQty: 5,
      });

    expect(created.status).toBe(201);
    expect(created.body._id).toEqual(expect.any(String));

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/products/${created.body._id}`)
      .set(headers)
      .send({ sellingPrice: 60 });

    expect(updated.status).toBe(200);
    expect(updated.body.sellingPrice).toBe(60);

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/products/${created.body._id}`)
      .set(headers);

    expect(removed.status).toBe(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/products/${created.body._id}`)
      .set(headers);

    expect(detail.status).toBe(404);
  });

  it('rejects an issued JWT after its user is deactivated', async () => {
    const registration = await registerAccount();

    expect(registration.status).toBe(201);

    await users.updateOne(
      { _id: registration.body.user.id },
      { $set: { isActive: false } },
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registration.body.accessToken}`);

    expect(response.status).toBe(401);
  });
  it('creates an inventory movement and updates stock with an audit record', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'E2E Inventory Product',
        purchasePrice: 50,
        sellingPrice: 100,
        mrp: 100,
        stockQty: 5,
      });

    expect(product.status).toBe(201);

    const movement = await request(app.getHttpServer())
      .post(`/api/v1/inventory/products/${product.body._id}/movements`)
      .set(headers)
      .send({
        type: 'IN',
        quantity: 3,
        reason: 'E2E stock replenishment',
      });

    expect(movement.status).toBe(201);
    expect(movement.body).toEqual(
      expect.objectContaining({
        type: 'IN',
        quantityDelta: 3,
        previousQty: 5,
        newQty: 8,
      }),
    );

    const updatedProduct = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body._id}`)
      .set(headers);

    expect(updatedProduct.status).toBe(200);
    expect(updatedProduct.body.stockQty).toBe(8);

    const history = await request(app.getHttpServer())
      .get('/api/v1/inventory/movements')
      .set(headers)
      .query({ productId: product.body._id });

    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'IN',
          quantityDelta: 3,
          previousQty: 5,
          newQty: 8,
        }),
        expect.objectContaining({
          type: 'OPENING',
          quantityDelta: 5,
        }),
      ]),
    );
  });

  it('allows staff to read inventory history but denies stock movement creation', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const ownerHeaders = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(ownerHeaders)
      .send({
        name: 'E2E Staff Inventory Product',
        purchasePrice: 40,
        sellingPrice: 80,
        mrp: 80,
        stockQty: 5,
      });

    expect(product.status).toBe(201);

    await users.updateOne(
      { _id: registration.body.user.id },
      { $set: { role: 'staff' } },
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registration.body.user.email,
        password,
      });

    expect(login.status).toBe(201);

    const staffHeaders = {
      Authorization: `Bearer ${login.body.accessToken}`,
    };

    const createMovement = await request(app.getHttpServer())
      .post(`/api/v1/inventory/products/${product.body._id}/movements`)
      .set(staffHeaders)
      .send({
        type: 'IN',
        quantity: 2,
        reason: 'Staff restricted movement',
      });

    expect(createMovement.status).toBe(403);
    expect(createMovement.body.code).toBe('INSUFFICIENT_ROLE');

    const history = await request(app.getHttpServer())
      .get('/api/v1/inventory/movements')
      .set(staffHeaders);

    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].type).toBe('OPENING');
  });

  it('creates a sale through HTTP and prevents duplicate stock deduction on retry', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'E2E Sales Product',
        purchasePrice: 50,
        sellingPrice: 100,
        mrp: 100,
        gstRate: 0,
        stockQty: 5,
      });

    expect(product.status).toBe(201);

    await tenants.updateOne(
      { _id: registration.body.tenant.id },
      { $set: { stateCode: '09' } },
    );

    const salePayload = {
      idempotencyKey: randomUUID(),
      items: [
        {
          productId: product.body._id,
          quantity: 2,
        },
      ],
      placeOfSupplyStateCode: '09',
    };

    const firstSale = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set(headers)
      .send(salePayload);

    expect(firstSale.status).toBe(201);
    expect(firstSale.body._id).toEqual(expect.any(String));
    expect(firstSale.body.grandTotal).toBe(200);

    const retry = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set(headers)
      .send(salePayload);

    expect(retry.status).toBe(201);
    expect(retry.body._id).toBe(firstSale.body._id);

    const updatedProduct = await products.findById(product.body._id).lean();
    expect(updatedProduct?.stockQty).toBe(3);

    expect(
      await invoices.countDocuments({
        tenantId: new Types.ObjectId(registration.body.tenant.id),
      }),
    ).toBe(1);

    expect(
      await movements.countDocuments({
        tenantId: new Types.ObjectId(registration.body.tenant.id),
        productId: new Types.ObjectId(product.body._id),
        type: 'SALE',
      }),
    ).toBe(1);
  });

  it('records a partial sale payment once and rejects an overpayment through HTTP', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'E2E Partial Payment Product',
        purchasePrice: 50,
        sellingPrice: 100,
        mrp: 100,
        gstRate: 0,
        stockQty: 5,
      });

    expect(product.status).toBe(201);

    await tenants.updateOne(
      { _id: registration.body.tenant.id },
      { $set: { stateCode: '09' } },
    );

    const sale = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set(headers)
      .send({
        idempotencyKey: randomUUID(),
        items: [{ productId: product.body._id, quantity: 2 }],
        placeOfSupplyStateCode: '09',
      });

    expect(sale.status).toBe(201);
    expect(sale.body.dueAmount).toBe(200);

    const paymentPayload = {
      idempotencyKey: randomUUID(),
      method: 'CASH',
      amount: 50,
      reference: 'E2E partial payment',
    };

    const firstPayment = await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.body._id}/payments`)
      .set(headers)
      .send(paymentPayload);

    expect(firstPayment.status).toBe(201);
    expect(firstPayment.body.paidAmount).toBe(50);
    expect(firstPayment.body.dueAmount).toBe(150);
    expect(firstPayment.body.paymentStatus).toBe('PARTIALLY_PAID');

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.body._id}/payments`)
      .set(headers)
      .send(paymentPayload);

    expect(retry.status).toBe(201);
    expect(retry.body.paidAmount).toBe(50);
    expect(retry.body.payments).toHaveLength(1);

    const overpayment = await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.body._id}/payments`)
      .set(headers)
      .send({
        idempotencyKey: randomUUID(),
        method: 'UPI',
        amount: 151,
      });

    expect(overpayment.status).toBe(400);

    const storedInvoice = await invoices.findById(sale.body._id).lean();
    expect(storedInvoice?.paidAmount).toBe(50);
    expect(storedInvoice?.dueAmount).toBe(150);
    expect(storedInvoice?.payments).toHaveLength(1);
  });

  it('creates, lists, updates and soft-deletes customers with tenant isolation', async () => {
    const ownerA = await registerAccount();
    const ownerB = await registerAccount();

    expect(ownerA.status).toBe(201);
    expect(ownerB.status).toBe(201);

    const headersA = {
      Authorization: `Bearer ${ownerA.body.accessToken}`,
    };
    const headersB = {
      Authorization: `Bearer ${ownerB.body.accessToken}`,
    };

    const unique = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headersA)
      .send({
        name: 'E2E Customer',
        phone: `98${Date.now().toString().slice(-8)}`,
        email: `customer-${unique}@example.test`,
      });

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('E2E Customer');

    const customerId = created.body._id;

    const listA = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set(headersA);

    expect(listA.status).toBe(200);
    expect(listA.body.items.some((item: any) => item._id === customerId)).toBe(true);

    const listB = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set(headersB);

    expect(listB.status).toBe(200);
    expect(listB.body.items).toHaveLength(0);

    const foreignDetail = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set(headersB);

    expect(foreignDetail.status).toBe(404);

    const foreignUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set(headersB)
      .send({ name: 'Unauthorized Update' });

    expect(foreignUpdate.status).toBe(404);

    const foreignDelete = await request(app.getHttpServer())
      .delete(`/api/v1/customers/${customerId}`)
      .set(headersB);

    expect(foreignDelete.status).toBe(404);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set(headersA)
      .send({ name: 'Updated E2E Customer' });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Updated E2E Customer');

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/customers/${customerId}`)
      .set(headersA);

    expect(deleted.status).toBe(200);
    expect(deleted.body.message).toBe('Customer deleted successfully');

    const afterDelete = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set(headersA);

    expect(afterDelete.status).toBe(404);
  });

  it('links a customer to a sale and returns customer sales history', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const customer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({
        name: 'Sales History Customer',
        phone: `97${Date.now().toString().slice(-8)}`,
      });

    expect(customer.status).toBe(201);

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(headers)
      .send({
        name: 'E2E Customer Sale Product',
        purchasePrice: 50,
        sellingPrice: 100,
        mrp: 100,
        gstRate: 0,
        stockQty: 5,
      });

    expect(product.status).toBe(201);

    await tenants.updateOne(
      { _id: registration.body.tenant.id },
      { $set: { stateCode: '09' } },
    );

    const sale = await request(app.getHttpServer())
      .post('/api/v1/sales')
      .set(headers)
      .send({
        idempotencyKey: randomUUID(),
        customerId: customer.body._id,
        items: [
          {
            productId: product.body._id,
            quantity: 2,
          },
        ],
        placeOfSupplyStateCode: '09',
      });

    expect(sale.status).toBe(201);
    expect(sale.body.customerId).toBe(customer.body._id);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customer.body._id}/sales`)
      .set(headers);

    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]._id).toBe(sale.body._id);
    expect(history.body.summary.invoiceCount).toBe(1);
    expect(history.body.summary.totalBilled).toBe(200);
  });

  it('rejects invalid customer sales history pagination', async () => {
    const registration = await registerAccount();
    expect(registration.status).toBe(201);

    const headers = {
      Authorization: `Bearer ${registration.body.accessToken}`,
    };

    const customer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ name: 'Pagination Customer' });

    expect(customer.status).toBe(201);

    const invalidHistory = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customer.body._id}/sales?page=0`)
      .set(headers);

    expect(invalidHistory.status).toBe(400);
  });
});












