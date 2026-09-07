import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Trash2, Plus, Minus, ArrowRight, Loader2, ShoppingBag } from "lucide-react";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatNumber } from "@/lib/formatters";

/* ── CartItemRow — matches APK CartItemRow exactly ── */
function CartItemRow({ item, onIncrease, onDecrease, onRemove, disabled }: {
  item: any; onIncrease: () => void; onDecrease: () => void; onRemove: () => void; disabled: boolean;
}) {
  const atMaxStock = typeof item.stock === "number" && item.quantity >= item.stock;
  return (
    <Card className="border border-border bg-white shadow-sm rounded-xl py-0">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {/* Image — matches APK AsyncImage size */}
          <Link href={`/product/${item.productId}`}>
            <a className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-secondary/20 border border-border">
              <img src={item.image || "https://via.placeholder.com/150"} alt={item.name}
                className="w-full h-full object-cover" />
            </a>
          </Link>

          {/* Info column — matches APK Column(weight(1f)) */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground text-sm truncate">{item.name}</p>
            <p className="text-primary font-extrabold text-base">{formatNumber(item.price)} ج.س</p>
            {/* Qty row — matches APK Row with IconButtons */}
            <div className="flex items-center gap-0 mt-1.5">
              <button onClick={onDecrease} disabled={disabled}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary/40 hover:bg-secondary disabled:opacity-40">
                <Minus className="w-3 h-3" />
              </button>
              <span className="px-3 font-bold text-sm">{item.quantity}</span>
              <button onClick={onIncrease} disabled={disabled || atMaxStock}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary/40 hover:bg-secondary disabled:opacity-40">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {atMaxStock && (
              <p className="text-[11px] text-orange-500 font-semibold mt-1">وصلت للحد الأقصى المتوفر بالمخزون</p>
            )}
          </div>

          {/* Delete icon — matches APK IconButton(onRemove) */}
          <button onClick={onRemove} disabled={disabled}
            className="p-2 rounded-full hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── OrderSummary — matches APK OrderSummary exactly ── */
function OrderSummary({ subtotal, discount, shipping, total, couponCode, setCouponCode, onApply, onRemoveCoupon, couponApplied, freeShippingThreshold, applying }: any) {
  return (
    <Card className="border border-border bg-white rounded-xl shadow-sm">
      <CardContent className="p-5">
        <h3 className="text-lg font-bold text-foreground mb-4" style={{ fontFamily: "Georgia, serif" }}>
          ملخص الطلب
        </h3>
        {/* Coupon row */}
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="كود الخصم"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            disabled={couponApplied}
            className="border-border bg-secondary/30 h-10 text-sm focus:ring-2 focus:ring-primary"
          />
          <Button onClick={onApply} disabled={couponApplied || applying}
            className="bg-primary text-white hover:bg-primary/90 font-bold h-10 px-4 flex-shrink-0 text-sm">
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : "تطبيق"}
          </Button>
        </div>
        {couponApplied && (
          <div className="flex items-center justify-between p-2.5 bg-green-50 rounded-lg border border-green-200 mb-4">
            <p className="text-xs text-green-700 font-semibold">✓ تم تطبيق الخصم</p>
            <button onClick={onRemoveCoupon} className="text-xs text-green-600 font-bold hover:text-green-700">إزالة</button>
          </div>
        )}
        {/* Summary rows */}
        {[
          { label: "المجموع الفرعي", value: `${formatNumber(subtotal)} ج.س`, color: "" },
          ...(discount > 0 ? [{ label: "الخصم", value: `-${formatNumber(discount)} ج.س`, color: "text-green-600" }] : []),
          { label: "الشحن", value: shipping === 0 ? "مجاني" : `${formatNumber(shipping)} ج.س`, color: shipping === 0 ? "text-green-600" : "" },
        ].map(r => (
          <div key={r.label} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={`font-bold ${r.color}`}>{r.value}</span>
          </div>
        ))}
        <div className="flex justify-between items-center pt-3 mt-2">
          <span className="text-base font-bold text-foreground">الإجمالي</span>
          <span className="text-2xl font-extrabold text-primary">{formatNumber(total)} ج.س</span>
        </div>
        <Link href={couponApplied ? `/checkout?coupon=${couponCode}` : "/checkout"}>
          <a className="block mt-5">
            <Button className="w-full h-13 bg-primary text-white hover:bg-primary/90 font-bold text-base rounded-xl py-3.5">
              المتابعة للدفع
            </Button>
          </a>
        </Link>
        {freeShippingThreshold > 0 && (
          <p className="text-xs text-muted-foreground text-center mt-2.5">
            الشحن مجاني للطلبات فوق {formatNumber(freeShippingThreshold)} ج.س
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Cart() {
  const { data: cartItems = [], isLoading } = trpc.firestore.getCart.useQuery();
  // ✅ الشحن يُجلب من Firebase Firestore فقط (settings/store) — نفس المصدر الذي يستخدمه التطبيق
  const { data: storeSettings } = trpc.firestore.getStoreSettings.useQuery();
  const shippingCost = Number((storeSettings as any)?.shippingCost ?? 30);
  const freeShippingThreshold = Number((storeSettings as any)?.freeShippingThreshold ?? 500);
  const utils = trpc.useUtils();
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponApplied, setCouponApplied] = useState(false);

  const updateQuantity = trpc.firestore.updateCartQuantity.useMutation({
    onSuccess: (data) => {
      utils.firestore.getCart.invalidate();
      if (data?.capped) toast.error("لا يمكن تجاوز الكمية المتوفرة في المخزون");
    },
    onError: (err) => toast.error(err.message || "تعذر تحديث الكمية"),
  });
  const removeFromCart = trpc.firestore.removeFromCart.useMutation({
    onSuccess: () => { toast.success("تم الحذف من السلة"); utils.firestore.getCart.invalidate(); },
  });

  const handleUpdateQty = useCallback((item: any, delta: number) => {
    const newQty = item.quantity + delta;
    if (newQty <= 0) { removeFromCart.mutate({ productId: item.productId }); return; }
    // ✅ تعديل الكمية يتم من السلة فقط، مقيّداً بالكمية المتوفرة في المخزون (يتحقق منها السيرفر)
    if (typeof item.stock === "number" && newQty > item.stock) {
      toast.error("لا يمكن تجاوز الكمية المتوفرة في المخزون");
      return;
    }
    updateQuantity.mutate({ productId: item.productId, quantity: newQty });
  }, [updateQuantity, removeFromCart]);

  // ✅ الكوبونات لم تعد أكواداً ثابتة بالكود — تُقرأ وتُتحقق من مجموعة "coupons" بقاعدة
  // البيانات (تُدار من لوحة التحكم). هذا فقط للمعاينة؛ التحقق النهائي والخصم الفعلي يتمّان
  // في السيرفر عند إنشاء الطلب حتى لا يمكن التلاعب بالخصم من المتصفح.
  const subtotalRaw = cartItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  const isSilentRevalidation = useRef(false);
  const validateCoupon = trpc.firestore.validateCoupon.useMutation({
    onSuccess: (res) => {
      const silent = isSilentRevalidation.current;
      isSilentRevalidation.current = false;
      if (res.valid) {
        setCouponDiscount(res.discountAmount);
        setCouponApplied(true);
        if (!silent) toast.success("تم تطبيق كود الخصم");
      } else {
        setCouponDiscount(0);
        setCouponApplied(false);
        toast.error(res.message);
      }
    },
    onError: (err) => {
      isSilentRevalidation.current = false;
      toast.error(err.message || "تعذر التحقق من كود الخصم");
    },
  });

  const handleApplyCoupon = () => {
    if (!couponCode.trim()) { toast.error("يرجى إدخال كود الخصم"); return; }
    validateCoupon.mutate({ code: couponCode, subtotal: subtotalRaw });
  };

  // ✅ إصلاح: كان تغيير كمية عنصر بالسلة بعد تطبيق كوبون يُبقي couponDiscount
  // كما هو (محسوباً من subtotal القديم) بدل إعادة التحقق — فقد يظل الخصم
  // معروضاً رغم أن السلة لم تعد تحقق الحد الأدنى لهذا الكوبون، أو (لكوبونات
  // النسبة المئوية) يظل المبلغ المطلق القديم بدل احتسابه من الإجمالي الجديد.
  useEffect(() => {
    if (couponApplied && couponCode && subtotalRaw > 0) {
      isSilentRevalidation.current = true;
      validateCoupon.mutate({ code: couponCode, subtotal: subtotalRaw });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotalRaw]);

  const totals = useMemo(() => {
    const subtotal = subtotalRaw;
    const discount = couponApplied ? couponDiscount : 0;
    // ✅ نفس منطق التطبيق تماماً: شحن مجاني فقط إذا كان الحد مفعّلاً (> 0) والمجموع الفرعي يبلغه
    const shipping = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : shippingCost;
    return { subtotal, discount, shipping, total: subtotal - discount + shipping };
  }, [subtotalRaw, couponApplied, couponDiscount, shippingCost, freeShippingThreshold]);

  const isPending = updateQuantity.isPending || removeFromCart.isPending;

  if (isLoading) return <Layout><div className="flex justify-center py-40"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div></Layout>;

  return (
    <Layout>
      <div className="container py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>سلة التسوق</h1>
          <div className="w-10 h-1 bg-primary rounded-full mt-2" />
        </div>

        {cartItems.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Items list — matches APK LazyColumn of CartItemRow ── */}
            <div className="lg:col-span-2 space-y-3">
              <p className="text-sm text-muted-foreground font-semibold mb-1">{cartItems.length} منتج</p>
              {cartItems.map((item: any) => (
                <CartItemRow
                  key={item.id || item.productId}
                  item={item}
                  onIncrease={() => handleUpdateQty(item, 1)}
                  onDecrease={() => handleUpdateQty(item, -1)}
                  onRemove={() => removeFromCart.mutate({ productId: item.productId })}
                  disabled={isPending}
                />
              ))}
              <Link href="/products">
                <a className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-semibold text-sm mt-2">
                  <ArrowRight className="w-4 h-4" /> متابعة التسوق
                </a>
              </Link>
            </div>

            {/* ── Order Summary ── */}
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                <OrderSummary
                  subtotal={totals.subtotal}
                  discount={totals.discount}
                  shipping={totals.shipping}
                  total={totals.total}
                  couponCode={couponCode}
                  setCouponCode={setCouponCode}
                  onApply={handleApplyCoupon}
                  onRemoveCoupon={() => { setCouponCode(""); setCouponDiscount(0); setCouponApplied(false); }}
                  couponApplied={couponApplied}
                  freeShippingThreshold={freeShippingThreshold}
                  applying={validateCoupon.isPending}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-24">
            <div className="w-24 h-24 bg-secondary/30 rounded-full flex items-center justify-center mx-auto mb-5 border border-border">
              <ShoppingBag className="w-12 h-12 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "Georgia, serif" }}>سلتك فارغة</h2>
            <p className="text-muted-foreground mb-7 text-sm">لم تضف أي منتجات بعد. اكتشف مجموعتنا الآن!</p>
            <Link href="/products"><a><Button className="bg-primary text-white hover:bg-primary/90 font-bold px-8 h-12 rounded-xl">تسوق الآن</Button></a></Link>
          </div>
        )}
      </div>
    </Layout>
  );
}
