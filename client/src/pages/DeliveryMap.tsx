// ELEVEN STORE — لوحة التحكم: خريطة الطلبات النشطة (للموصّلين)
// ─────────────────────────────────────────────────────────────────────────
// إعادة بناء مبسّطة. الفكرة: خريطة بملء الشاشة + دبابيس ملوّنة بحسب الحالة،
// والضغط على أي دبوس يفتح بطاقة الطلب (اتصال / تنقّل / تغيير الحالة).
//
// أهم ما أُصلح مقارنةً بالنسخة السابقة:
//  1) الخريطة كانت لا تُنشأ أصلاً: حاوية Leaflet كانت تُرسم فقط بعد انتهاء
//     التحميل، بينما كود الإنشاء يعمل مرة واحدة عند أول تركيب (والحاوية
//     غير موجودة بعد). الآن الحاوية موجودة دائماً، وحالات التحميل/الخطأ/
//     الفراغ طبقات فوقها.
//  2) للخريطة صلاحية مستقلة "deliveryMap" (سيرفر + واجهة). استدعاء getZones
//     (صلاحية deliveryZones) أُزيل لأنه كان يفشل بصمت — طبقة المناطق مرجعية فقط.
//  3) خطأ تحديث دوري لا يخفي الخريطة بعد الآن (يُبقي آخر بيانات ناجحة).
//  4) الارتفاع: الصفحة تعتمد Layout fullHeight بدل h-full تحت min-h-screen.
//  5) على الجوال: البطاقة تظهر كـ Bottom Sheet بدل لوحة جانبية تحجب الخريطة.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Loader2, Locate, MapPin, Navigation,
  Phone, RefreshCw, Search, ShieldAlert, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import AdminGuard from "@/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatNumber } from "@/lib/formatters";
import { getOrderStatusConfig, ORDER_STATUS_OPTIONS } from "@/lib/orderStatus";
import { userHasAdminPermission } from "@/lib/adminSections";
import { ORDER_STATUS_COLORS } from "@/lib/colors";
import { KHARTOUM_CENTER, TILE_URL, TILE_ATTRIBUTION } from "@/lib/mapConstants";

// Leaflet + markercluster محمَّلان كسكربت عادي في index.html (window.L).
declare const L: any;

// ── الحالات النشطة (مطابقة لـACTIVE_ORDER_STATUSES بالسيرفر) ──
const ACTIVE_STATUSES = ["under_review", "processing", "out_for_delivery"] as const;
type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

// المدة (بالدقائق) التي بعدها يُعتبر الطلب "متأخراً" في حالته الحالية.
// الحالات المتاحة للموصّل في قائمة التغيير (مطابقة لـMAP_ALLOWED_STATUSES بالسيرفر).
const MAP_STATUS_OPTIONS = ORDER_STATUS_OPTIONS.filter((o) =>
  ["processing", "out_for_delivery", "delivered"].includes(o.value));

const STALE_MINUTES: Record<ActiveStatus, number> = {
  under_review: 30,
  processing: 60,
  out_for_delivery: 90,
};

type OrderPin = {
  orderId: string; orderNumber: string; status: string; total: number;
  customerName: string; phone: string; city: string;
  lat: number; lng: number; createdAt: string | null;
};

// ── أدوات مساعدة ──────────────────────────────────────────────────────
const minutesSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : null;
};

const formatElapsed = (m: number): string => {
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `منذ ${h} س ${r} د` : `منذ ${h} س`;
};

const isStale = (status: string, m: number | null): boolean =>
  m !== null && status in STALE_MINUTES && m >= STALE_MINUTES[status as ActiveStatus];

const hasValidCoords = (o: { lat: number; lng: number }): boolean =>
  Number.isFinite(o.lat) && Number.isFinite(o.lng) &&
  Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180 &&
  !(o.lat === 0 && o.lng === 0);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => (s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function pinIcon(color: string, stale: boolean) {
  return L.divIcon({
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="position:relative;width:20px;height:20px">
      ${stale ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #dc2626;animation:pulse-stale 1.5s ease-out infinite"></div>` : ""}
      <div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>
    </div>`,
  });
}

// ── بطاقة تفاصيل الطلب (Bottom Sheet على الجوال، لوحة جانبية على الشاشات الكبيرة) ──
function OrderCard({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: order, isLoading, error } = trpc.deliveryZones.getOrderDetailsAdmin.useQuery({ id: orderId });
  const [status, setStatus] = useState<string>("");

  useEffect(() => { if (order) setStatus(order.status); }, [order?.id, order?.status]);

  const update = trpc.deliveryZones.updateOrderStatusFromMap.useMutation({
    onSuccess: (_d, vars) => {
      toast.success("تم تحديث حالة الطلب");
      utils.deliveryZones.getActiveOrderLocations.invalidate();
      utils.deliveryZones.getOrderDetailsAdmin.invalidate({ id: orderId });
      // الطلب خرج من الحالات النشطة (سُلِّم/أُلغي...) → يختفي دبوسه، فنغلق البطاقة.
      if (!(ACTIVE_STATUSES as readonly string[]).includes(vars.status)) onClose();
    },
    onError: (e) => toast.error(e.message || "تعذّر تحديث الحالة"),
  });

  const addr = order?.shippingAddress;
  const lat = Number(addr?.latitude);
  const lng = Number(addr?.longitude);
  const phone: string = addr?.phone || "";
  const mins = minutesSince(order?.createdAt ?? null);
  const stale = order ? isStale(order.status, mins) : false;
  const cfg = order ? getOrderStatusConfig(order.status) : null;

  return (
    <div
      className="absolute z-10 bg-card shadow-2xl flex flex-col
        inset-x-0 bottom-0 max-h-[75%] rounded-t-2xl border-t
        sm:inset-y-0 sm:left-0 sm:right-auto sm:bottom-auto sm:max-h-none sm:w-96 sm:rounded-none sm:border-t-0 sm:border-r"
    >
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
        <h2 className="font-semibold text-sm">{order ? `الطلب #${order.orderNumber}` : "تفاصيل الطلب"}</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="إغلاق">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : error || !order ? (
          <p className="text-sm text-muted-foreground py-8 text-center">تعذّر تحميل تفاصيل هذا الطلب.</p>
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span style={cfg!.style} className="px-2 py-1 rounded text-xs font-semibold">{cfg!.label}</span>
              {mins !== null && (
                <span className={`text-xs flex items-center gap-1 ${stale ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {stale && <AlertTriangle className="w-3.5 h-3.5" />}
                  {formatElapsed(mins)}{stale ? " — متأخر" : ""}
                </span>
              )}
            </div>

            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p className="font-semibold">{addr?.fullName || addr?.name || "—"}</p>
              <p className="text-muted-foreground">
                {[addr?.city, addr?.address].filter(Boolean).join(" — ") || "لا يوجد عنوان نصي"}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button asChild variant="outline" size="sm" className={phone ? "" : "pointer-events-none opacity-50"}>
                  <a href={phone ? `tel:${phone}` : undefined}><Phone className="w-4 h-4 ml-1" />اتصال</a>
                </Button>
                <Button asChild variant="outline" size="sm" className={Number.isFinite(lat) && Number.isFinite(lng) ? "" : "pointer-events-none opacity-50"}>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                    target="_blank" rel="noreferrer"
                  ><Navigation className="w-4 h-4 ml-1" />توجيه</a>
                </Button>
              </div>
            </div>

            <div className="rounded-lg border divide-y text-sm">
              {(order.items ?? []).map((it: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  {it.image
                    ? <img src={it.image} alt="" className="w-9 h-9 rounded object-cover bg-muted shrink-0" />
                    : <div className="w-9 h-9 rounded bg-muted shrink-0" />}
                  <span className="flex-1 truncate">{it.name} × {it.quantity}</span>
                  <span className="text-muted-foreground whitespace-nowrap">{formatNumber(it.price * it.quantity)} ج.س</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 font-semibold">
                <span>الإجمالي</span>
                <span>{formatNumber(order.total ?? 0)} ج.س</span>
              </div>
            </div>

            <div className="space-y-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
                <SelectContent>
                  {/* الحالة الحالية (مثل "قيد المراجعة") تظهر معطّلة للعرض فقط */}
                  {!MAP_STATUS_OPTIONS.some((o) => o.value === order.status) && (
                    <SelectItem value={order.status} disabled>{cfg!.label}</SelectItem>
                  )}
                  {MAP_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                disabled={update.isPending || !status || status === order.status || !MAP_STATUS_OPTIONS.some((o) => o.value === status)}
                onClick={() => update.mutate({ id: order.id, status: status as "processing" | "out_for_delivery" | "delivered" })}
              >
                {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ الحالة"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── الخريطة ──────────────────────────────────────────────────────────
function OrdersMap({ canGoToOrders }: { canGoToOrders: boolean }) {
  const { data, isLoading, isFetching, error, dataUpdatedAt, refetch } =
    trpc.deliveryZones.getActiveOrderLocations.useQuery(undefined, { refetchInterval: 30_000 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const fittedRef = useRef(false);

  const [leafletMissing, setLeafletMissing] = useState(false);
  const [active, setActive] = useState<Set<string>>(new Set(ACTIVE_STATUSES));
  const [search, setSearch] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pins = useMemo<OrderPin[]>(() => (data ?? []).filter(hasValidCoords), [data]);
  const visible = useMemo(() => pins.filter((o) => active.has(o.status)), [pins, active]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    pins.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1; });
    return c;
  }, [pins]);

  // إنشاء الخريطة مرة واحدة (الحاوية موجودة دائماً فلا مشكلة توقيت).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof L === "undefined") { setLeafletMissing(true); return; }

    const map = L.map(el, { zoomControl: true }).setView(KHARTOUM_CENTER, 11);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    const cluster = typeof L.markerClusterGroup === "function"
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true })
      : L.layerGroup();
    map.addLayer(cluster);
    map.on("click", () => setSelectedId(null));

    // الخريطة تُعيد حساب حجمها عند أي تغيّر بحجم الحاوية (تدوير الشاشة، ظهور الشريط...).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    mapRef.current = map;
    clusterRef.current = cluster;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  const fit = (list: OrderPin[]) => {
    const map = mapRef.current;
    if (!map || list.length === 0) return;
    map.fitBounds(L.latLngBounds(list.map((o) => [o.lat, o.lng])), { padding: [50, 50], maxZoom: 15 });
  };

  // رسم الدبابيس (يُعاد فقط عند تغيّر البيانات/الفلتر، لا عند كل تحديث دوري متطابق).
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    const byId = new Map<string, any>();
    const markers = visible.map((o) => {
      const mins = minutesSince(o.createdAt);
      const m = L.marker([o.lat, o.lng], {
        icon: pinIcon(ORDER_STATUS_COLORS[o.status as ActiveStatus]?.bg ?? "#dc2626", isStale(o.status, mins)),
      });
      m.bindTooltip(
        [`#${esc(o.orderNumber)}`, esc(o.customerName), mins !== null ? formatElapsed(mins) : ""].filter(Boolean).join(" — "),
        { direction: "top", offset: [0, -10] },
      );
      m.on("click", (e: any) => { L.DomEvent.stopPropagation(e); setSelectedId(o.orderId); });
      byId.set(o.orderId, m);
      return m;
    });
    if (typeof cluster.addLayers === "function") cluster.addLayers(markers);
    else markers.forEach((m) => cluster.addLayer(m));
    markersRef.current = byId;

    // توسيط تلقائي أول مرة فقط؛ بعدها الموصّل هو من يتحكم (زر التوسيط).
    if (!fittedRef.current && visible.length > 0) { fit(visible); fittedRef.current = true; }
  }, [visible]);

  const toggle = (s: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
    fittedRef.current = false; // يوسّط على النتيجة الجديدة بعد تغيير الفلتر
  };

  // بحث: رقم الطلب (أو اسم العميل / الهاتف) → انتقال للدبوس وفتح بطاقته.
  const runSearch = () => {
    const q = search.trim().toLowerCase();
    if (!q) { setNotFound(false); return; }
    const match =
      pins.find((o) => o.orderNumber?.toLowerCase() === q) ??
      pins.find((o) =>
        o.orderNumber?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.phone?.includes(q));
    if (!match) { setNotFound(true); return; }
    setNotFound(false);
    if (!active.has(match.status)) {
      setActive((prev) => new Set(prev).add(match.status));
    }
    // ننتظر إعادة رسم الدبابيس (قد يتغيّر الفلتر) ثم نركّز على الدبوس.
    setTimeout(() => {
      const marker = markersRef.current.get(match.orderId);
      const cluster = clusterRef.current;
      if (marker && typeof cluster?.zoomToShowLayer === "function") {
        cluster.zoomToShowLayer(marker, () => setSelectedId(match.orderId));
      } else {
        mapRef.current?.setView([match.lat, match.lng], 16);
        setSelectedId(match.orderId);
      }
    }, 50);
  };

  const showEmpty = !isLoading && !error && pins.length === 0;
  const showHardError = !!error && !data; // فشل التحميل الأول فقط — الأخطاء اللاحقة لا تخفي الخريطة
  const hasFilterMiss = pins.length > 0 && visible.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* الشريط العلوي */}
      <div className="border-b bg-card px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* زر الرجوع فقط لمن يملك صلاحية الطلبات — الموصّل بصلاحية الخريطة وحدها لا صفحة يرجع إليها */}
          {canGoToOrders && (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Link href="/orders" aria-label="العودة للطلبات"><ArrowRight className="w-4 h-4" /></Link>
            </Button>
          )}
          <span className="font-semibold text-sm flex items-center gap-1.5 truncate">
            <MapPin className="w-4 h-4 shrink-0" />
            الطلبات النشطة ({visible.length}{visible.length !== pins.length ? ` من ${pins.length}` : ""})
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          {dataUpdatedAt > 0 && (
            <span className="hidden sm:inline">
              {new Date(dataUpdatedAt).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} aria-label="تحديث">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* الفلاتر + البحث */}
      <div className="border-b bg-card px-3 py-2 space-y-2 shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {ACTIVE_STATUSES.map((s) => {
            const on = active.has(s);
            const color = ORDER_STATUS_COLORS[s].bg;
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors"
                style={on ? { background: color, borderColor: color, color: "#fff" } : { color: "var(--muted-foreground)" }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: on ? "#fff" : color }} />
                {getOrderStatusConfig(s).label} ({counts[s] ?? 0})
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setNotFound(false); }}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="رقم الطلب أو اسم العميل أو الهاتف"
              className="pr-9 h-9"
            />
          </div>
          <Button size="sm" variant="secondary" className="h-9" onClick={runSearch}>بحث</Button>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => fit(visible)} aria-label="توسيط على الطلبات">
            <Locate className="w-4 h-4" />
          </Button>
        </div>
        {notFound && <p className="text-xs text-destructive">لا يوجد طلب نشط مطابق.</p>}
        {hasFilterMiss && <p className="text-xs text-muted-foreground">لا توجد طلبات ضمن الحالات المحددة.</p>}
      </div>

      {/* الخريطة (الحاوية دائماً موجودة) + الطبقات فوقها */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0 z-0" />

        {(isLoading || showEmpty || showHardError || leafletMissing) && (
          <div className="absolute inset-0 z-[5] bg-background/85 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            {leafletMissing ? (
              <>
                <ShieldAlert className="w-6 h-6" />
                <p className="text-sm">تعذّر تحميل مكتبة الخرائط. تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.</p>
                <Button size="sm" variant="outline" onClick={() => location.reload()}>إعادة تحميل الصفحة</Button>
              </>
            ) : isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : showHardError ? (
              <>
                <ShieldAlert className="w-6 h-6" />
                <p className="text-sm">تعذّر تحميل الطلبات.</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>إعادة المحاولة</Button>
              </>
            ) : (
              <>
                <MapPin className="w-6 h-6" />
                <p className="text-sm">لا توجد طلبات نشطة بموقع محدَّد حالياً.</p>
              </>
            )}
          </div>
        )}

        {selectedId && <OrderCard key={selectedId} orderId={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

export default function DeliveryMap() {
  return (
    <AdminGuard activeKey="deliveryMap" fullBleed>
      {(user) =>
        userHasAdminPermission(user, "deliveryMap") ? (
          <OrdersMap canGoToOrders={userHasAdminPermission(user, "orders")} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <ShieldAlert className="w-6 h-6" />
            <p className="text-sm max-w-sm">تحتاج صلاحية "خريطة الطلبات" لعرض الخريطة — تواصل مع مدير الحساب.</p>
          </div>
        )
      }
    </AdminGuard>
  );
}
