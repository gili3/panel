// client/src/pages/AdminDashboard.tsx
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  BarChart3, ShoppingBag, DollarSign, Plus, Edit2, Trash2, Loader2, AlertCircle,
  X, Upload, Users, Package, TrendingUp, Clock, CheckCircle, ChevronDown, ChevronUp,
  Image as ImageIcon, Settings, ShoppingCart, Star, Tag
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getOrderStatusConfig } from "@/lib/orderStatus";
import { formatNumber } from "@/lib/formatters";
import { uploadMultipleImages, deleteImageFromStorage, compressImage, uploadImageToStorage } from "@/lib/imageUpload";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, limit as fsLimit, query as fsQuery } from "firebase/firestore";
import { useRoute } from "wouter";
import AdminSidebar from "@/components/AdminSidebar";
import { ADMIN_SECTIONS } from "@/lib/adminSections";

interface ProductFormData {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  price: number;
  originalPrice: number;
  categoryId: string;
  brandId?: string;
  images: string[];
  stock: number;
  isFeatured: boolean;
  isOnSale: boolean;
  isBestSeller: boolean;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

interface CategoryFormData {
  id: string;
  name: string;
  description: string;
  image: string;
}

interface BannerFormData {
  id: string;
  title: string;
  description: string;
  image: string;
  cta: string;
  link: string;
  order: number;
  isActive: boolean;
}

interface BrandFormData {
  id: string;
  name: string;
  logo: string;
  link: string;
}

interface OrderStatusDialogProps {
  orderId: string;
  currentStatus: string;
  currentPaymentStatus: string;
  paymentReceipt?: string;
  onSave: (status: string, paymentStatus: string) => void;
  onClose: () => void;
}

// ✅ إصلاح: كانت هذه الدالة تعرّف ألوان حالة الطلب محلياً بتدرّج Tailwind
// مختلف تماماً عن الموقع (bg-yellow-100/bg-blue-100/bg-indigo-100...) —
// الآن موحّدة 100% مع Orders.tsx / OrderDetail.tsx / VerifyOrder.tsx عبر
// نفس المصدر lib/orderStatus.ts، بنفس القيم الست عشرية الثابتة المطلوبة.
function StatusBadge({ status }: { status: string }) {
  const { label, style } = getOrderStatusConfig(status);
  return (
    <span
      style={style}
      className="px-2 py-1 rounded text-xs font-semibold"
    >
      {label}
    </span>
  );
}

function OrderStatusDialog({ orderId, currentStatus, currentPaymentStatus, paymentReceipt, onSave, onClose }: OrderStatusDialogProps) {
  const [status, setStatus] = useState(currentStatus);
  const [paymentStatus, setPaymentStatus] = useState(currentPaymentStatus);

  useEffect(() => {
    setStatus(currentStatus);
    setPaymentStatus(currentPaymentStatus);
  }, [currentStatus, currentPaymentStatus]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>تحديث حالة الطلب #{orderId.slice(0, 8)}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-semibold">حالة الطلب</label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">قيد الانتظار</SelectItem>
              <SelectItem value="paid">تم الدفع</SelectItem>
              <SelectItem value="shipped">خرج للتوصيل</SelectItem>
              <SelectItem value="delivered">تم التسليم</SelectItem>
              <SelectItem value="cancelled">ملغى</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {paymentReceipt && (
          <div>
            <label className="text-sm font-semibold block mb-2">إيصال الدفع</label>
            {/* ✅ إصلاح: بعض الطلبات القديمة (من نسخة سابقة من التطبيق) كانت
                تخزّن قيمة غير صالحة كرابط (مثل معرّف محلي وليس رابط صورة فعلي)،
                فيفتح الزر رابطاً خاطئاً مثل https://eleven-sd.com/admin/xxxxx
                بدل صورة الإيصال. الآن نتحقق أن القيمة رابط فعلي (http/https)
                قبل عرضها كزر قابل للفتح، وإلا نعرض تنبيهاً بدل رابط مكسور. */}
            {/^https?:\/\//i.test(paymentReceipt) ? (
              <a href={paymentReceipt} target="_blank" rel="noreferrer" className="text-primary hover:underline text-sm flex items-center gap-2">
                <Upload className="w-4 h-4" /> عرض صورة الإيصال
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                لا يمكن عرض هذا الإيصال (تم رفعه بنسخة قديمة من التطبيق)
              </p>
            )}
          </div>
        )}
        <div>
          <label className="text-sm font-semibold">حالة الدفع</label>
          <Select value={paymentStatus} onValueChange={setPaymentStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">غير مدفوع</SelectItem>
              {/* ✅ إصلاح: قيمة جديدة تعكس الحالة الافتراضية الآن عند رفع إيصال
                  (بانتظار مراجعة الأدمن يدوياً بدل تأكيد "مدفوع" تلقائياً) */}
              <SelectItem value="pending_review">بانتظار المراجعة</SelectItem>
              <SelectItem value="paid">مدفوع</SelectItem>
              <SelectItem value="failed">فشل الدفع</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onSave(status, paymentStatus)}>حفظ</Button>
          <Button variant="outline" className="flex-1" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  value: string | number;
  icon: any;
  iconColor: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className={`cursor-pointer transition-all ${children ? "hover:shadow-md" : ""}`}
      onClick={() => children && setExpanded((v) => !v)}
    >
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Icon className={`w-7 h-7 ${iconColor}`} />
            {children && (
              expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
        {expanded && children && (
          <div className="mt-4 pt-4 border-t border-border" onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { user, loading, roleLoading, logout } = useAuth();

  // ✅ الآن كل قسم له رابط حقيقي خاص به (/products، /orders...) بدل تابات
  // بحالة داخلية فقط — قابل للمشاركة، ويعمل معه زر الرجوع بالمتصفح.
  const VALID_TAB_KEYS = ["products", "orders", "categories", "banners", "brands", "coupons", "settings"];
  const [, routeParams] = useRoute<{ section?: string }>("/:section?");
  const rawSection = routeParams?.section;
  const sectionKey = rawSection && VALID_TAB_KEYS.includes(rawSection) ? rawSection : "overview";

  const productImageInputRef = useRef<HTMLInputElement>(null);
  const categoryImageInputRef = useRef<HTMLInputElement>(null);
  const bannerImageInputRef = useRef<HTMLInputElement>(null);
  const brandLogoInputRef = useRef<HTMLInputElement>(null);

  // Product Form
  const [productForm, setProductForm] = useState<ProductFormData>({
    id: "", name: "", description: "", basePrice: 0, price: 0, originalPrice: 0,
    categoryId: "", brandId: "", images: [], stock: 0,
    isFeatured: false, isOnSale: false, isBestSeller: false,
    discountType: 'percentage', discountValue: 0,
  });
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [isUploadingProductImage, setIsUploadingProductImage] = useState(false);

  // Category Form
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>({
    id: "", name: "", description: "", image: "",
  });
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [isUploadingCategoryImage, setIsUploadingCategoryImage] = useState(false);

  // Banner Form
  const [bannerForm, setBannerForm] = useState<BannerFormData>({
    id: "", title: "", description: "", image: "", cta: "تسوق الآن", link: "", order: 0, isActive: true,
  });
  const [showBannerDialog, setShowBannerDialog] = useState(false);
  const [isEditingBanner, setIsEditingBanner] = useState(false);
  const [isUploadingBannerImage, setIsUploadingBannerImage] = useState(false);

  // Brand Form
  const [brandForm, setBrandForm] = useState<BrandFormData>({
    id: "", name: "", logo: "", link: "",
  });
  const [showBrandDialog, setShowBrandDialog] = useState(false);
  const [isEditingBrand, setIsEditingBrand] = useState(false);
  const [isUploadingBrandLogo, setIsUploadingBrandLogo] = useState(false);

  // Coupon Form
  const [couponForm, setCouponForm] = useState({
    code: "", discountType: "percentage" as "percentage" | "fixed", discountValue: 0,
    isActive: true, minOrderAmount: 0, usageLimit: 0, expiresAt: "",
  });
  const [showCouponDialog, setShowCouponDialog] = useState(false);
  const [isEditingCoupon, setIsEditingCoupon] = useState(false);

  const [activeOrderDialog, setActiveOrderDialog] = useState<{ id: string; status: string; paymentStatus: string; receipt?: string } | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");

  const [settingsForm, setSettingsForm] = useState({
    storeName: "",
    phone: "",
    email: "",
    address: "",
    shippingCost: 30,
    freeShippingThreshold: 500,
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    whatsapp: "",
    facebook: "",
    instagram: "",
    twitter: "",
    lowStockThreshold: 5,
    storeDescription: "",
    storeVision: "",
    storeMission: "",
    storeAboutImage: "",
    feature1Title: "", feature1Desc: "",
    feature2Title: "", feature2Desc: "",
    feature3Title: "", feature3Desc: "",
    feature4Title: "", feature4Desc: "",
  });

  // Data fetching
  const { data: storeSettings } = trpc.firestore.getStoreSettings.useQuery();
  const { data: products = [], isLoading: isProductsLoading } = trpc.firestore.getAllProductsAdmin.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  const { data: categories = [], isLoading: isCategoriesLoading } = trpc.firestore.getCategories.useQuery();
  const { data: banners = [], isLoading: isBannersLoading } = trpc.firestore.getAllBannersAdmin.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  const { data: coupons = [], isLoading: isCouponsLoading } = trpc.firestore.getCoupons.useQuery();
  const { data: brands = [], isLoading: isBrandsLoading } = trpc.firestore.getBrands.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });
  // ✅ Pagination حقيقية: نجلب أول صفحة عبر useQuery، ثم نراكم صفحات إضافية
  // يدويًا عبر "تحميل المزيد" (utils.fetch) بدل جلب كل الطلبات دفعة واحدة.
  const [loadedOrders, setLoadedOrders] = useState<any[]>([]);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [isLoadingMoreOrders, setIsLoadingMoreOrders] = useState(false);
  const { data: firstOrdersPage, isLoading: isOrdersLoading } = trpc.firestore.getAllOrdersAdmin.useQuery(
    { status: orderStatusFilter as any },
    { enabled: !!user && user.role === "admin" }
  );
  useEffect(() => {
    if (firstOrdersPage) {
      setLoadedOrders(firstOrdersPage.orders);
      setOrdersCursor(firstOrdersPage.nextCursor);
    }
  }, [firstOrdersPage]);
  const allOrders = loadedOrders;
  const loadMoreOrders = async () => {
    if (!ordersCursor || isLoadingMoreOrders) return;
    setIsLoadingMoreOrders(true);
    try {
      const page = await utils.firestore.getAllOrdersAdmin.fetch({
        status: orderStatusFilter as any,
        cursor: ordersCursor,
      });
      setLoadedOrders((prev) => [...prev, ...page.orders]);
      setOrdersCursor(page.nextCursor);
    } catch (err: any) {
      toast.error(err?.message || "تعذّر تحميل المزيد من الطلبات");
    } finally {
      setIsLoadingMoreOrders(false);
    }
  };

  // ✅ تحديث لحظي: نراقب أحدث طلب بالمجموعة مباشرة عبر Firestore (بلا تمرير
  // بـtRPC) لنعرف فور وصول طلب جديد دون أي إعادة تحميل يدوية — فقط تنبيه
  // بزر "تحديث"، لا نُدرج الطلب تلقائيًا حتى لا تتحرك القائمة تحت يد الأدمن.
  const [hasNewOrders, setHasNewOrders] = useState(false);
  const latestKnownOrderIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    const q = fsQuery(collection(db, "orders"), orderBy("createdAt", "desc"), fsLimit(1));
    const unsubscribe = onSnapshot(q, (snap) => {
      const latest = snap.docs[0];
      if (!latest) return;
      if (latestKnownOrderIdRef.current === null) {
        latestKnownOrderIdRef.current = latest.id;
        return;
      }
      if (latest.id !== latestKnownOrderIdRef.current) {
        latestKnownOrderIdRef.current = latest.id;
        setHasNewOrders(true);
      }
    });
    return () => unsubscribe();
  }, [user]);
  const refreshOrdersNow = () => {
    setHasNewOrders(false);
    utils.firestore.getAllOrdersAdmin.invalidate();
  };
  const { data: stats = {} as any } = trpc.firestore.getAdminStats.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  useEffect(() => {
    if (storeSettings && typeof storeSettings === "object") {
      const s = storeSettings as any;
      setSettingsForm({
        storeName: s.storeName || "",
        phone: s.phone || "",
        email: s.email || "",
        address: s.address || "",
        shippingCost: Number(s.shippingCost) || 30,
        freeShippingThreshold: Number(s.freeShippingThreshold) || 500,
        bankName: s.bankName || "",
        bankAccountName: s.bankAccountName || "",
        bankAccountNumber: s.bankAccountNumber || "",
        whatsapp: s.whatsapp || "",
        facebook: s.facebook || "",
        instagram: s.instagram || "",
        twitter: s.twitter || "",
        lowStockThreshold: Number(s.lowStockThreshold) || 5,
        storeDescription: s.storeDescription || "",
        storeVision: s.storeVision || "",
        storeMission: s.storeMission || "",
        storeAboutImage: s.storeAboutImage || "",
        feature1Title: s.feature1Title || "",
        feature1Desc: s.feature1Desc || "",
        feature2Title: s.feature2Title || "",
        feature2Desc: s.feature2Desc || "",
        feature3Title: s.feature3Title || "",
        feature3Desc: s.feature3Desc || "",
        feature4Title: s.feature4Title || "",
        feature4Desc: s.feature4Desc || "",
      });
    }
  }, [storeSettings]);

  const utils = trpc.useUtils();

  // Product Mutations
  // ✅ إصلاح: كانت تُبطِل (invalidate) كاش getProducts العام (المتجر للزوار)
  // بدل getAllProductsAdmin الذي تعرضه لوحة التحكم فعلياً — بعد هذا التعديل،
  // إضافة/تعديل/حذف منتج في لوحة التحكم كان لا يُحدِّث جدول المنتجات بنفس
  // الشاشة إطلاقاً إلا بعد إعادة تحميل الصفحة يدوياً (F5) لأن مفتاح الكاش
  // المختلف لا يتأثر. نُبطِل الاثنين معاً حتى يبقى المتجر العام محدَّثاً أيضاً.
  const createProduct = trpc.firestore.createProduct.useMutation({
    onSuccess: () => { toast.success("تم إضافة المنتج بنجاح"); setShowProductDialog(false); resetProductForm(); utils.firestore.getAllProductsAdmin.invalidate(); utils.firestore.getProducts.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const updateProduct = trpc.firestore.updateProduct.useMutation({
    onSuccess: () => { toast.success("تم تحديث المنتج بنجاح"); setShowProductDialog(false); resetProductForm(); setIsEditingProduct(false); utils.firestore.getAllProductsAdmin.invalidate(); utils.firestore.getProducts.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const deleteProduct = trpc.firestore.deleteProduct.useMutation({
    onSuccess: () => { toast.success("تم حذف المنتج بنجاح"); utils.firestore.getAllProductsAdmin.invalidate(); utils.firestore.getProducts.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Category Mutations
  const createCategory = trpc.firestore.createCategory.useMutation({
    onSuccess: () => { toast.success("تم إضافة التصنيف بنجاح"); setShowCategoryDialog(false); resetCategoryForm(); utils.firestore.getCategories.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const updateCategory = trpc.firestore.updateCategory.useMutation({
    onSuccess: () => { toast.success("تم تحديث التصنيف بنجاح"); setShowCategoryDialog(false); resetCategoryForm(); setIsEditingCategory(false); utils.firestore.getCategories.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const deleteCategory = trpc.firestore.deleteCategory.useMutation({
    onSuccess: () => { toast.success("تم حذف التصنيف بنجاح"); utils.firestore.getCategories.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Banner Mutations
  const createBanner = trpc.firestore.createBanner.useMutation({
    onSuccess: () => { toast.success("تم إضافة البانر بنجاح"); setShowBannerDialog(false); resetBannerForm(); utils.firestore.getAllBannersAdmin.invalidate(); utils.firestore.getBanners.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const updateBanner = trpc.firestore.updateBanner.useMutation({
    onSuccess: () => { toast.success("تم تحديث البانر بنجاح"); setShowBannerDialog(false); resetBannerForm(); setIsEditingBanner(false); utils.firestore.getAllBannersAdmin.invalidate(); utils.firestore.getBanners.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const deleteBanner = trpc.firestore.deleteBanner.useMutation({
    onSuccess: () => { toast.success("تم حذف البانر بنجاح"); utils.firestore.getAllBannersAdmin.invalidate(); utils.firestore.getBanners.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Brand Mutations
  const createBrand = trpc.firestore.createBrand.useMutation({
    onSuccess: () => { toast.success("تم إضافة العلامة التجارية"); setShowBrandDialog(false); resetBrandForm(); utils.firestore.getBrands.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const updateBrand = trpc.firestore.updateBrand.useMutation({
    onSuccess: () => { toast.success("تم تحديث العلامة"); setShowBrandDialog(false); resetBrandForm(); setIsEditingBrand(false); utils.firestore.getBrands.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const deleteBrand = trpc.firestore.deleteBrand.useMutation({
    onSuccess: () => { toast.success("تم حذف العلامة"); utils.firestore.getBrands.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Coupon Mutations
  const createCoupon = trpc.firestore.createCoupon.useMutation({
    onSuccess: () => { toast.success("تم إضافة الكوبون"); setShowCouponDialog(false); resetCouponForm(); utils.firestore.getCoupons.invalidate(); },
    onError: (err) => toast.error(err.message || "تعذر إضافة الكوبون"),
  });
  const updateCoupon = trpc.firestore.updateCoupon.useMutation({
    onSuccess: () => { toast.success("تم تحديث الكوبون"); setShowCouponDialog(false); resetCouponForm(); setIsEditingCoupon(false); utils.firestore.getCoupons.invalidate(); },
    onError: (err) => toast.error(err.message || "تعذر تحديث الكوبون"),
  });
  const deleteCoupon = trpc.firestore.deleteCoupon.useMutation({
    onSuccess: () => { toast.success("تم حذف الكوبون"); utils.firestore.getCoupons.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Order Mutations
  const updateOrderStatus = trpc.firestore.updateOrderStatus.useMutation({
    onSuccess: () => { toast.success("تم تحديث حالة الطلب بنجاح"); setActiveOrderDialog(null); utils.firestore.getAllOrdersAdmin.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const deleteOrder = trpc.firestore.deleteOrder.useMutation({
    onSuccess: () => { toast.success("تم حذف الطلب بنجاح"); utils.firestore.getAllOrdersAdmin.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  // Settings Mutation
  const updateStoreSettings = trpc.firestore.updateStoreSettings.useMutation({
    onSuccess: () => { toast.success("تم حفظ الإعدادات بنجاح"); utils.firestore.getStoreSettings.invalidate(); },
    onError: (err) => toast.error(err.message || "حدث خطأ في حفظ الإعدادات"),
  });

  // Reset Forms
  const resetProductForm = () => setProductForm({
    id: "", name: "", description: "", basePrice: 0, price: 0, originalPrice: 0,
    categoryId: "", brandId: "", images: [], stock: 0,
    isFeatured: false, isOnSale: false, isBestSeller: false,
    discountType: 'percentage', discountValue: 0,
  });
  const resetCategoryForm = () => setCategoryForm({ id: "", name: "", description: "", image: "" });
  const resetBannerForm = () => setBannerForm({ id: "", title: "", description: "", image: "", cta: "تسوق الآن", link: "", order: 0, isActive: true });
  const resetBrandForm = () => setBrandForm({ id: "", name: "", logo: "", link: "" });

  // حساب السعر النهائي
  const calculateFinalPrice = (basePrice: number, isOnSale: boolean, discountType: 'percentage' | 'fixed', discountValue: number) => {
    if (!isOnSale || discountValue <= 0) return { price: basePrice, originalPrice: 0 };
    let finalPrice = basePrice;
    if (discountType === 'percentage') {
      finalPrice = basePrice * (1 - discountValue / 100);
    } else {
      finalPrice = basePrice - discountValue;
    }
    if (finalPrice < 0) finalPrice = 0;
    return { price: Math.round(finalPrice * 100) / 100, originalPrice: basePrice };
  };

  // Save Handlers
  const handleSaveProduct = () => {
    if (!productForm.name || !productForm.description || !productForm.categoryId || productForm.basePrice <= 0) {
      toast.error("يرجى ملء جميع الحقول المطلوبة"); return;
    }

    // حساب السعر النهائي
    const { price, originalPrice } = calculateFinalPrice(
      productForm.basePrice,
      productForm.isOnSale,
      productForm.discountType,
      productForm.discountValue
    );

    const data = {
      ...productForm,
      price,
      originalPrice,
    };

    if (isEditingProduct) {
      const { id, ...rest } = data;
      updateProduct.mutate({ id, ...rest });
    } else {
      const { id, ...rest } = data;
      createProduct.mutate(rest);
    }
  };

  const handleSaveCategory = () => {
    if (!categoryForm.name) { toast.error("يرجى إدخال اسم التصنيف"); return; }
    if (isEditingCategory) {
      const { id, ...data } = categoryForm;
      updateCategory.mutate({ id, ...data });
    } else {
      const { id, ...data } = categoryForm;
      createCategory.mutate(data);
    }
  };

  const handleSaveBanner = () => {
    if (!bannerForm.title) { toast.error("يرجى إدخال عنوان البانر"); return; }
    if (isEditingBanner) {
      const { id, ...data } = bannerForm;
      updateBanner.mutate({ id, ...data });
    } else {
      const { id, ...data } = bannerForm;
      createBanner.mutate(data);
    }
  };

  const handleSaveBrand = () => {
    if (!brandForm.name || !brandForm.logo) {
      toast.error("الاسم والشعار مطلوبان");
      return;
    }
    if (isEditingBrand) {
      const { id, ...data } = brandForm;
      updateBrand.mutate({ id, ...data });
    } else {
      const { id, ...data } = brandForm;
      createBrand.mutate(data);
    }
  };

  // Edit Handlers
  const handleEditProduct = (product: any) => {
    const basePrice = product.originalPrice || product.price;
    let isOnSale = false;
    let discountType: 'percentage' | 'fixed' = 'percentage';
    let discountValue = 0;
    if (product.originalPrice && product.originalPrice > product.price) {
      isOnSale = true;
      if (product.discountType) {
        discountType = product.discountType;
        discountValue = product.discountValue || 0;
      } else {
        const diff = product.originalPrice - product.price;
        discountValue = Math.round((diff / product.originalPrice) * 100);
        discountType = 'percentage';
      }
    }

    setProductForm({
      id: product.id,
      name: product.name,
      description: product.description,
      basePrice: basePrice,
      price: product.price,
      originalPrice: product.originalPrice || 0,
      categoryId: product.categoryId,
      brandId: product.brandId || "",
      images: product.images || [],
      stock: product.stock || 0,
      isFeatured: product.isFeatured || false,
      isOnSale: isOnSale,
      isBestSeller: product.isBestSeller || false,
      discountType: discountType,
      discountValue: discountValue,
    });
    setIsEditingProduct(true);
    setShowProductDialog(true);
  };

  const handleEditCategory = (category: any) => {
    setCategoryForm({ id: category.id, name: category.name, description: category.description || "", image: category.image || "" });
    setIsEditingCategory(true);
    setShowCategoryDialog(true);
  };

  const handleEditBanner = (banner: any) => {
    setBannerForm({
      id: banner.id,
      title: banner.title,
      description: banner.description || "",
      image: banner.image || "",
      cta: banner.cta || "تسوق الآن",
      link: banner.link || "",
      order: banner.order || 0,
      isActive: banner.isActive !== false
    });
    setIsEditingBanner(true);
    setShowBannerDialog(true);
  };

  const handleEditBrand = (brand: any) => {
    setBrandForm({ id: brand.id, name: brand.name, logo: brand.logo, link: brand.link || "" });
    setIsEditingBrand(true);
    setShowBrandDialog(true);
  };

  // Delete Handlers
  const handleDeleteProduct = (id: string, name: string) => {
    if (window.confirm(`هل أنت متأكد من حذف المنتج "${name}"؟`)) {
      deleteProduct.mutate({ id });
    }
  };

  const handleDeleteCategory = (id: string, name: string) => {
    if (window.confirm(`هل أنت متأكد من حذف التصنيف "${name}"؟`)) {
      deleteCategory.mutate({ id });
    }
  };

  const handleDeleteBanner = (id: string, title: string) => {
    if (window.confirm(`هل أنت متأكد من حذف البانر "${title}"؟`)) {
      deleteBanner.mutate({ id });
    }
  };

  const handleDeleteBrand = (id: string, name: string) => {
    if (window.confirm(`حذف العلامة "${name}"؟`)) deleteBrand.mutate({ id });
  };

  // Coupon Handlers
  const resetCouponForm = () => setCouponForm({
    code: "", discountType: "percentage", discountValue: 0,
    isActive: true, minOrderAmount: 0, usageLimit: 0, expiresAt: "",
  });

  const handleSaveCoupon = () => {
    if (!couponForm.code.trim() || !couponForm.discountValue) {
      toast.error("يرجى إدخال كود الخصم وقيمته"); return;
    }
    const payload = {
      code: couponForm.code, discountType: couponForm.discountType, discountValue: couponForm.discountValue,
      isActive: couponForm.isActive, minOrderAmount: couponForm.minOrderAmount, usageLimit: couponForm.usageLimit,
      expiresAt: couponForm.expiresAt || undefined,
    };
    if (isEditingCoupon) updateCoupon.mutate(payload);
    else createCoupon.mutate(payload);
  };

  const handleEditCoupon = (coupon: any) => {
    setCouponForm({
      code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue,
      isActive: coupon.isActive, minOrderAmount: coupon.minOrderAmount || 0, usageLimit: coupon.usageLimit || 0,
      expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt._seconds ? coupon.expiresAt._seconds * 1000 : coupon.expiresAt).toISOString().slice(0, 10) : "",
    });
    setIsEditingCoupon(true);
    setShowCouponDialog(true);
  };

  const handleDeleteCoupon = (code: string) => {
    if (window.confirm(`حذف الكوبون "${code}"؟`)) deleteCoupon.mutate({ code });
  };

  const handleToggleCouponActive = (coupon: any) => {
    updateCoupon.mutate({ code: coupon.code, isActive: !coupon.isActive });
  };

  const handleDeleteOrder = (id: string) => {
    if (window.confirm(`هل أنت متأكد من حذف الطلب؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      deleteOrder.mutate({ id });
    }
  };

  const handleSaveOrderStatus = (orderId: string, newStatus: string, newPaymentStatus: string) => {
    updateOrderStatus.mutate({ id: orderId, status: newStatus as any, paymentStatus: newPaymentStatus as any });
  };

  // Image Upload Handlers
  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingProductImage(true);
    const toastId = toast.loading("📤 جاري رفع الصور...");

    try {
      const filesArray = Array.from(files).slice(0, 5);
      const urls = await uploadMultipleImages(filesArray, "products", true);

      setProductForm((prev) => ({
        ...prev,
        images: [...prev.images, ...urls].slice(0, 10)
      }));

      toast.success(`✅ تم رفع ${urls.length} صورة بنجاح`, { id: toastId });
    } catch (error: any) {
      console.error("❌ خطأ في رفع الصور:", error);
      let errorMessage = "فشل رفع الصور. تأكد من اتصال الإنترنت وحجم الملف";
      if (error.message?.includes("مهلة")) {
        errorMessage = "انتهت المهلة. حاول مرة أخرى";
      } else if (error.message?.includes("حجم")) {
        errorMessage = "حجم الصورة كبير جداً. استخدم صوراً أقل من 10 ميجابايت";
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast.error(`❌ ${errorMessage}`, { id: toastId, duration: 5000 });
    } finally {
      setIsUploadingProductImage(false);
      if (productImageInputRef.current) {
        productImageInputRef.current.value = "";
      }
    }
  };

  const handleCategoryImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCategoryImage(true);
    const toastId = toast.loading("📤 جاري رفع صورة التصنيف...");

    try {
      const compressedFile = await compressImage(file, 800, 800, 0.7);
      const url = await uploadImageToStorage(compressedFile, "categories");
      setCategoryForm((prev) => ({ ...prev, image: url }));
      toast.success("✅ تم رفع صورة التصنيف بنجاح", { id: toastId });
    } catch (error: any) {
      console.error("❌ خطأ في رفع صورة التصنيف:", error);
      toast.error(`❌ ${error.message || "فشل رفع الصورة"}`, { id: toastId });
    } finally {
      setIsUploadingCategoryImage(false);
      if (categoryImageInputRef.current) {
        categoryImageInputRef.current.value = "";
      }
    }
  };

  const handleBannerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingBannerImage(true);
    const toastId = toast.loading("📤 جاري رفع صورة البانر...");

    try {
      const compressedFile = await compressImage(file, 1920, 600, 0.8);
      const url = await uploadImageToStorage(compressedFile, "banners");
      setBannerForm((prev) => ({ ...prev, image: url }));
      toast.success("✅ تم رفع صورة البانر بنجاح", { id: toastId });
    } catch (error: any) {
      console.error("❌ خطأ في رفع صورة البانر:", error);
      toast.error(`❌ ${error.message || "فشل رفع الصورة"}`, { id: toastId });
    } finally {
      setIsUploadingBannerImage(false);
      if (bannerImageInputRef.current) {
        bannerImageInputRef.current.value = "";
      }
    }
  };

  const handleBrandLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingBrandLogo(true);
    const toastId = toast.loading("📤 جاري رفع شعار العلامة...");

    try {
      const compressedFile = await compressImage(file, 300, 200, 0.7);
      const url = await uploadImageToStorage(compressedFile, "brands");
      setBrandForm((prev) => ({ ...prev, logo: url }));
      toast.success("✅ تم رفع الشعار بنجاح", { id: toastId });
    } catch (error: any) {
      console.error("❌ خطأ في رفع الشعار:", error);
      toast.error(`❌ ${error.message || "فشل رفع الشعار"}`, { id: toastId });
    } finally {
      setIsUploadingBrandLogo(false);
      if (brandLogoInputRef.current) {
        brandLogoInputRef.current.value = "";
      }
    }
  };

  const handleRemoveProductImage = async (index: number, imageUrl: string) => {
    try {
      await deleteImageFromStorage(imageUrl);
      setProductForm((prev) => ({
        ...prev,
        images: prev.images.filter((_, i) => i !== index)
      }));
      toast.success("🗑️ تم حذف الصورة");
    } catch (error) {
      toast.error("⚠️ فشل حذف الصورة من التخزين");
      setProductForm((prev) => ({
        ...prev,
        images: prev.images.filter((_, i) => i !== index)
      }));
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="container py-8 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin w-8 h-8" />
            <p className="text-muted-foreground">جاري التحميل...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="container py-8 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin w-8 h-8" />
            <p className="text-muted-foreground">جاري التحقق من الصلاحيات...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // ✅ إصلاح: user.role يبدأ بقيمة مبدئية "user" فور تسجيل الدخول (لتسريع
  // عرض بقية الموقع) ثم يُرفَع لـ"admin" بعد وصول رد السيرفر — لذلك ننتظر
  // هنا تحديداً "roleLoading" قبل الحكم بعدم التصريح، وإلا كان الأدمن
  // الحقيقي سيرى رسالة "غير مصرح" تومض للحظة قبل ظهور اللوحة الفعلية.
  if (roleLoading) {
    return (
      <Layout>
        <div className="container py-8 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin w-8 h-8" />
            <p className="text-muted-foreground">جاري التحقق من الصلاحيات...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (user?.role !== "admin") {
    return (
      <Layout>
        <div className="container py-8 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <h2 className="text-2xl font-bold text-foreground">غير مصرح</h2>
            <p className="text-muted-foreground text-center max-w-md">
              أنت لا تملك صلاحيات كافية للوصول إلى لوحة التحكم.
            </p>
            <Button variant="outline" onClick={() => logout()}>
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-8 flex flex-col md:flex-row gap-6">
        <AdminSidebar activeKey={sectionKey} user={user} />
        <div className="flex-1 min-w-0">
        <h1 className="text-3xl font-bold text-foreground mb-8">
          {ADMIN_SECTIONS.find((s) => s.key === sectionKey)?.label ?? "لوحة التحكم"}
        </h1>

        {sectionKey === "overview" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="إجمالي المبيعات"
            value={`${formatNumber(Number(stats?.totalRevenue ?? 0))} ج.س`}
            icon={DollarSign}
            iconColor="text-green-600"
          >
            <p className="text-xs text-muted-foreground">يشمل الطلبات المسلّمة فقط</p>
          </StatCard>

          <StatCard
            title="قيد المعالجة"
            value={formatNumber(stats?.pendingOrders ?? 0)}
            icon={Clock}
            iconColor="text-yellow-600"
          >
            <p className="text-xs text-muted-foreground">الطلبات المعلّقة والمدفوعة وخرجت للتوصيل</p>
          </StatCard>

          <StatCard
            title="الطلبات المكتملة"
            value={formatNumber(stats?.completedOrders ?? 0)}
            icon={CheckCircle}
            iconColor="text-emerald-600"
          >
            <p className="text-xs text-muted-foreground">الطلبات التي تم تسليمها بنجاح</p>
          </StatCard>

          <StatCard
            title="إجمالي الطلبات"
            value={formatNumber(stats?.totalOrders ?? 0)}
            icon={ShoppingBag}
            iconColor="text-blue-600"
          >
            <p className="text-xs text-muted-foreground">جميع الطلبات بجميع الحالات</p>
          </StatCard>

          <StatCard
            title="العملاء"
            value={formatNumber(stats?.totalCustomers ?? 0)}
            icon={Users}
            iconColor="text-purple-600"
          >
            <p className="text-xs text-muted-foreground">من Firebase Authentication</p>
          </StatCard>

          <StatCard
            title="المنتجات"
            value={formatNumber(stats?.totalProducts ?? 0)}
            icon={Package}
            iconColor="text-orange-600"
          >
            <p className="text-xs text-muted-foreground">إجمالي المنتجات في المتجر</p>
          </StatCard>

          <StatCard
            title="مخزون منخفض"
            value={formatNumber((stats?.lowStockProducts || []).length)}
            icon={AlertCircle}
            iconColor="text-red-600"
          >
            {(stats?.lowStockProducts || []).length > 0 ? (
              <div className="space-y-1">
                {(stats.lowStockProducts || []).slice(0, 5).map((p: any) => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span className="text-foreground truncate max-w-[120px]">{p.name}</span>
                    <span className="text-red-600 font-semibold">{p.stock}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground mt-1">الحد: {stats?.lowStockThreshold ?? 5} وحدة</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">لا توجد منتجات منخفضة المخزون</p>
            )}
          </StatCard>

          <StatCard
            title="الأكثر مبيعاً"
            value={(stats?.topProducts?.[0]?.name?.slice(0, 12)) || "—"}
            icon={TrendingUp}
            iconColor="text-pink-600"
          >
            {(stats?.topProducts || []).length > 0 ? (
              <div className="space-y-1">
                {(stats.topProducts || []).map((p: any, i: number) => (
                  <div key={p.productId} className="flex justify-between text-xs">
                    <span className="text-foreground truncate max-w-[120px]">{i + 1}. {p.name}</span>
                    <span className="text-pink-600 font-semibold">{p.quantity} وحدة</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">لا توجد بيانات مبيعات</p>
            )}
          </StatCard>
        </div>
        )}

        <Tabs value={sectionKey} className="w-full">
          {/* Products Tab */}
          <TabsContent value="products" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>إدارة المنتجات</CardTitle>
                <Dialog open={showProductDialog} onOpenChange={setShowProductDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetProductForm(); setIsEditingProduct(false); }} className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 ml-2" />منتج جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{isEditingProduct ? "تعديل المنتج" : "إضافة منتج جديد"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold">اسم المنتج *</label>
                        <Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-semibold">الوصف *</label>
                        <Input value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-semibold">السعر الأساسي (ج.س) *</label>
                          <Input type="number" value={productForm.basePrice} onChange={(e) => setProductForm({ ...productForm, basePrice: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">المخزون</label>
                          <Input type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-semibold">التصنيف *</label>
                          <Select value={productForm.categoryId} onValueChange={(value) => setProductForm({ ...productForm, categoryId: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {categories.map((cat: any) => (
                                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-semibold">العلامة التجارية</label>
                          <Select 
                            value={productForm.brandId || "none"} 
                            onValueChange={(value) => setProductForm({ ...productForm, brandId: value === "none" ? "" : value })}
                          >
                            <SelectTrigger><SelectValue placeholder="اختر العلامة" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">بدون علامة</SelectItem>
                              {brands.map((brand: any) => (
                                <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2 pt-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={productForm.isFeatured} onChange={(e) => setProductForm({ ...productForm, isFeatured: e.target.checked })} className="w-4 h-4" />
                            <span className="text-sm font-semibold">منتج مميز</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={productForm.isOnSale} onChange={(e) => setProductForm({ ...productForm, isOnSale: e.target.checked })} className="w-4 h-4" />
                            <span className="text-sm font-semibold">تفعيل الخصم</span>
                          </label>
                          {/* ✅ إصلاح: لم يكن هناك أي عنصر تحكم لهذا الحقل إطلاقاً، رغم أن
                              الصفحة الرئيسية والتطبيق يعتمدان عليه لقسم "الأكثر مبيعاً" —
                              كان القسم يظهر فارغاً دائماً لعدم وجود أي طريقة لضبط الحقل. */}
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={productForm.isBestSeller} onChange={(e) => setProductForm({ ...productForm, isBestSeller: e.target.checked })} className="w-4 h-4" />
                            <span className="text-sm font-semibold">الأكثر مبيعاً</span>
                          </label>
                        </div>
                      </div>
                      {productForm.isOnSale && (
                        <div className="border-t pt-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-sm font-semibold">نوع الخصم</label>
                              <Select value={productForm.discountType} onValueChange={(value: 'percentage' | 'fixed') => setProductForm({ ...productForm, discountType: value })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="percentage">نسبة مئوية (%)</SelectItem>
                                  <SelectItem value="fixed">مبلغ ثابت (ج.س)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="text-sm font-semibold">قيمة الخصم</label>
                              <Input type="number" min="0" value={productForm.discountValue} onChange={(e) => setProductForm({ ...productForm, discountValue: e.target.value === "" ? 0 : Number(e.target.value) })} />
                            </div>
                          </div>
                          {productForm.discountValue > 0 && (
                            <div className="mt-2 p-3 bg-muted rounded-lg">
                              <p className="text-sm">
                                <span className="font-semibold">السعر النهائي: </span>
                                <span className="text-primary font-bold">
                                  {calculateFinalPrice(productForm.basePrice, true, productForm.discountType, productForm.discountValue).price} ج.س
                                </span>
                                {productForm.discountType === 'percentage' && (
                                  <span className="text-xs text-muted-foreground mr-2">(خصم {productForm.discountValue}%)</span>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="border-t pt-4">
                        <label className="text-sm font-semibold block mb-2">صور المنتج</label>
                        <label className={`flex items-center justify-center w-full px-4 py-2 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${isUploadingProductImage ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className="flex items-center gap-2">
                            {isUploadingProductImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span className="text-sm">{isUploadingProductImage ? "جاري الرفع..." : "اختر صوراً (حد أقصى 5، ضغط تلقائي)"}</span>
                          </div>
                          <input ref={productImageInputRef} type="file" multiple accept="image/*" onChange={handleProductImageUpload} className="hidden" disabled={isUploadingProductImage} />
                        </label>
                        {productForm.images.length > 0 && (
                          <div className="space-y-2 mt-2">
                            {productForm.images.map((image, index) => (
                              <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                                <img src={image} alt={`Product ${index + 1}`} className="w-12 h-12 object-cover rounded" />
                                <span className="flex-1 text-sm truncate">صورة {index + 1}</span>
                                <Button variant="ghost" size="sm" onClick={() => handleRemoveProductImage(index, image)} className="text-destructive" disabled={isUploadingProductImage}>
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">💡 يتم ضغط الصور تلقائياً. الحجم الأقصى: 10 ميجابايت</p>
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveProduct} disabled={createProduct.isPending || updateProduct.isPending}>
                          {isEditingProduct ? "تحديث" : "إضافة"}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setShowProductDialog(false)}>إلغاء</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isProductsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : products.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الصورة</TableHead>
                          <TableHead>الاسم</TableHead>
                          <TableHead>السعر الأساسي</TableHead>
                          <TableHead>السعر النهائي</TableHead>
                          <TableHead>الخصم</TableHead>
                          <TableHead>المخزون</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((product: any) => {
                          const discountPercent = product.originalPrice && product.originalPrice > product.price
                            ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
                            : 0;
                          return (
                            <TableRow key={product.id}>
                              <TableCell>
                                {product?.images && product.images.length > 0 ? (
                                  <img src={product.images[0]} alt={product.name} className="w-12 h-12 object-cover rounded" />
                                ) : (
                                  <div className="w-12 h-12 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">بدون صورة</div>
                                )}
                              </TableCell>
                              <TableCell className="font-semibold">{product.name || "-"}</TableCell>
                              <TableCell>{formatNumber(product.originalPrice || product.price)} ج.س</TableCell>
                              <TableCell>{formatNumber(product.price)} ج.س</TableCell>
                              <TableCell>
                                {discountPercent > 0 ? (
                                  <span className="text-primary font-bold">-{discountPercent}%</span>
                                ) : "-"}
                              </TableCell>
                              <TableCell>
                                <span className={product.stock <= (stats?.lowStockThreshold ?? 5) ? "text-red-600 font-semibold" : ""}>
                                  {formatNumber(product.stock ?? 0)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {product.isFeatured && <span className="px-1 py-0.5 bg-purple-100 text-purple-800 text-[10px] rounded">مميز</span>}
                                  {product.isOnSale && <span className="px-1 py-0.5 bg-red-100 text-red-800 text-[10px] rounded">عرض</span>}
                                  {product.isBestSeller && <span className="px-1 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded">الأكثر مبيعاً</span>}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  <Button variant="ghost" size="sm" onClick={() => handleEditProduct(product)}><Edit2 className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteProduct(product.id, product.name)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">لا توجد منتجات</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle>إدارة الطلبات</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "all", label: "الكل" },
                      { value: "pending", label: "قيد الانتظار" },
                      { value: "paid", label: "تم الدفع" },
                      { value: "shipped", label: "خرج للتوصيل" },
                      { value: "delivered", label: "تم التسليم" },
                      { value: "cancelled", label: "ملغي" },
                    ].map((f) => (
                      <Button
                        key={f.value}
                        size="sm"
                        variant={orderStatusFilter === f.value ? "default" : "outline"}
                        onClick={() => setOrderStatusFilter(f.value)}
                        className="text-xs h-7 px-3"
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {hasNewOrders && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
                    <span className="font-medium text-primary">وصل طلب جديد</span>
                    <Button size="sm" onClick={refreshOrdersNow}>تحديث القائمة</Button>
                  </div>
                )}
                {isOrdersLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : allOrders.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>رقم الطلب</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>المبلغ</TableHead>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allOrders.map((order: any) => (
                          <TableRow key={order.id}>
                            <TableCell className="font-semibold">{order.orderNumber || "-"}</TableCell>
                            <TableCell><StatusBadge status={order.status} /></TableCell>
                            <TableCell>{formatNumber(order.total ?? 0)} ج.س</TableCell>
                            <TableCell>
                              {order.createdAt ? (
                                new Date(order.createdAt).toLocaleDateString('ar-EG', {
                                  year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory'
                                })
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Dialog open={activeOrderDialog?.id === order.id} onOpenChange={(open) => !open && setActiveOrderDialog(null)}>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setActiveOrderDialog({
                                        id: order.id,
                                        status: order.status || "pending",
                                        paymentStatus: order.paymentStatus || "unpaid",
                                        receipt: order.paymentReceipt,
                                      })}
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </Button>
                                  </DialogTrigger>
                                  {activeOrderDialog && activeOrderDialog.id === order.id && (
                                    <OrderStatusDialog
                                      orderId={order.id}
                                      currentStatus={activeOrderDialog.status}
                                      currentPaymentStatus={activeOrderDialog.paymentStatus}
                                      paymentReceipt={activeOrderDialog.receipt}
                                      onSave={(status, paymentStatus) => handleSaveOrderStatus(order.id, status, paymentStatus)}
                                      onClose={() => setActiveOrderDialog(null)}
                                    />
                                  )}
                                </Dialog>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteOrder(order.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {ordersCursor && (
                      <div className="flex justify-center pt-4">
                        <Button variant="outline" onClick={loadMoreOrders} disabled={isLoadingMoreOrders}>
                          {isLoadingMoreOrders ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
                          تحميل المزيد
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">لا توجد طلبات</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>إدارة التصنيفات</CardTitle>
                <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetCategoryForm(); setIsEditingCategory(false); }} className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 ml-2" />تصنيف جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{isEditingCategory ? "تعديل التصنيف" : "إضافة تصنيف جديد"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold">اسم التصنيف *</label>
                        <Input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-semibold">الوصف</label>
                        <Input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-semibold block mb-2">صورة التصنيف</label>
                        <label className={`flex items-center justify-center w-full px-4 py-2 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${isUploadingCategoryImage ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className="flex items-center gap-2">
                            {isUploadingCategoryImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span className="text-sm">{isUploadingCategoryImage ? "جاري الرفع..." : "اختر صورة"}</span>
                          </div>
                          <input ref={categoryImageInputRef} type="file" accept="image/*" onChange={handleCategoryImageUpload} className="hidden" disabled={isUploadingCategoryImage} />
                        </label>
                        {categoryForm.image && (
                          <div className="mt-2 relative">
                            <img src={categoryForm.image} alt="Category" className="w-full h-32 object-cover rounded" />
                            <Button variant="ghost" size="sm" className="absolute top-1 right-1 text-destructive bg-white/80" onClick={() => setCategoryForm((prev) => ({ ...prev, image: "" }))}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveCategory} disabled={createCategory.isPending || updateCategory.isPending}>
                          {isEditingCategory ? "تحديث" : "إضافة"}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setShowCategoryDialog(false)}>إلغاء</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isCategoriesLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : categories.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الصورة</TableHead>
                          <TableHead>الاسم</TableHead>
                          <TableHead>الوصف</TableHead>
                          <TableHead>الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categories.map((category: any) => (
                          <TableRow key={category.id}>
                            <TableCell>
                              {category.image ? (
                                <img src={category.image} alt={category.name} className="w-12 h-12 object-cover rounded" />
                              ) : (
                                <div className="w-12 h-12 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">بدون صورة</div>
                              )}
                            </TableCell>
                            <TableCell className="font-semibold">{category.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{category.description || "-"}</TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Button variant="ghost" size="sm" onClick={() => handleEditCategory(category)}><Edit2 className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteCategory(category.id, category.name)}><Trash2 className="w-4 h-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">لا توجد تصنيفات</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Banners Tab */}
          <TabsContent value="banners" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>إدارة بانرات الصفحة الرئيسية</CardTitle>
                <Dialog open={showBannerDialog} onOpenChange={setShowBannerDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetBannerForm(); setIsEditingBanner(false); }} className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 ml-2" />بانر جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>{isEditingBanner ? "تعديل البانر" : "إضافة بانر جديد"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold">العنوان *</label>
                        <Input value={bannerForm.title} onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })} placeholder="مثال: أحدث المنتجات" />
                      </div>
                      <div>
                        <label className="text-sm font-semibold">الوصف</label>
                        <Textarea value={bannerForm.description} onChange={(e) => setBannerForm({ ...bannerForm, description: e.target.value })} placeholder="وصف قصير للبانر" rows={3} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-semibold">نص الزر</label>
                          <Input value={bannerForm.cta} onChange={(e) => setBannerForm({ ...bannerForm, cta: e.target.value })} placeholder="تسوق الآن" />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">الترتيب</label>
                          <Input type="number" value={bannerForm.order} onChange={(e) => setBannerForm({ ...bannerForm, order: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-semibold">الرابط عند الضغط (اختياري)</label>
                        <Input
                          value={bannerForm.link}
                          onChange={(e) => setBannerForm({ ...bannerForm, link: e.target.value })}
                          placeholder="مثال: /product/xxxxx أو /category/xxxxx أو https://..."
                          dir="ltr"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          اتركه فارغاً ليذهب البانر لصفحة كل المنتجات كالسابق. لفتح منتج أو تصنيف
                          محدد استخدم مسار داخلي يبدأ بـ "/" (مثل /product/ID)، أو رابطاً خارجياً كاملاً (https://...).
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-semibold block mb-2">صورة البانر</label>
                        <label className={`flex items-center justify-center w-full px-4 py-2 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${isUploadingBannerImage ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className="flex items-center gap-2">
                            {isUploadingBannerImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                            <span className="text-sm">{isUploadingBannerImage ? "جاري الرفع..." : "اختر صورة البانر"}</span>
                          </div>
                          <input ref={bannerImageInputRef} type="file" accept="image/*" onChange={handleBannerImageUpload} className="hidden" disabled={isUploadingBannerImage} />
                        </label>
                        {bannerForm.image && (
                          <div className="mt-2 relative">
                            <img src={bannerForm.image} alt="Banner" className="w-full h-32 object-cover rounded" />
                            <Button variant="ghost" size="sm" className="absolute top-1 right-1 text-destructive bg-white/80" onClick={() => setBannerForm((prev) => ({ ...prev, image: "" }))}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="bannerActive" checked={bannerForm.isActive} onChange={(e) => setBannerForm({ ...bannerForm, isActive: e.target.checked })} className="w-4 h-4" />
                        <label htmlFor="bannerActive" className="text-sm font-semibold cursor-pointer">مفعّل</label>
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveBanner} disabled={createBanner.isPending || updateBanner.isPending}>
                          {isEditingBanner ? "تحديث" : "إضافة"}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setShowBannerDialog(false)}>إلغاء</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isBannersLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : banners.length > 0 ? (
                  <div className="space-y-4">
                    {banners.map((banner: any) => (
                      <div key={banner.id} className="flex gap-4 p-4 border border-border rounded-lg items-center">
                        {banner.image ? (
                          <img src={banner.image} alt={banner.title} className="w-24 h-16 object-cover rounded flex-shrink-0" />
                        ) : (
                          <div className="w-24 h-16 bg-muted rounded flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground truncate">{banner.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{banner.description}</p>
                          <div className="flex gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">ترتيب: {banner.order}</span>
                            <span className={`text-xs font-semibold ${banner.isActive ? "text-green-600" : "text-red-500"}`}>
                              {banner.isActive ? "● مفعّل" : "○ معطّل"}
                            </span>
                            {banner.link && (
                              <span className="text-xs text-muted-foreground truncate" dir="ltr">↳ {banner.link}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => handleEditBanner(banner)}><Edit2 className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteBanner(banner.id, banner.title)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p>لا توجد بانرات. أضف بانراً جديداً للصفحة الرئيسية.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Brands Tab */}
          <TabsContent value="brands" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>إدارة العلامات التجارية</CardTitle>
                <Dialog open={showBrandDialog} onOpenChange={setShowBrandDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetBrandForm(); setIsEditingBrand(false); }} className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 ml-2" />علامة جديدة
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{isEditingBrand ? "تعديل العلامة" : "إضافة علامة تجارية"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold">اسم العلامة *</label>
                        <Input value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-semibold">رابط (اختياري)</label>
                        <Input value={brandForm.link} onChange={(e) => setBrandForm({ ...brandForm, link: e.target.value })} placeholder="https://..." />
                      </div>
                      <div>
                        <label className="text-sm font-semibold block mb-2">شعار العلامة *</label>
                        <label className={`flex items-center justify-center w-full px-4 py-2 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${isUploadingBrandLogo ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className="flex items-center gap-2">
                            {isUploadingBrandLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span className="text-sm">{isUploadingBrandLogo ? "جاري الرفع..." : "اختر شعار"}</span>
                          </div>
                          <input ref={brandLogoInputRef} type="file" accept="image/*" onChange={handleBrandLogoUpload} className="hidden" disabled={isUploadingBrandLogo} />
                        </label>
                        {brandForm.logo && (
                          <div className="mt-2 relative">
                            <img src={brandForm.logo} alt={brandForm.name} className="w-32 h-20 object-contain border rounded" />
                            <Button variant="ghost" size="sm" className="absolute top-1 right-1 text-destructive bg-white/80" onClick={() => setBrandForm(prev => ({ ...prev, logo: "" }))}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveBrand} disabled={createBrand.isPending || updateBrand.isPending}>
                          {isEditingBrand ? "تحديث" : "إضافة"}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setShowBrandDialog(false)}>إلغاء</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isBrandsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : brands.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {brands.map((brand: any) => (
                      <div key={brand.id} className="border border-border rounded-lg p-4 flex flex-col items-center">
                        <img src={brand.logo} alt={brand.name} className="w-24 h-16 object-contain mb-2" />
                        <p className="font-semibold text-center text-sm">{brand.name}</p>
                        {brand.link && (
                          <a href={brand.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-1">
                            رابط
                          </a>
                        )}
                        <div className="flex gap-2 mt-2">
                          <Button variant="ghost" size="sm" onClick={() => handleEditBrand(brand)}><Edit2 className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteBrand(brand.id, brand.name)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Star className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p>لا توجد علامات تجارية. أضف علامة جديدة لتظهر في الصفحة الرئيسية.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Coupons Tab */}
          <TabsContent value="coupons" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle>إدارة كوبونات الخصم</CardTitle>
                <Dialog open={showCouponDialog} onOpenChange={setShowCouponDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { resetCouponForm(); setIsEditingCoupon(false); }} className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 ml-2" />كوبون جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{isEditingCoupon ? "تعديل الكوبون" : "إضافة كوبون خصم"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold">كود الخصم *</label>
                        <Input
                          value={couponForm.code}
                          onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                          placeholder="مثال: SAVE10"
                          disabled={isEditingCoupon}
                          dir="ltr"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-semibold">نوع الخصم</label>
                          <Select
                            value={couponForm.discountType}
                            onValueChange={(v) => setCouponForm({ ...couponForm, discountType: v as "percentage" | "fixed" })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percentage">نسبة مئوية %</SelectItem>
                              <SelectItem value="fixed">مبلغ ثابت ج.س</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-semibold">
                            {couponForm.discountType === "percentage" ? "النسبة %" : "المبلغ ج.س"}
                          </label>
                          <Input
                            type="number"
                            value={couponForm.discountValue || ""}
                            onChange={(e) => setCouponForm({ ...couponForm, discountValue: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-semibold">حد أدنى للطلب (اختياري)</label>
                          <Input
                            type="number"
                            value={couponForm.minOrderAmount || ""}
                            onChange={(e) => setCouponForm({ ...couponForm, minOrderAmount: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">حد الاستخدام (0 = غير محدود)</label>
                          <Input
                            type="number"
                            value={couponForm.usageLimit || ""}
                            onChange={(e) => setCouponForm({ ...couponForm, usageLimit: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-semibold">تاريخ الانتهاء (اختياري)</label>
                        <Input
                          type="date"
                          value={couponForm.expiresAt}
                          onChange={(e) => setCouponForm({ ...couponForm, expiresAt: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between border border-border rounded-lg p-3">
                        <label className="text-sm font-semibold">مُفعّل</label>
                        <Switch
                          checked={couponForm.isActive}
                          onCheckedChange={(v) => setCouponForm({ ...couponForm, isActive: v })}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveCoupon} disabled={createCoupon.isPending || updateCoupon.isPending}>
                          {isEditingCoupon ? "تحديث" : "إضافة"}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => setShowCouponDialog(false)}>إلغاء</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isCouponsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                ) : coupons.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الكود</TableHead>
                        <TableHead>الخصم</TableHead>
                        <TableHead>الاستخدام</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coupons.map((coupon: any) => (
                        <TableRow key={coupon.id}>
                          <TableCell className="font-bold" dir="ltr">{coupon.code}</TableCell>
                          <TableCell>
                            {coupon.discountType === "percentage" ? `${coupon.discountValue}%` : `${formatNumber(coupon.discountValue)} ج.س`}
                          </TableCell>
                          <TableCell>
                            {coupon.usageCount || 0}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}
                          </TableCell>
                          <TableCell>
                            <Switch checked={coupon.isActive} onCheckedChange={() => handleToggleCouponActive(coupon)} />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="sm" onClick={() => handleEditCoupon(coupon)}><Edit2 className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteCoupon(coupon.code)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Tag className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p>لا توجد كوبونات خصم بعد. أضف كوبوناً جديداً.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-6">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" /> بيانات المتجر</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold">اسم المتجر</label>
                      <Input value={settingsForm.storeName} onChange={(e) => setSettingsForm({ ...settingsForm, storeName: e.target.value })} placeholder="اسم متجرك" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">رقم الهاتف</label>
                      <Input value={settingsForm.phone} onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })} placeholder="+249..." dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">البريد الإلكتروني</label>
                      <Input type="email" value={settingsForm.email} onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })} placeholder="info@store.com" dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">العنوان</label>
                      <Input value={settingsForm.address} onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })} placeholder="المدينة، الدولة" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold">وصف المتجر</label>
                    <Textarea value={settingsForm.storeDescription} onChange={(e) => setSettingsForm({ ...settingsForm, storeDescription: e.target.value })} placeholder="وصف قصير عن متجرك" rows={2} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold">رؤية المتجر</label>
                      <Textarea value={settingsForm.storeVision} onChange={(e) => setSettingsForm({ ...settingsForm, storeVision: e.target.value })} placeholder="رؤية المتجر..." rows={3} />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">مهمة المتجر</label>
                      <Textarea value={settingsForm.storeMission} onChange={(e) => setSettingsForm({ ...settingsForm, storeMission: e.target.value })} placeholder="مهمة المتجر..." rows={3} />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold">رابط صورة "حول المتجر"</label>
                    <Input value={settingsForm.storeAboutImage} onChange={(e) => setSettingsForm({ ...settingsForm, storeAboutImage: e.target.value })} placeholder="https://..." dir="ltr" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> إعدادات الشحن</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold">تكلفة الشحن (ج.س)</label>
                      <Input type="number" value={settingsForm.shippingCost} onChange={(e) => setSettingsForm({ ...settingsForm, shippingCost: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">حد الشحن المجاني (ج.س)</label>
                      <Input type="number" value={settingsForm.freeShippingThreshold} onChange={(e) => setSettingsForm({ ...settingsForm, freeShippingThreshold: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} />
                      <p className="text-xs text-muted-foreground mt-1">الطلبات التي تتجاوز هذا المبلغ تحصل على شحن مجاني</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5" /> بيانات الحساب البنكي</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-semibold">اسم البنك</label>
                      <Input value={settingsForm.bankName} onChange={(e) => setSettingsForm({ ...settingsForm, bankName: e.target.value })} placeholder="بنك الخرطوم" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">اسم صاحب الحساب</label>
                      <Input value={settingsForm.bankAccountName} onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountName: e.target.value })} placeholder="اسم الشركة أو الشخص" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">رقم الحساب</label>
                      <Input value={settingsForm.bankAccountNumber} onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountNumber: e.target.value })} placeholder="1234567890" dir="ltr" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> روابط التواصل الاجتماعي</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold">واتساب (رقم الهاتف)</label>
                      <Input value={settingsForm.whatsapp} onChange={(e) => setSettingsForm({ ...settingsForm, whatsapp: e.target.value })} placeholder="+249123456789" dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">فيسبوك (رابط الصفحة)</label>
                      <Input value={settingsForm.facebook} onChange={(e) => setSettingsForm({ ...settingsForm, facebook: e.target.value })} placeholder="https://facebook.com/..." dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">إنستغرام (رابط الحساب)</label>
                      <Input value={settingsForm.instagram} onChange={(e) => setSettingsForm({ ...settingsForm, instagram: e.target.value })} placeholder="https://instagram.com/..." dir="ltr" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold">تويتر / X (رابط الحساب)</label>
                      <Input value={settingsForm.twitter} onChange={(e) => setSettingsForm({ ...settingsForm, twitter: e.target.value })} placeholder="https://x.com/..." dir="ltr" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Star className="w-5 h-5" /> مميزات المتجر (الصفحة الرئيسية)</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2 border p-3 rounded-lg">
                      <h4 className="font-bold text-primary">الميزة 1</h4>
                      <Input value={settingsForm.feature1Title} onChange={(e) => setSettingsForm({ ...settingsForm, feature1Title: e.target.value })} placeholder="العنوان (مثلاً: شحن سريع)" />
                      <Input value={settingsForm.feature1Desc} onChange={(e) => setSettingsForm({ ...settingsForm, feature1Desc: e.target.value })} placeholder="الوصف" />
                    </div>
                    <div className="space-y-2 border p-3 rounded-lg">
                      <h4 className="font-bold text-primary">الميزة 2</h4>
                      <Input value={settingsForm.feature2Title} onChange={(e) => setSettingsForm({ ...settingsForm, feature2Title: e.target.value })} placeholder="العنوان (مثلاً: شراء آمن)" />
                      <Input value={settingsForm.feature2Desc} onChange={(e) => setSettingsForm({ ...settingsForm, feature2Desc: e.target.value })} placeholder="الوصف" />
                    </div>
                    <div className="space-y-2 border p-3 rounded-lg">
                      <h4 className="font-bold text-primary">الميزة 3</h4>
                      <Input value={settingsForm.feature3Title} onChange={(e) => setSettingsForm({ ...settingsForm, feature3Title: e.target.value })} placeholder="العنوان (مثلاً: خدمة 24/7)" />
                      <Input value={settingsForm.feature3Desc} onChange={(e) => setSettingsForm({ ...settingsForm, feature3Desc: e.target.value })} placeholder="الوصف" />
                    </div>
                    <div className="space-y-2 border p-3 rounded-lg">
                      <h4 className="font-bold text-primary">الميزة 4</h4>
                      <Input value={settingsForm.feature4Title} onChange={(e) => setSettingsForm({ ...settingsForm, feature4Title: e.target.value })} placeholder="العنوان (مثلاً: جودة عالية)" />
                      <Input value={settingsForm.feature4Desc} onChange={(e) => setSettingsForm({ ...settingsForm, feature4Desc: e.target.value })} placeholder="الوصف" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Package className="w-5 h-5" /> إعدادات المخزون</CardTitle></CardHeader>
                <CardContent>
                  <div className="max-w-xs">
                    <label className="text-sm font-semibold">حد المخزون المنخفض</label>
                    <Input type="number" value={settingsForm.lowStockThreshold} onChange={(e) => setSettingsForm({ ...settingsForm, lowStockThreshold: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.value === "0" && (e.target.value = "")} min={1} />
                    <p className="text-xs text-muted-foreground mt-1">المنتجات التي يساوي مخزونها هذا الرقم أو أقل تُعتبر منخفضة المخزون</p>
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full md:w-auto"
                onClick={() => updateStoreSettings.mutate(settingsForm)}
                disabled={updateStoreSettings.isPending}
              >
                {updateStoreSettings.isPending ? (
                  <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري الحفظ...</>
                ) : "حفظ جميع الإعدادات"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        </div>
      </div>
    </Layout>
  );
}