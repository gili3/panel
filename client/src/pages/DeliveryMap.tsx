// ELEVEN STORE — لوحة التحكم: خريطة التوصيل (صفحة مستقلة للموصلين)
// ─────────────────────────────────────────────────────────────────────────
// ✅ إعادة تنظيم (بند 7 من مراجعة صفحة الطلبات): كانت هذه الخريطة مدمجة
// كتبويب ثانٍ داخل صفحة "مناطق التوصيل" (DeliveryZones.tsx) — إدارية بطبعها
// وتخص الأدمن المسؤول عن رسم مناطق التوصيل، وليست الشاشة التي يفتحها موصّل
// أثناء التوصيل الفعلي. الآن صفحة مستقلة بمسارها الخاص (/delivery-map)،
// مخصصة فعلياً للموصلين: خريطة الطلبات النشطة فقط + Clustering حقيقي +
// بحث برقم الطلب + فلترة بالحالة + فتح تفاصيل الطلب من الدبوس مباشرة —
// بلا أي أدوات تحرير مضلّعات لا يحتاجها الموصّل.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, MapPin, ShieldAlert, Search, ArrowRight, X } from "lucide-react";
import { formatNumber } from "@/lib/formatters";
import { getOrderStatusConfig, ORDER_STATUS_OPTIONS } from "@/lib/orderStatus";
import { ORDER_STATUS_COLORS } from "@/lib/colors";
import { KHARTOUM_CENTER, TILE_URL, TILE_ATTRIBUTION } from "@/lib/mapConstants";

// window.L محمَّل عبر <script> عادي بـindex.html (Leaflet + Leaflet.markercluster) —
// لا يوجد نوع TS رسمي مثبَّت هنا (@types/leaflet)، لذا `any` مقصودة.
declare const L: any;

// ✅ إعادة تنظيم: الحالات "النشطة" (قبل التسليم/الإلغاء/فشل الدفع) التي
// يتابعها الموصّل فعلياً على الخريطة — ألوانها/تسمياتها من نفس مصدر
// الحقيقة الموحّد (lib/orderStatus.ts) بدل تعريف محلي مكرَّر هنا.
const ALL_STATUSES = ["under_review", "processing", "out_for_delivery"] as const;
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  ALL_STATUSES.map((s) => [s, ORDER_STATUS_COLORS[s].bg])
);
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  ALL_STATUSES.map((s) => [s, getOrderStatusConfig(s).label])
);
type ActiveOrderLocation = {
  orderId: string; orderNumber: string; status: string; total: number;
  customerName: string; phone: string; city: string; lat: number; lng: number;
  createdAt: string | null;
};

// ✅ جديد: طلب "متأخر" — لا يزال بحالة نشطة بعد مرور أكثر من الحد الزمني
// المعقول لكل مرحلة. يساعد الموصّل/الأدمن على اكتشاف الطلبات المهملة أو
// المنسية بنظرة واحدة على الخريطة بدل فتح كل طلب على حدة للتأكد.
const STALE_THRESHOLD_MINUTES: Record<string, number> = {
  under_review: 30,      // بانتظار مراجعة الأدمن لأكثر من نصف ساعة
  processing: 60,        // قيد التجهيز لأكثر من ساعة
  out_for_delivery: 90,  // قيد التوصيل لأكثر من ساعة ونصف
};

function getElapsedMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `منذ ${hours} س ${rest} د` : `منذ ${hours} س`;
}

function isStale(status: string, minutes: number | null): boolean {
  if (minutes === null) return false;
  const threshold = STALE_THRESHOLD_MINUTES[status];
  return threshold !== undefined && minutes >= threshold;
}

// ✅ إحداثية صالحة فعلياً: رقمان محدودان، ضمن مدى خطوط الطول/العرض،
// وليسا (0,0) — نقطة شائعة لموقع غير محدَّد بدل قيمة مفقودة. السيرفر
// يستبعد null/(0,0) مسبقاً، وهذا فلتر دفاعي إضافي على العميل.
function hasValidCoords(o: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(o.lat) && Number.isFinite(o.lng) &&
    o.lat >= -90 && o.lat <= 90 && o.lng >= -180 && o.lng <= 180 &&
    !(o.lat === 0 && o.lng === 0)
  );
}

// نفس شارة حالة الطلب المستخدمة بصفحة "الطلبات" (AdminDashboard.tsx) —
// مصدر الألوان/التسميات موحّد عبر lib/orderStatus.ts.
function StatusBadge({ status }: { status: string }) {
  const { label, style } = getOrderStatusConfig(status);
  return <span style={style} className="px-2 py-1 rounded text-xs font-semibold">{label}</span>;
}

// ✅ إصلاح جذري: كانت هذه لوحة "Sheet" (مكوّن Radix يُركَّب عبر Portal في
// document.body مع طبقة تعتيم كاملة للشاشة) — بصرياً تبدو كنافذة منبثقة
// منفصلة عن الخريطة، وتحجب كل الصفحة خلفها. الآن لوحة "مدمجة" فعلياً داخل
// نفس حاوية الخريطة (position: absolute نسبةً لها، لا Portal ولا تعتيم
// كامل للشاشة) — الخريطة تبقى ظاهرة جزئياً خلفها، وتبان كجزء من نفس شاشة
// الخريطة بدل نافذة منفصلة تعلوها.
function OrderDetailsPanel({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: order, isLoading, error } = trpc.deliveryZones.getOrderDetailsAdmin.useQuery(
    { id: orderId ?? "" },
    { enabled: !!orderId }
  );
  const [status, setStatus] = useState("under_review");

  useEffect(() => {
    if (order) {
      setStatus(order.status);
    }
  }, [order]);

  const updateStatus = trpc.firestore.updateOrderStatus.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث حالة الطلب بنجاح");
      utils.deliveryZones.getOrderDetailsAdmin.invalidate({ id: orderId ?? "" });
      utils.deliveryZones.getActiveOrderLocations.invalidate();
    },
    onError: (e) => toast.error(e.message || "تعذّر تحديث حالة الطلب"),
  });

  const addr = order?.shippingAddress;
  const hasLocation = !!(addr?.latitude && addr?.longitude);
  const open = !!orderId;

  return (
    <div
      // ✅ pointer-events-none وهي مغلقة: لا تحجب أي نقر على الخريطة خلفها
      // رغم بقائها موجودة بالـDOM لإتاحة انتقال الانزلاق سلساً.
      className={`absolute inset-y-0 left-0 z-[1000] w-full sm:w-96 bg-card border-l shadow-2xl
        transition-transform duration-300 ease-out flex flex-col
        ${open ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
        <h2 className="font-semibold text-sm">
          {order ? `تفاصيل الطلب #${order.orderNumber}` : "تفاصيل الطلب"}
        </h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!open ? null : isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : error || !order ? (
          <p className="text-sm text-muted-foreground py-6 text-center">تعذّر تحميل تفاصيل هذا الطلب.</p>
        ) : (
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge status={order.status} />
              </div>
              <span className="text-sm text-muted-foreground">
                {order.createdAt
                  ? new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory' })
                  : "-"}
                {(() => {
                  const mins = getElapsedMinutes(order.createdAt ?? null);
                  if (mins === null) return null;
                  return (
                    <span className={isStale(order.status, mins) ? "text-destructive font-semibold" : ""}>
                      {" · "}{formatElapsed(mins)}
                    </span>
                  );
                })()}
              </span>
            </div>

            {addr && (addr.address || addr.city) && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" /> عنوان التوصيل</p>
                <p>{addr.fullName || addr.name || "-"} — {addr.phone || "-"}</p>
                <p className="text-muted-foreground">{addr.city}{addr.city && addr.address ? " — " : ""}{addr.address}</p>
                {hasLocation && (
                  <a
                    href={`https://www.google.com/maps?q=${addr.latitude},${addr.longitude}`}
                    target="_blank" rel="noreferrer"
                    className="text-primary hover:underline text-sm flex items-center gap-1 pt-1"
                  >
                    <MapPin className="w-3.5 h-3.5" /> فتح الموقع في خرائط جوجل
                  </a>
                )}
              </div>
            )}

            {/* عناصر الطلب — صورة + اسم + كمية + سعر الوحدة + الإجمالي، من order.items */}
            <div className="rounded-lg border divide-y">
              {(order.items ?? []).map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-9 h-9 rounded object-cover shrink-0 bg-muted" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-muted shrink-0" />
                  )}
                  <span className="flex-1 truncate">{item.name} × {item.quantity}</span>
                  <span className="text-muted-foreground whitespace-nowrap">{formatNumber(item.price * item.quantity)} ج.س</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                <span>الإجمالي</span>
                <span>{formatNumber(order.total ?? 0)} ج.س</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold">حالة الطلب</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: order.id, status: status as any })}
            >
              {updateStatus.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ التحديث"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function OrdersClusterMap({ canViewOrders }: { canViewOrders: boolean }) {
  // ✅ تحديث دوري كل 30 ثانية — خريطة مفتوحة طوال وقت التوصيل تعكس طلبات
  // جديدة/متغيّرة الحالة بلا حاجة لتحديث الصفحة يدوياً.
  const { data: locations, isLoading, isFetching, error, dataUpdatedAt, refetch } =
    trpc.deliveryZones.getActiveOrderLocations.useQuery(undefined, {
      refetchInterval: 30_000,
      enabled: canViewOrders,
    });
  const { data: zones } = trpc.deliveryZones.getZones.useQuery(undefined, { enabled: canViewOrders });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const zonesLayerRef = useRef<any>(null);
  const markersByIdRef = useRef<Map<string, any>>(new Map());
  // ✅ إصلاح: تُستخدم لتفادي إعادة توسيط/تكبير الخريطة تلقائياً عند كل
  // تحديث دوري للبيانات (كل 30 ثانية) — كان هذا يقطع على الموصّل تكبيره
  // أو تحريكه اليدوي للخريطة أثناء تنقّله الفعلي بالشارع. الآن التوسيط
  // التلقائي يحدث فقط أول مرة تُحمَّل فيها البيانات أو عند تغيير الفلتر
  // صراحة، وإلا فبإمكان الموصّل الضغط على زر "توسيط الخريطة" يدوياً.
  const hasFittedRef = useRef(false);
  const lastFilterKeyRef = useRef<string>("");

  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [search, setSearch] = useState("");
  const [searchNotFound, setSearchNotFound] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  // ── إنشاء الخريطة + مجموعة الـClustering مرة واحدة فقط ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(containerRef.current).setView(KHARTOUM_CENTER, 11);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    // ✅ Clustering حقيقي بدل رسم كل الدبابيس منفردة — يجمّع الدبابيس
    // المتقاربة (بحسب مستوى التكبير) ويعرض عدد الطلبات داخل كل مجموعة،
    // مع chunkedLoading للحفاظ على الأداء حتى مع أعداد كبيرة من الطلبات.
    const cluster = typeof L.markerClusterGroup === "function"
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 60, chunkedLoading: true, spiderfyOnMaxZoom: true })
      : L.layerGroup(); // fallback نادر إن فشل تحميل سكربت الـCDN
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // ── طبقة مضلّعات مناطق التوصيل (مرجعية فقط) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined") return;
    zonesLayerRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    (zones ?? []).forEach(z => {
      if (z.polygon.length >= 3) {
        L.polygon(z.polygon.map(p => [p.lat, p.lng]), {
          color: z.isActive ? "#16a34a" : "#9ca3af", weight: 1, dashArray: "4 4", fillOpacity: 0.04,
        }).bindTooltip(z.name).addTo(group);
      }
    });
    zonesLayerRef.current = group;
  }, [zones]);

  // إحداثيات صالحة فقط (دفاعي، بجانب استبعاد السيرفر لـnull/(0,0))
  const validLocations = useMemo<ActiveOrderLocation[]>(
    () => (locations ?? []).filter(hasValidCoords),
    [locations]
  );

  // تطبيق فلتر الحالة
  const filteredLocations = useMemo(
    () => validLocations.filter(o => statusFilter.has(o.status)),
    [validLocations, statusFilter]
  );

  // ── إعادة بناء الدبابيس عند تغيّر الفلتر/البيانات ──────────────────
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    cluster.clearLayers();
    const nextMarkers = new Map<string, any>();
    const leafletMarkers: any[] = [];

    filteredLocations.forEach(o => {
      const color = STATUS_COLOR[o.status] ?? "#dc2626";
      const mins = getElapsedMinutes(o.createdAt);
      const stale = isStale(o.status, mins);
      // ✅ الطلبات "المتأخرة" (تجاوزت المدة المعقولة لحالتها) تُميَّز بحلقة
      // حمراء نابضة حول الدبوس — تُلاحَظ من نظرة سريعة بلا حاجة لفتح كل
      // طلب على حدة للتحقق من مدة بقائه بنفس الحالة.
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:16px;height:16px;">
          ${stale ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #dc2626;animation:pulse-stale 1.5s ease-out infinite;"></div>` : ""}
          <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>
        </div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([o.lat, o.lng], { icon });
      // ✅ Tooltip عند التحويم/اللمس تُظهر رقم الطلب والعميل والمدة المنقضية
      // بلا حاجة لفتح تفاصيل الطلب الكاملة لمجرد التعرّف عليه على الخريطة.
      const tooltipParts = [
        `#${o.orderNumber}`,
        o.customerName || null,
        mins !== null ? formatElapsed(mins) + (stale ? " ⚠️ متأخر" : "") : null,
      ].filter((part): part is string => Boolean(part));
      marker.bindTooltip(tooltipParts.join(" — "), { direction: "top", offset: [0, -8] });
      // ✅ الضغط على الدبوس يفتح تفاصيل الطلب مباشرة (لوحة جانبية) بدل
      // نافذة Popup ثابتة — يشمل عناصر الطلب وإمكانية تحديث الحالة فوراً.
      marker.on("click", () => setSelectedOrderId(o.orderId));
      leafletMarkers.push(marker);
      nextMarkers.set(o.orderId, marker);
    });

    if (typeof cluster.addLayers === "function") cluster.addLayers(leafletMarkers);
    else leafletMarkers.forEach(m => cluster.addLayer(m));
    markersByIdRef.current = nextMarkers;

    // ✅ إصلاح: التوسيط التلقائي (fitBounds) يحدث فقط أول مرة تصل فيها
    // بيانات فعلية، أو عند تغيّر فلتر الحالة صراحة — وليس عند كل تحديث
    // دوري (كل 30 ثانية) الذي قد يحرّك الخريطة من تحت يد الموصّل بلا داعٍ
    // بينما يتنقّل فعلياً بالشارع. التحديث الدوري الآن يُحدّث الدبابيس فقط.
    const filterKey = Array.from(statusFilter).sort().join(",");
    const filterChanged = filterKey !== lastFilterKeyRef.current;
    lastFilterKeyRef.current = filterKey;
    if (filteredLocations.length > 0 && (!hasFittedRef.current || filterChanged)) {
      const bounds = L.latLngBounds(filteredLocations.map(o => [o.lat, o.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      hasFittedRef.current = true;
    }
  }, [filteredLocations, statusFilter]);

  // ✅ زر "توسيط الخريطة" اليدوي — يعيد للموصّل القدرة على التوسيط بنفسه
  // بعد أن أصبح التوسيط التلقائي محدوداً بالحالات أعلاه فقط.
  function handleRecenter() {
    const map = mapRef.current;
    if (!map || filteredLocations.length === 0) return;
    const bounds = L.latLngBounds(filteredLocations.map(o => [o.lat, o.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  // ── إظهار نتيجة البحث بعد إعادة بناء الدبابيس (تُنفَّذ بعد تفعيل حالتها بالفلتر إن لزم) ──
  useEffect(() => {
    if (!pendingFocusId) return;
    const marker = markersByIdRef.current.get(pendingFocusId);
    const cluster = clusterRef.current;
    if (!marker || !cluster) return;
    if (typeof cluster.zoomToShowLayer === "function") {
      cluster.zoomToShowLayer(marker, () => setSelectedOrderId(pendingFocusId));
    } else {
      mapRef.current?.setView(marker.getLatLng(), 16);
      setSelectedOrderId(pendingFocusId);
    }
    setPendingFocusId(null);
  }, [pendingFocusId, filteredLocations]);

  function toggleStatus(s: string) {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  // ✅ بحث برقم الطلب: انتقال مباشر لموقعه على الخريطة (حتى لو داخل
  // مجموعة/Cluster) وفتح تفاصيله — يفعّل حالته بالفلتر تلقائياً إن كانت
  // مستبعدة، ويعرض رسالة صريحة عند عدم وجود نتيجة.
  function handleSearch() {
    const term = search.trim().toLowerCase();
    if (!term) { setSearchNotFound(false); return; }
    const match =
      validLocations.find(o => o.orderNumber?.toLowerCase() === term) ??
      validLocations.find(o => o.orderNumber?.toLowerCase().includes(term));
    if (!match) { setSearchNotFound(true); return; }
    setSearchNotFound(false);
    if (!statusFilter.has(match.status)) {
      setStatusFilter(prev => new Set(prev).add(match.status));
    }
    setPendingFocusId(match.orderId);
  }

  const totalActive = locations?.length ?? 0;
  const showEmptyState = !isLoading && validLocations.length === 0;
  const showNoFilterResults = !isLoading && validLocations.length > 0 && filteredLocations.length === 0;

  return (
    // ✅ إصلاح جذري: كانت الخريطة داخل Card بحجم محدود ضمن حاوية الأدمن
    // القياسية (سايدبار + padding + عرض أقصى) — تبدو فعلياً كصندوق صغير
    // أشبه بنافذة منبثقة على شاشة كبيرة فارغة حولها. الآن الصفحة (بمساعدة
    // AdminGuard fullBleed) تملأ كل الارتفاع المتاح أسفل الهيدر العلوي
    // فعلياً: شريط أدوات مضغوط أعلى + الخريطة تأخذ كل المساحة المتبقية.
    <div className="h-full min-h-0 flex flex-col">
      {/* ✅ شريط رجوع صغير — لا سايدبار هنا (fullBleed)، فبدونه لا توجد أي
          وسيلة للعودة لبقية أقسام لوحة التحكم. */}
      <div className="border-b bg-card px-3 py-2 flex flex-wrap items-center gap-2 justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/orders">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="العودة للطلبات">
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <span className="font-semibold text-sm flex items-center gap-1.5 truncate">
            <MapPin className="w-4 h-4 shrink-0" />
            خريطة الطلبات النشطة ({filteredLocations.length}{filteredLocations.length !== totalActive ? ` من ${totalActive}` : ""})
          </span>
        </div>
        {/* ✅ آخر تحديث + زر تحديث يدوي — التحديث الدوري (30 ثانية) لم يعد
            يعيد توسيط الخريطة تلقائياً، فيحتاج الموصّل مؤشراً واضحاً على
            حداثة البيانات وقدرة على تحديثها فوراً عند الحاجة. */}
        <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          {dataUpdatedAt ? `آخر تحديث: ${new Date(dataUpdatedAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}` : null}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "تحديث الآن"}
          </Button>
        </span>
      </div>

      {!canViewOrders || error ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground p-6">
          <ShieldAlert className="w-6 h-6" />
          <p className="text-sm max-w-sm">
            {!canViewOrders
              ? "تحتاج صلاحية \"الطلبات\" لعرض خريطة الطلبات النشطة — تواصل مع مدير الحساب لمنحك إياها."
              : "تعذّر تحميل خريطة الطلبات. حاول مرة أخرى لاحقاً."}
          </p>
        </div>
      ) : (
        <>
          <div className="border-b bg-card px-3 py-2 flex flex-col gap-2 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {/* فلترة حسب الحالة — تحدّث الخريطة تلقائياً */}
              <div className="flex flex-wrap gap-2">
                {ALL_STATUSES.map(s => {
                  const active = statusFilter.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatus(s)}
                      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors"
                      style={active
                        ? { background: STATUS_COLOR[s], color: "#fff", borderColor: STATUS_COLOR[s] }
                        : { color: "var(--muted-foreground)" }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: active ? "#fff" : STATUS_COLOR[s] }} />
                      {STATUS_LABEL[s]}
                    </button>
                  );
                })}
              </div>
              {/* بحث برقم الطلب */}
              <div className="flex gap-2 sm:mr-auto w-full sm:w-auto">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="بحث برقم الطلب..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setSearchNotFound(false); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="pr-9"
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={handleSearch}>بحث</Button>
                {/* ✅ توسيط يدوي — يعوّض عدم إعادة التوسيط التلقائي عند كل تحديث دوري */}
                <Button size="sm" variant="outline" onClick={handleRecenter} title="توسيط الخريطة على كل الطلبات الظاهرة">
                  توسيط
                </Button>
              </div>
            </div>
            {/* ✅ توضيح بصري لمعنى الحلقة الحمراء النابضة حول أي دبوس */}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-destructive" />
              الحلقة الحمراء = طلب متأخر عن المدة المعتادة لحالته الحالية
            </p>
            {searchNotFound && (
              <p className="text-xs text-destructive">لم يُعثر على طلب نشط بهذا الرقم.</p>
            )}
            {showNoFilterResults && (
              <p className="text-xs text-muted-foreground">لا توجد طلبات مطابقة للفلتر المحدد.</p>
            )}
          </div>

          {/* ✅ حاوية الخريطة الفعلية: position relative لتكون مرجعاً للوحة
              التفاصيل المنزلقة (OrderDetailsPanel) بحيث تظهر "فوق" الخريطة
              نفسها كجزء من نفس الشاشة، لا كنافذة منفصلة تحجب كل الصفحة. */}
          <div className="relative flex-1 min-h-0">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : showEmptyState ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground p-6">
                <MapPin className="w-6 h-6" />
                <p className="text-sm">لا توجد طلبات نشطة بإحداثيات صالحة لعرضها على الخريطة حالياً.</p>
              </div>
            ) : (
              <div ref={containerRef} className="absolute inset-0" />
            )}

            <OrderDetailsPanel orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
          </div>
        </>
      )}
    </div>
  );
}

export default function DeliveryMap() {
  return (
    <AdminGuard activeKey="deliveryMap" fullBleed>
      {(user) => (
        <OrdersClusterMap canViewOrders={user.isSuperAdmin || user.permissions.includes("orders")} />
      )}
    </AdminGuard>
  );
}
