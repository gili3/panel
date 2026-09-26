// ELEVEN STORE — لوحة التحكم: مناطق التوصيل (محرِّر مضلّعات) + خريطة الطلبات المجمّعة
// ─────────────────────────────────────────────────────────────────────────
// ✅ جديد: يستخدم Leaflet + OpenStreetMap (محمَّلة عبر CDN بـclient/index.html
// كسكربت عام window.L) بدل Google Maps JS — لا مفتاح API مُفعَّل حالياً
// بجانب الموقع (فقط بتطبيق الأندرويد)، وLeaflet/OSM لا يحتاجان أي مفتاح.
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MapPin, Plus, Trash2, Undo2, Save, X, ShieldAlert } from "lucide-react";
import type { DeliveryZone, LatLng } from "@shared/deliveryZones";

// window.L محمَّل عبر <script> عادي بـindex.html (راجع التعليق أعلاه) —
// لا يوجد نوع TS رسمي مثبَّت هنا (@types/leaflet)، لذا `any` مقصودة.
declare const L: any;

// افتراضي: مركز الخرطوم — نفس نقطة البداية المستخدمة بتطبيق الأندرويد (LocationPicker.kt)
const KHARTOUM_CENTER: [number, number] = [15.5007, 32.5599];
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";

// ─────────────────────────────────────────────────────────────────────────
//  محرِّر مضلّع واحد: نقرة على الخريطة = إضافة نقطة جديدة بالترتيب
// ─────────────────────────────────────────────────────────────────────────
function ZonePolygonMap({
  points,
  onPointsChange,
  referenceZones,
}: {
  points: LatLng[];
  onPointsChange: (pts: LatLng[]) => void;
  referenceZones: { id: string; name: string; polygon: LatLng[] }[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const editLayerRef = useRef<any>(null);
  const referenceLayerRef = useRef<any>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // إنشاء الخريطة مرة واحدة فقط
  useEffect(() => {
    if (!containerRef.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(containerRef.current).setView(KHARTOUM_CENTER, 12);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.on("click", (e: any) => {
      onPointsChange([...pointsRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // رسم/تحديث نقاط المضلّع الجاري تعديله
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined") return;
    editLayerRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    points.forEach((p, i) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 6, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1, weight: 2,
      })
        .bindTooltip(String(i + 1), { permanent: true, direction: "top", className: "font-bold" })
        .addTo(group);
    });
    if (points.length >= 2) {
      L.polygon(points.map(p => [p.lat, p.lng]), { color: "#dc2626", weight: 2, fillOpacity: 0.15 }).addTo(group);
    }
    editLayerRef.current = group;
  }, [points]);

  // مناطق أخرى محفوظة مسبقاً — تُعرض كخلفية مرجعية منقّطة فقط (غير قابلة للتعديل هنا)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined") return;
    referenceLayerRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    referenceZones.forEach(z => {
      if (z.polygon.length >= 3) {
        L.polygon(z.polygon.map(p => [p.lat, p.lng]), {
          color: "#6b7280", weight: 1, dashArray: "4 4", fillOpacity: 0.05,
        }).bindTooltip(z.name).addTo(group);
      }
    });
    referenceLayerRef.current = group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceZones]);

  return <div ref={containerRef} className="w-full h-[360px] rounded-lg border" />;
}

// ─────────────────────────────────────────────────────────────────────────
//  إدارة مناطق التوصيل: قائمة + إنشاء/تعديل/حذف
// ─────────────────────────────────────────────────────────────────────────
function DeliveryZonesManager() {
  const utils = trpc.useUtils();
  const { data: zones, isLoading } = trpc.deliveryZones.getZones.useQuery();

  const [editing, setEditing] = useState<DeliveryZone | "new" | null>(null);
  const [formName, setFormName] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formPoints, setFormPoints] = useState<LatLng[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeliveryZone | null>(null);

  function closeEditor() {
    setEditing(null);
    setFormName("");
    setFormPoints([]);
  }

  const createZone = trpc.deliveryZones.createZone.useMutation({
    onSuccess: () => {
      utils.deliveryZones.getZones.invalidate();
      toast.success("تم إنشاء منطقة التوصيل");
      closeEditor();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateZone = trpc.deliveryZones.updateZone.useMutation({
    onSuccess: () => {
      utils.deliveryZones.getZones.invalidate();
      toast.success("تم حفظ التعديلات");
      closeEditor();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteZone = trpc.deliveryZones.deleteZone.useMutation({
    onSuccess: () => {
      utils.deliveryZones.getZones.invalidate();
      toast.success("تم حذف المنطقة");
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  function openNew() {
    setEditing("new");
    setFormName("");
    setFormActive(true);
    setFormPoints([]);
  }
  function openEdit(z: DeliveryZone) {
    setEditing(z);
    setFormName(z.name);
    setFormActive(z.isActive);
    setFormPoints(z.polygon);
  }

  function handleSave() {
    if (!formName.trim()) return toast.error("اسم المنطقة مطلوب");
    if (formPoints.length < 3) return toast.error("حدّد 3 نقاط على الأقل على الخريطة لتشكيل مضلّع");
    if (editing === "new") {
      createZone.mutate({ name: formName.trim(), polygon: formPoints, isActive: formActive });
    } else if (editing) {
      updateZone.mutate({ id: editing.id, name: formName.trim(), polygon: formPoints, isActive: formActive });
    }
  }

  // المنطقة الجاري تعديلها لا تُعرض كمرجع فوق نفسها
  const editingId = editing && editing !== "new" ? editing.id : null;
  const referenceZones = useMemo(
    () => (zones ?? []).filter(z => z.id !== editingId),
    [zones, editingId],
  );

  const isSaving = createZone.isPending || updateZone.isPending;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>مناطق التوصيل</CardTitle>
          {!editing && (
            <Button onClick={openNew} size="sm" className="gap-1">
              <Plus className="w-4 h-4" /> منطقة جديدة
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : editing ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold mb-1 block">اسم المنطقة</label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="مثال: وسط الخرطوم" />
                </div>
                <div className="flex items-center gap-2 sm:pt-6">
                  <Switch checked={formActive} onCheckedChange={setFormActive} />
                  <span className="text-sm">منطقة فعّالة (تُطبَّق فوراً على الطلبات الجديدة)</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                اضغط على الخريطة لإضافة نقاط حدود المنطقة بالترتيب — {formPoints.length} نقطة محدَّدة حالياً (3 على الأقل مطلوبة).
                المناطق الرمادية المنقّطة مناطق أخرى محفوظة مسبقاً، للمرجع فقط.
              </p>

              <ZonePolygonMap points={formPoints} onPointsChange={setFormPoints} referenceZones={referenceZones} />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline" size="sm" disabled={formPoints.length === 0}
                  onClick={() => setFormPoints(formPoints.slice(0, -1))} className="gap-1"
                >
                  <Undo2 className="w-4 h-4" /> تراجع عن آخر نقطة
                </Button>
                <Button
                  variant="outline" size="sm" disabled={formPoints.length === 0}
                  onClick={() => setFormPoints([])} className="gap-1"
                >
                  <Trash2 className="w-4 h-4" /> مسح كل النقاط
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={closeEditor} className="gap-1">
                  <X className="w-4 h-4" /> إلغاء
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  حفظ
                </Button>
              </div>
            </div>
          ) : (zones ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              لا توجد مناطق توصيل بعد — التوصيل غير مقيَّد جغرافياً حالياً، وأي طلب يُقبل بصرف النظر عن الموقع.
              أضِف أول منطقة أدناه لتفعيل التحقق الجغرافي.
            </p>
          ) : (
            <div className="space-y-2">
              {zones!.map(z => (
                <div key={z.id} className="flex items-center justify-between border rounded-lg p-3 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold">{z.name}</span>
                    <Badge variant={z.isActive ? "default" : "secondary"}>
                      {z.isActive ? "فعّالة" : "معطّلة"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">({z.polygon.length} نقطة)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(z)}>تعديل</Button>
                    <Button
                      variant="outline" size="sm" className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(z)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف منطقة التوصيل؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف "{deleteTarget?.name}" نهائياً. الطلبات القائمة لا تتأثر بهذا، لكن أي طلب جديد يقع ضمن حدودها سابقاً
              سيُرفض ما لم يبقَ مغطّى بمنطقة أخرى فعّالة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteZone.isPending}
              onClick={() => deleteTarget && deleteZone.mutate({ id: deleteTarget.id })}
            >
              {deleteZone.isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  خريطة مجمّعة (Cluster Map): كل الطلبات النشطة (pending/paid/shipped) دفعة واحدة
// ─────────────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  pending: "#f59e0b",
  paid: "#3b82f6",
  shipped: "#8b5cf6",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "قيد الانتظار",
  paid: "تم الدفع",
  shipped: "خرج للتوصيل",
};

function OrdersClusterMap({ canViewOrders }: { canViewOrders: boolean }) {
  // ✅ تحديث دوري كل 30 ثانية — لوحة تحكم مفتوحة طوال الوقت (شاشة العمليات)
  // تعكس طلبات جديدة/متغيّرة الحالة بلا حاجة لتحديث الصفحة يدوياً.
  // ✅ إصلاح: هذا الاستعلام يتطلّب صلاحية "orders" على السيرفر (وليس
  // "deliveryZones" التي تحمي الصفحة كلها) — أدمن يملك "deliveryZones" فقط
  // كان يفتح هذا التبويب ويحصل على FORBIDDEN بصمت (لا معالجة خطأ هنا ولا
  // بـmain.tsx)، فتظهر له خريطة فاضية بلا أي تفسير. الآن enabled: canViewOrders
  // يمنع حتى إطلاق الطلب أصلاً، ونعرض رسالة صريحة بدلاً من الخريطة.
  const { data: locations, isLoading, error } = trpc.deliveryZones.getActiveOrderLocations.useQuery(undefined, {
    refetchInterval: 30_000,
    enabled: canViewOrders,
  });
  const { data: zones } = trpc.deliveryZones.getZones.useQuery();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || typeof L === "undefined") return;
    const map = L.map(containerRef.current).setView(KHARTOUM_CENTER, 11);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined") return;
    layerRef.current?.remove();
    const group = L.layerGroup().addTo(map);

    (zones ?? []).forEach(z => {
      if (z.polygon.length >= 3) {
        L.polygon(z.polygon.map(p => [p.lat, p.lng]), {
          color: z.isActive ? "#16a34a" : "#9ca3af", weight: 1, dashArray: "4 4", fillOpacity: 0.04,
        }).bindTooltip(z.name).addTo(group);
      }
    });

    (locations ?? []).forEach(o => {
      const color = STATUS_COLOR[o.status] ?? "#dc2626";
      L.circleMarker([o.lat, o.lng], {
        radius: 8, color, fillColor: color, fillOpacity: 0.9, weight: 2,
      })
        .bindPopup(
          `<div style="min-width:140px">` +
            `<b>#${o.orderNumber}</b><br/>` +
            `${o.customerName || "-"}<br/>` +
            `${o.phone || ""}<br/>` +
            `${o.city || ""}<br/>` +
            `${STATUS_LABEL[o.status] ?? o.status} — ${o.total} ج.س` +
          `</div>`
        )
        .addTo(group);
    });

    layerRef.current = group;
  }, [locations, zones]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="w-4 h-4" /> خريطة الطلبات النشطة ({locations?.length ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canViewOrders || error ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ShieldAlert className="w-6 h-6" />
            <p className="text-sm max-w-sm">
              {!canViewOrders
                ? "تحتاج صلاحية \"الطلبات\" لعرض خريطة الطلبات النشطة — تواصل مع مدير الحساب لمنحك إياها."
                : "تعذّر تحميل خريطة الطلبات. حاول مرة أخرى لاحقاً."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              {(["pending", "paid", "shipped"] as const).map(s => (
                <span key={s} className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                  {STATUS_LABEL[s]}
                </span>
              ))}
            </div>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div ref={containerRef} className="w-full h-[480px] rounded-lg border" />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryZonesPageContent({ canViewOrders }: { canViewOrders: boolean }) {
  return (
    <Tabs defaultValue="zones" className="w-full">
      <TabsList>
        <TabsTrigger value="zones">مناطق التوصيل</TabsTrigger>
        <TabsTrigger value="map">خريطة الطلبات المجمّعة</TabsTrigger>
      </TabsList>
      <TabsContent value="zones" className="mt-4">
        <DeliveryZonesManager />
      </TabsContent>
      <TabsContent value="map" className="mt-4">
        <OrdersClusterMap canViewOrders={canViewOrders} />
      </TabsContent>
    </Tabs>
  );
}

export default function DeliveryZones() {
  return (
    <AdminGuard activeKey="deliveryZones">
      {(user) => (
        <DeliveryZonesPageContent
          canViewOrders={user.isSuperAdmin || user.permissions.includes("orders")}
        />
      )}
    </AdminGuard>
  );
}
