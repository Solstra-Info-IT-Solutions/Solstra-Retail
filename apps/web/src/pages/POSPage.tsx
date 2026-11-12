import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, ScanBarcode,
  UserRound, CreditCard, Receipt, RefreshCw, CheckCircle2
} from 'lucide-react';
import './POSPage.css';

interface Product {
  _id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  sellingPrice: number;
  mrp: number;
  gstRate: number;
  stockQty: number;
  trackStock: boolean;
  priceIncludesTax: boolean;
  unit: string;
}

interface ProductResponse {
  items: Product[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface CartItem {
  product: Product;
  quantity: number;
  discountAmount: number;
}

const states = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'],
  ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'], ['28', 'Andhra Pradesh (Old)'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'],
  ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
  ['97', 'Other Territory'], ['99', 'Other Territory']
];

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(value);

function createIdempotencyKey(): string {
  const cryptoApi = window.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable.');
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setProductError('');

      try {
        const response = await api.get<ProductResponse>('/products', {
          params: { search: search.trim(), page: 1, limit: 50 }
        });
        if (active) setProducts(response.data.items || []);
      } catch {
        if (active) setProductError('Products could not be loaded. Please retry.');
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  const subtotal = useMemo(
    () => cart.reduce(
      (sum, item) => sum + item.product.sellingPrice * item.quantity,
      0
    ),
    [cart]
  );

  const totalDiscount = useMemo(
    () => cart.reduce((sum, item) => sum + item.discountAmount, 0),
    [cart]
  );

  const estimatedTotal = Math.max(0, subtotal - totalDiscount);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  function addProduct(product: Product) {
    setCheckoutError('');
    setSuccessMessage('');

    if (product.trackStock && product.stockQty <= 0) {
      setCheckoutError(`${product.name} is out of stock.`);
      return;
    }

    setCart(current => {
      const existing = current.find(item => item.product._id === product._id);

      if (existing) {
        if (product.trackStock && existing.quantity >= product.stockQty) {
          setCheckoutError(`Available stock for ${product.name}: ${product.stockQty}`);
          return current;
        }

        return current.map(item =>
          item.product._id === product._id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { product, quantity: 1, discountAmount: 0 }];
    });
  }

  function changeQuantity(productId: string, delta: number) {
    setCart(current =>
      current.map(item => {
        if (item.product._id !== productId) return item;

        const next = item.quantity + delta;

        if (next > item.quantity &&
            item.product.trackStock &&
            next > item.product.stockQty) {
          setCheckoutError(`Only ${item.product.stockQty} units available.`);
          return item;
        }

        return { ...item, quantity: next };
      }).filter(item => item.quantity > 0)
    );
  }

  function updateDiscount(productId: string, value: string) {
    const discount = Math.max(0, Number(value) || 0);

    setCart(current =>
      current.map(item => {
        if (item.product._id !== productId) return item;

        const maximum = item.product.sellingPrice * item.quantity;
        return { ...item, discountAmount: Math.min(discount, maximum) };
      })
    );
  }

  async function checkout() {
    setCheckoutError('');
    setSuccessMessage('');

    if (!cart.length) {
      setCheckoutError('Add at least one product to the cart.');
      return;
    }

    if (!stateCode) {
      setCheckoutError('Select the place-of-supply state before billing.');
      return;
    }

    const amount = Number(paymentAmount || 0);

    if (!Number.isFinite(amount) || amount < 0) {
      setCheckoutError('Enter a valid payment amount.');
      return;
    }

    if (amount > 0 && !paymentMethod) {
      setCheckoutError('Select a payment method.');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        idempotencyKey: createIdempotencyKey(),
        items: cart.map(item => ({
          productId: item.product._id,
          quantity: item.quantity,
          discountAmount: item.discountAmount
        })),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerGstin: customerGstin.trim().toUpperCase() || undefined,
        placeOfSupplyStateCode: stateCode,
        payments: amount > 0 ? [{
          method: paymentMethod,
          amount,
          reference: paymentReference.trim() || undefined
        }] : []
      };
      const response = await api.post<Record<string, unknown>>('/sales', payload);
      const invoiceNumber = response.data.invoiceNumber;

      setSuccessMessage(
        `Invoice created successfully${invoiceNumber ? `: ${String(invoiceNumber)}` : ''}.`
      );
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerGstin('');
      setPaymentAmount('');
      setPaymentReference('');
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message;

      setCheckoutError(
        Array.isArray(message) ? message.join(', ') :
        message || 'Invoice creation failed. Please review the details and retry.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-page">
      <div className="pos-heading">
        <div>
          <span className="pos-eyebrow">SALES WORKSPACE</span>
          <h1>Point of Sale</h1>
          <p>Fast billing, accurate invoices and effortless checkout.</p>
        </div>
        <div className="pos-heading-status">
          <span className="pos-live-dot" /> Live product catalogue
        </div>
      </div>

      <div className="pos-workspace">
        <section className="pos-catalog">
          <div className="pos-catalog-heading">
            <div>
              <h2>Products</h2>
              <span>Search or scan a product barcode</span>
            </div>
            <span className="pos-result-count">{products.length} items</span>
          </div>

          <div className="pos-search">
            <Search size={20} />
            <input
              autoFocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search product, SKU or scan barcode..."
              aria-label="Search products by name, SKU or barcode"
            />
            <ScanBarcode size={21} />
          </div>

          {loading ? (
            <div className="pos-state">
              <RefreshCw className="pos-spin" size={24} />
              <span>Loading products...</span>
            </div>
          ) : productError ? (
            <div className="pos-state pos-error">
              {productError}
              <button onClick={() => setSearch(value => value + ' ')}>
                Retry
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="pos-state">
              <ShoppingCart size={30} />
              <strong>No products found</strong>
              <span>Try another name, SKU or barcode.</span>
            </div>
          ) : (
            <div className="pos-product-grid">
              {products.map(product => {
                const inCart = cart.find(item => item.product._id === product._id);
                const unavailable =
                  product.trackStock && product.stockQty <= 0;

                return (
                  <button
                    type="button"
                    key={product._id}
                    className={`pos-product-card ${unavailable ? 'unavailable' : ''}`}
                    onClick={() => addProduct(product)}
                    disabled={unavailable}
                  >
                    <div className="pos-product-top">
                      <span className="pos-product-category">
                        {product.category || 'General'}
                      </span>
                      {inCart && <span className="pos-in-cart">{inCart.quantity} in cart</span>}
                    </div>
                    <strong className="pos-product-name">{product.name}</strong>
                    <span className="pos-product-sku">
                      {product.sku || product.barcode || 'No product code'}
                    </span>
                    <div className="pos-product-bottom">
                      <div>
                        <strong>{money(product.sellingPrice)}</strong>
                        <span>GST {product.gstRate}%</span>
                      </div>
                      <span className="pos-add-button">
                        <Plus size={18} />
                      </span>
                    </div>
                    <span className={`pos-stock ${unavailable ? 'out' : ''}`}>
                      {product.trackStock
                        ? unavailable ? 'Out of stock' : `${product.stockQty} ${product.unit} available`
                        : 'Stock not tracked'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="pos-checkout">
          <div className="pos-cart-heading">
            <div>
              <h2>Current Bill</h2>
              <span>{itemCount} units · {cart.length} products</span>
            </div>
            <ShoppingCart size={22} />
          </div>

          <div className="pos-cart-items">
            {cart.length === 0 ? (
              <div className="pos-empty-cart">
                <ShoppingCart size={34} />
                <strong>Your cart is empty</strong>
                <span>Select products to start billing.</span>
              </div>
            ) : cart.map(item => (
              <div className="pos-cart-item" key={item.product._id}>
                <div className="pos-cart-item-info">
                  <strong>{item.product.name}</strong>
                  <span>{money(item.product.sellingPrice)} × {item.quantity}</span>
                </div>
                <div className="pos-cart-item-total">
                  {money(item.product.sellingPrice * item.quantity - item.discountAmount)}
                  <button
                    type="button"
                    title="Remove item"
                    onClick={() => setCart(current => current.filter(
                      line => line.product._id !== item.product._id
                    ))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="pos-cart-controls">
                  <div className="pos-quantity-control">
                    <button type="button" onClick={() => changeQuantity(item.product._id, -1)}>
                      <Minus size={14} />
                    </button>
                    <strong>{item.quantity}</strong>
                    <button type="button" onClick={() => changeQuantity(item.product._id, 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                  <label>
                    Discount ?
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.discountAmount}
                      onChange={event => updateDiscount(item.product._id, event.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="pos-customer-section">
            <h3><UserRound size={17} /> Customer details</h3>
            <input
              value={customerName}
              onChange={event => setCustomerName(event.target.value)}
              placeholder="Customer name (optional)"
              maxLength={120}
            />
            <div className="pos-customer-row">
              <input
                value={customerPhone}
                onChange={event => setCustomerPhone(event.target.value)}
                placeholder="Phone number"
                maxLength={20}
              />
              <input
                value={customerGstin}
                onChange={event => setCustomerGstin(event.target.value.toUpperCase())}
                placeholder="GSTIN (optional)"
                maxLength={15}
              />
            </div>
            <select value={stateCode} onChange={event => setStateCode(event.target.value)}>
              <option value="">Select place of supply *</option>
              {states.map(([code, name]) => (
                <option value={code} key={code}>{code} — {name}</option>
              ))}
            </select>
          </div>

          <div className="pos-payment-section">
            <h3><CreditCard size={17} /> Payment collection</h3>
            <select
              value={paymentMethod}
              onChange={event => setPaymentMethod(event.target.value)}
            >
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={paymentAmount}
              onChange={event => setPaymentAmount(event.target.value)}
              placeholder="Amount collected (?) — leave blank for unpaid"
            />
            {paymentMethod !== 'CASH' && (
              <input
                value={paymentReference}
                onChange={event => setPaymentReference(event.target.value)}
                placeholder="Payment reference (optional)"
                maxLength={100}
              />
            )}
          </div>

          <div className="pos-bill-summary">
            <div><span>Subtotal (before tax adjustment)</span><strong>{money(subtotal)}</strong></div>
            <div><span>Item discounts</span><strong>- {money(totalDiscount)}</strong></div>
            <div className="pos-estimated-total">
              <span>Estimated amount</span>
              <strong>{money(estimatedTotal)}</strong>
            </div>
            <p>Final GST and invoice totals are calculated and validated by the server.</p>
          </div>

          {checkoutError && <div className="pos-message pos-message-error">{checkoutError}</div>}
          {successMessage && (
            <div className="pos-message pos-message-success">
              <CheckCircle2 size={18} /> {successMessage}
            </div>
          )}

          <div className="pos-checkout-actions">
            <button
              type="button"
              className="pos-clear-button"
              onClick={() => {
                setCart([]);
                setCheckoutError('');
                setSuccessMessage('');
              }}
              disabled={!cart.length || submitting}
            >
              Clear
            </button>
            <button
              type="button"
              className="pos-submit-button"
              onClick={checkout}
              disabled={!cart.length || submitting}
            >
              {submitting ? <RefreshCw className="pos-spin" size={18} /> : <Receipt size={18} />}
              {submitting ? 'Creating invoice...' : 'Create invoice'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}


