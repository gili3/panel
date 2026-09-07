import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useLocation, useSearch, Link } from "wouter";
import { MapPin, CreditCard, CheckCircle, Plus, Loader2, Upload, X, ChevronRight, AlertCircle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatNumber } from "@/lib/formatters";
import { uploadImageToStorage } from "@/lib/imageUpload";
import { auth } from "@/lib/firebase";

/* ─── Step Indicator ─── */
function StepBar({ current }: { current: number }) {
  const steps = [
    { n: 1, label: "العنوان", icon: MapPin },
    { n: 2, label: "الدفع", icon: CreditCard },
    { n: 3, label: "التأكيد", icon: CheckCircle },
  ];
  return (
    <div className="flex items-center justify-center px-6 py-5">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all
              ${current >= s.n ? "bg-primary text-white shadow-md" : "bg-secondary text-muted-foreground"}`}>
              {current > s.n ? <CheckCircle className="w-5 h-5" /> : s.n}
            </div>
            <span className={`text-xs mt-1.5 font-semibold ${current >= s.n ? "text-primary" : "text-muted-foreground"}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-16 mx-2 mb-4 rounded transition-all ${current > s.n ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Step 1: Address ─── */
function AddressStep({ onNext }: { onNext: (addr: any) => void }) {
  const { data: addresses = [], isLoading } = trpc.firestore.getAddresses.useQuery();
  const [selected, setSelected] = useState<any>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (addresses.length > 0 && !selected) setSelected(addresses[0]);
  }, [addresses]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>
          عنوان الشحن
        </h2>
        <Link href="/profile?tab=addresses">
          <a className="flex items-center gap-1 text-primary text-sm font-semibold hover:text-primary/80">
            <Plus className="w-4 h-4" /> إضافة عنوان
          </a>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : addresses.length === 0 ? (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-6 text-center">
            <MapPin className="w-12 h-12 text-orange-400 mx-auto mb-3" />
            <p className="font-bold text-orange-700">لا توجد عناوين مسجّلة</p>
            <p className="text-sm text-orange-600 mt-1">يرجى إضافة عنوان للمتابعة</p>
            <Link href="/profile">
              <a>
                <Button className="mt-4 bg-primary text-white hover:bg-primary/90">إضافة عنوان</Button>
              </a>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr: any) => (
            <Card
              key={addr.id}
              onClick={() => setSelected(addr)}
              className={`cursor-pointer transition-all border-2 ${selected?.id === addr.id ? "border-primary bg-accent/5" : "border-border hover:border-primary/40"}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center
                    ${selected?.id === addr.id ? "border-primary" : "border-border"}`}>
                    {selected?.id === addr.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className="font-bold text-foreground">{addr.fullName}</p>
                    <p className="text-sm text-muted-foreground">{addr.city} — {addr.address}</p>
                    <p className="text-sm text-muted-foreground" dir="ltr">{addr.phone}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Button
        onClick={() => { if (selected) onNext(selected); else toast.error("يرجى اختيار عنوان الشحن"); }}
        disabled={!selected}
        className="w-full h-13 bg-primary text-white hover:bg-primary/90 font-bold text-base rounded-xl mt-4"
      >
        المتابعة للدفع <ChevronRight className="w-5 h-5 mr-1" />
      </Button>
    </div>
  );
}

/* ─── Step 2: Payment ─── */
function PaymentStep({ total, onNext, onBack }: { total: number; onNext: (file: File) => void; onBack: () => void }) {
  const { data: settings } = trpc.firestore.getStoreSettings.useQuery();
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>
        الدفع عبر التحويل البنكي
      </h2>

      <Card className="border-border bg-card">
        <CardContent className="p-5 space-y-3">
          <p className="font-bold text-primary text-sm">بيانات الحساب البنكي</p>
          {[
            ["البنك", settings?.bankName || "البنك الأهلي"],
            ["رقم الحساب", settings?.bankAccountNumber || "SA1234567890"],
            ["اسم المستفيد", settings?.bankAccountName || "Eleven Store"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-foreground" dir="ltr">{value}</span>
            </div>
          ))}
          <div className="flex justify-between items-center pt-2">
            <span className="font-bold text-foreground">المبلغ المطلوب</span>
            <span className="text-2xl font-bold text-primary">{formatNumber(total)} ج.س</span>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="font-semibold text-foreground text-sm mb-2">ارفق إيصال التحويل</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button
          onClick={() => fileRef.current?.click()}
          className={`w-full h-14 rounded-xl border-2 border-dashed flex items-center justify-center gap-3 font-semibold transition-all
            ${file ? "border-primary bg-accent/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
        >
          {file ? (
            <><CheckCircle className="w-5 h-5" /> {file.name}</>
          ) : (
            <><Upload className="w-5 h-5" /> اختيار صورة الإيصال</>
          )}
        </button>
        {file && (
          <button onClick={() => setFile(null)} className="flex items-center gap-1 text-xs text-destructive mt-1 hover:text-destructive/80">
            <X className="w-3 h-3" /> إزالة الملف
          </button>
        )}
      </div>

      <Button
        onClick={() => { if (file) onNext(file); else toast.error("يرجى رفع إيصال الدفع"); }}
        disabled={!file}
        className="w-full h-13 bg-primary text-white hover:bg-primary/90 font-bold text-base rounded-xl"
      >
        مراجعة الطلب <ChevronRight className="w-5 h-5 mr-1" />
      </Button>
      <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">العودة لاختيار العنوان</Button>
    </div>
  );
}

/* ─── Step 3: Confirmation ─── */
function ConfirmationStep({
  address, total, cartItems, receiptFile, onBack, onPlace, isLoading,
}: any) {
  const [agree, setAgree] = useState(false);

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>تأكيد الطلب</h2>

      <Card className="border-border bg-card">
        <CardContent className="p-5 space-y-3">
          <p className="font-bold text-primary text-sm">عنوان الشحن</p>
          <div className="text-sm space-y-1">
            <p className="font-bold text-foreground">{address?.fullName}</p>
            <p className="text-muted-foreground">{address?.city} — {address?.address}</p>
            <p className="text-muted-foreground" dir="ltr">{address?.phone}</p>
          </div>
          <div className="border-t border-border pt-3 flex justify-between items-center">
            <span className="font-bold text-foreground">الإجمالي النهائي</span>
            <span className="text-2xl font-bold text-primary">{formatNumber(total)} ج.س</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <p className="font-bold text-primary text-sm mb-3">المنتجات ({cartItems.length})</p>
          <div className="space-y-2">
            {cartItems.map((item: any) => (
              <div key={item.productId} className="flex items-center gap-3">
                <img src={item.image || ""} alt={item.name} className="w-10 h-10 rounded-lg object-cover border border-border" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">× {item.quantity}</p>
                </div>
                <p className="text-sm font-bold text-primary">{formatNumber(item.price * item.quantity)} ج.س</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div
        className="flex items-start gap-3 p-4 bg-secondary/20 rounded-xl border border-border cursor-pointer"
        onClick={() => setAgree(!agree)}
      >
        <Checkbox
          checked={agree}
          onCheckedChange={(v) => setAgree(v as boolean)}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5"
        />
        <p className="text-sm text-foreground leading-relaxed">
          {/* ✅ إصلاح: رابط ميت href="#" — يشير الآن للصفحتين الفعليتين */}
          أوافق على <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold">الشروط والأحكام</a> و<a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold">سياسة الخصوصية</a>
        </p>
      </div>

      <Button
        onClick={onPlace}
        disabled={!agree || isLoading}
        className="w-full h-14 bg-primary text-white hover:bg-primary/90 font-bold text-lg rounded-xl"
      >
        {isLoading ? <><Loader2 className="w-5 h-5 animate-spin ml-2" />جاري إتمام الطلب...</> : "إتمام الطلب الآن"}
      </Button>
      <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">العودة لتعديل الدفع</Button>
    </div>
  );
}

/* ─── Main Checkout Page ─── */
export default function Checkout() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [step, setStep] = useState(1);
  const [selectedAddress, setSelectedAddress] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // ✅ شراء الآن: عند وجود buyNow=1 في الرابط، نتجاهل السلة تماماً
  // ونبني عنصر طلب واحد من المنتج مباشرة (نفس مسار BUY_NOW في التطبيق)
  const params = new URLSearchParams(search);
  const isBuyNow = params.get("buyNow") === "1";
  const buyNowProductId = params.get("productId") || "";
  const buyNowQuantity = parseInt(params.get("quantity") || "1", 10);

  const {
    data: buyNowProduct,
    isLoading: buyNowLoading,
    isFetched: buyNowFetched,
  } = trpc.firestore.getProduct.useQuery(
    { id: buyNowProductId }, { enabled: isBuyNow && !!buyNowProductId }
  );

  // ✅ إصلاح: "اشترِ الآن" لمنتج محذوف أو غير موجود (أو استعلامه ما زال قيد
  // التحميل) كان يُنتج نفس الشكل تماماً: cartItems = [] — فتظهر شاشة الدفع
  // وكأنها سلة فارغة عادية بدل توضيح أن المنتج تحديداً غير متاح، مع بقاء زر
  // "إتمام الطلب" قابلاً للضغط في حالة السلة الفارغة الحقيقية.
  const buyNowProductUnavailable =
    isBuyNow && (!buyNowProductId || (buyNowFetched && !buyNowProduct));

  const { data: cartItemsRaw = [], isLoading: cartLoading } = trpc.firestore.getCart.useQuery(undefined, { enabled: !isBuyNow });
  const { data: settings } = trpc.firestore.getStoreSettings.useQuery();
  const utils = trpc.useUtils();

  // ✅ مصدر العناصر: المنتج المُشترى مباشرة، أو السلة — مفصولان تماماً (نفس منطق التطبيق)
  const cartItems = isBuyNow
    ? (buyNowProduct ? [{
        productId: buyNowProduct.id,
        name: buyNowProduct.name,
        price: buyNowProduct.price,
        quantity: buyNowQuantity,
        image: (buyNowProduct.images?.[0] || buyNowProduct.image || ""),
      }] : [])
    : cartItemsRaw;

  const total = cartItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  // ✅ الشحن يُجلب من Firebase Firestore فقط (settings/store) — نفس منطق CartScreen بالتطبيق تماماً
  const shippingCost = Number((settings as any)?.shippingCost ?? 30);
  const freeShippingThreshold = Number((settings as any)?.freeShippingThreshold ?? 500);
  const shipping = freeShippingThreshold > 0 && total >= freeShippingThreshold ? 0 : shippingCost;

  // ✅ كود الخصم يصل من صفحة السلة عبر رابط الاستعلام؛ هذا فقط لعرض تقديري —
  // القيمة النهائية المعتمَدة تُحسب وتُتحقق في السيرفر عند إنشاء الطلب.
  // ✅ إصلاح: كان الكوبون يصل فقط من رابط صفحة السلة — عند "اشترِ الآن" (تخطّي
  // السلة كلياً) لم توجد أي طريقة لكتابة كود خصم إطلاقاً رغم أن السيرفر
  // (createDirectOrder) يدعمه بالكامل. أصبح الآن حقلاً قابلاً للتعديل يدوياً
  // هنا أيضاً، مع تعبئته تلقائياً إن وصل عبر الرابط كما كان سابقاً.
  const [couponCode, setCouponCode] = useState(params.get("coupon") || "");
  const [couponInput, setCouponInput] = useState(params.get("coupon") || "");
  const [discount, setDiscount] = useState(0);
  const validateCoupon = trpc.firestore.validateCoupon.useMutation({
    onSuccess: (res) => setDiscount(res.valid ? res.discountAmount : 0),
  });
  useEffect(() => {
    if (couponCode && total > 0) validateCoupon.mutate({ code: couponCode, subtotal: total });
  }, [couponCode, total]);
  const finalTotal = total - discount + shipping;

  const createOrder = trpc.firestore.createOrder.useMutation({
    onSuccess: (data: any) => {
      // ✅ لا تمسح/تلمس السلة عند شراء الآن، فقط عند الدفع عبر السلة العادية
      if (!isBuyNow) utils.firestore.getCart.invalidate();
      toast.success("🎉 تم إنشاء الطلب بنجاح!");
      setLocation(`/order/${data.id}`);
    },
    onError: (err: any) => toast.error(err.message || "فشل في إنشاء الطلب"),
  });

  const createDirectOrder = trpc.firestore.createDirectOrder.useMutation({
    onSuccess: (data: any) => {
      toast.success("🎉 تم إنشاء الطلب بنجاح!");
      setLocation(`/order/${data.id}`);
    },
    onError: (err: any) => toast.error(err.message || "فشل في إنشاء الطلب"),
  });

  // ✅ إصلاح: كان يُرسَل receiptFile?.name فقط (اسم الملف كنص، وليس رابطاً)، وهذا ما
  // تُخزّنه قاعدة البيانات كـ paymentReceipt ثم تعرضه لوحة التحكم كرابط
  // <a href={paymentReceipt}> — فينتج رابط خاطئ تماماً، ولا يمكن فتح صورة الإيصال
  // أبداً من لوحة التحكم. الآن نرفع الملف فعلياً إلى Firebase Storage أولاً (بنفس
  // آلية رفع صور المنتجات) ونرسل رابط التنزيل الحقيقي الناتج منها.
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  const handlePlaceOrder = async () => {
    if (!selectedAddress) return;

    let paymentReceiptUrl: string | undefined;
    if (receiptFile) {
      // ✅ إصلاح حرج: كان يُرفَع سابقاً لمسار "receipts" العام (بلا uid)، وهو
      // مسار كانت قواعد Storage ترفضه تماماً (غير موجود بالقائمة البيضاء،
      // وحتى لو أُضيف فهو يتطلب صلاحية أدمن لا يملكها العميل العادي) — أي
      // محاولة دفع بتحويل بنكي كانت تفشل فعلياً بهذه النقطة. الآن نرفع
      // لمسار receipts/{uid}/{اسم الملف} المطابق لقاعدة Storage الجديدة
      // المخصّصة لصاحب الحساب نفسه فقط (ونفس بنية المسار المستخدمة بالأندرويد).
      const uid = auth.currentUser?.uid;
      if (!uid) {
        toast.error("يجب تسجيل الدخول لرفع إيصال الدفع");
        return;
      }
      setIsUploadingReceipt(true);
      const toastId = toast.loading("📤 جاري رفع إيصال الدفع...");
      try {
        paymentReceiptUrl = await uploadImageToStorage(receiptFile, `receipts/${uid}`);
        toast.dismiss(toastId);
      } catch (error: any) {
        toast.error(`❌ ${error.message || "فشل رفع إيصال الدفع"}`, { id: toastId });
        setIsUploadingReceipt(false);
        return;
      }
      setIsUploadingReceipt(false);
    }

    // ✅ لا نرسل price/name/total إطلاقاً — السيرفر يشتقها من قاعدة البيانات
    if (isBuyNow) {
      createDirectOrder.mutate({
        productId: buyNowProductId,
        quantity: buyNowQuantity,
        couponCode: couponCode || undefined,
        shippingAddress: selectedAddress,
        paymentMethod: "bank_transfer",
        paymentReceipt: paymentReceiptUrl,
      });
    } else {
      createOrder.mutate({
        items: cartItems.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
        couponCode: couponCode || undefined,
        shippingAddress: selectedAddress,
        paymentMethod: "bank_transfer",
        paymentReceipt: paymentReceiptUrl,
      });
    }
  };

  // ✅ حالة تحميل واضحة أثناء جلب منتج "اشترِ الآن" — بدل ظهور "المنتجات (0)"
  // للحظة قبل وصول الرد.
  if (isBuyNow && buyNowLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-40">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // ✅ حالة خطأ واضحة: منتج "اشترِ الآن" غير موجود/محذوف، بدل شاشة دفع
  // تبدو كسلة فارغة عادية مع زر "إتمام الطلب" لا يزال قابلاً للضغط.
  if (buyNowProductUnavailable) {
    return (
      <Layout>
        <div className="container py-20 max-w-md text-center">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-destructive" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">هذا المنتج غير متاح</h2>
          <p className="text-muted-foreground mb-8">
            قد يكون المنتج قد حُذف أو نفدت كميته. تصفّح بقية المنتجات لإكمال طلبك.
          </p>
          <Link href="/products">
            <a>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                تصفّح المنتجات
              </Button>
            </a>
          </Link>
        </div>
      </Layout>
    );
  }

  // ✅ حالة تحميل واضحة للسلة العادية (غير Buy Now) — بنفس منطق Buy Now أعلاه.
  if (!isBuyNow && cartLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-40">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // ✅ سلة فارغة حقيقية (وليست حالة Buy Now) — امنع الوصول لخطوات الدفع
  // بلا أي عنصر، بدل ترك زر "إتمام الطلب" قابلاً للضغط بقائمة فارغة.
  if (!isBuyNow && cartItems.length === 0) {
    return (
      <Layout>
        <div className="container py-20 max-w-md text-center">
          <div className="w-20 h-20 bg-accent/10 border-2 border-primary rounded-full flex items-center justify-center mx-auto mb-6">
            <CreditCard className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">سلتك فارغة</h2>
          <p className="text-muted-foreground mb-8">أضف بعض المنتجات إلى سلتك أولاً لإكمال الطلب.</p>
          <Link href="/products">
            <a>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                تصفّح المنتجات
              </Button>
            </a>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-10 max-w-xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>إتمام الطلب</h1>
          <div className="w-10 h-1 bg-primary rounded-full mt-2" />
        </div>

        <Card className="border-border bg-card shadow-sm overflow-hidden">
          <div className="h-1 bg-primary" />
          <StepBar current={step} />
          <CardContent className="p-6 pt-2">
            {step === 1 && (
              <AddressStep onNext={(addr) => { setSelectedAddress(addr); setStep(2); }} />
            )}
            {step === 2 && (
              <>
                {/* ✅ إصلاح: خانة كوبون داخل الدفع نفسه — تعمل الآن مع "اشترِ الآن" أيضاً */}
                <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30">
                  <div className="flex gap-2">
                    <input
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="كود الخصم (إن وجد)"
                      className="flex-1 h-10 px-3 rounded-md border border-input bg-background text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!couponInput.trim() || validateCoupon.isPending}
                      onClick={() => setCouponCode(couponInput.trim().toUpperCase())}
                    >
                      تطبيق
                    </Button>
                  </div>
                  {couponCode && discount > 0 && (
                    <p className="text-xs text-green-600 font-semibold mt-2">تم تطبيق خصم بقيمة {discount} — الإجمالي بعد الخصم: {finalTotal}</p>
                  )}
                  {couponCode && !validateCoupon.isPending && discount === 0 && validateCoupon.isSuccess && (
                    <p className="text-xs text-destructive mt-2">كود الخصم غير صالح أو منتهي</p>
                  )}
                </div>
                <PaymentStep
                  total={finalTotal}
                  onNext={(file) => { setReceiptFile(file); setStep(3); }}
                  onBack={() => setStep(1)}
                />
              </>
            )}
            {step === 3 && (
              <ConfirmationStep
                address={selectedAddress}
                total={finalTotal}
                cartItems={cartItems}
                receiptFile={receiptFile}
                onBack={() => setStep(2)}
                onPlace={handlePlaceOrder}
                isLoading={isUploadingReceipt || createOrder.isPending || createDirectOrder.isPending}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
