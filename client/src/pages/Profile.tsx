import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { User, MapPin, Plus, Pencil, Trash2, Loader2, Mail, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { COLORS } from "@/lib/colors";

const emptyForm = { fullName: "", phone: "", city: "", address: "", isDefault: false };

export default function Profile() {
  const { user, loading, updateUserProfile } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"info" | "addresses">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "addresses" ? "addresses" : "info";
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  // ── تعديل الاسم ورقم الهاتف ──
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: "", phone: "" });
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    if (user) setInfoForm({ name: user.name || "", phone: user.phone || "" });
  }, [user?.name, user?.phone]);

  const startEditInfo = () => {
    setInfoForm({ name: user.name || "", phone: user.phone || "" });
    setIsEditingInfo(true);
  };

  const cancelEditInfo = () => {
    setInfoForm({ name: user.name || "", phone: user.phone || "" });
    setIsEditingInfo(false);
  };

  const saveInfo = async () => {
    const name = infoForm.name.trim();
    const phone = infoForm.phone.trim();
    if (!name) {
      toast.error("الاسم مطلوب");
      return;
    }
    setSavingInfo(true);
    try {
      await updateUserProfile(name, phone);
      toast.success("تم حفظ التعديلات بنجاح");
      setIsEditingInfo(false);
    } catch (err: any) {
      toast.error(err?.message || "تعذر حفظ التعديلات، حاول مرة أخرى");
    } finally {
      setSavingInfo(false);
    }
  };

  const { data: addresses = [], isLoading: addrLoading } = trpc.firestore.getAddresses.useQuery(undefined, { enabled: !!user });
  const utils = trpc.useUtils();

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const addAddress = trpc.firestore.addAddress.useMutation({
    onSuccess: () => {
      toast.success("تمت إضافة العنوان");
      resetForm();
      utils.firestore.getAddresses.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "تعذّرت إضافة العنوان، حاول مرة أخرى");
    },
  });

  const updateAddress = trpc.firestore.updateAddress.useMutation({
    onSuccess: () => {
      toast.success("تم تعديل العنوان");
      resetForm();
      utils.firestore.getAddresses.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "تعذّر تعديل العنوان، حاول مرة أخرى");
    },
  });

  const deleteAddress = trpc.firestore.deleteAddress.useMutation({
    onSuccess: () => { toast.success("تم حذف العنوان"); utils.firestore.getAddresses.invalidate(); },
    onError: (err) => {
      toast.error(err.message || "تعذّر حذف العنوان، حاول مرة أخرى");
    },
  });

  useEffect(() => { if (!loading && !user) setLocation("/"); }, [user, loading]);

  const startEdit = (addr: any) => {
    setEditingId(addr.id);
    setForm({ fullName: addr.fullName, phone: addr.phone, city: addr.city, address: addr.address, isDefault: !!addr.isDefault });
    setShowForm(true);
  };

  const startAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const handleSave = () => {
    if (editingId) {
      updateAddress.mutate({ id: editingId, ...form });
    } else {
      addAddress.mutate(form);
    }
  };

  if (loading) return <Layout><div className="flex justify-center py-40"><Loader2 className="w-12 h-12 animate-spin text-foreground" /></div></Layout>;
  if (!user) return null;

  const saving = addAddress.isPending || updateAddress.isPending;

  return (
    <Layout>
      <div className="min-h-screen bg-secondary">
        {/* ── Header gradient ── */}
        <div
          className="flex flex-col items-center pb-10 pt-8 px-6 rounded-b-3xl"
          style={{ background: `linear-gradient(180deg, ${COLORS.ink} 0%, ${COLORS.neutral[800]} 100%)` }}
        >
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mb-4"
            style={{ border: `2px solid ${COLORS.white}`, background: "rgba(255,255,255,0.1)" }}
          >
            <span className="text-4xl font-bold text-white" style={{ fontFamily: "Georgia, serif", color: COLORS.white }}>
              {user.name?.charAt(0)?.toUpperCase() || "11"}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">{user.name || "مستخدم"}</h2>
          <p className="text-white/60 text-sm mt-1">{user.email}</p>
        </div>

        <div className="px-4 py-5 max-w-2xl mx-auto">
          {/* ── Tab Bar ── */}
          <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-border mb-5">
            {[["info", "البيانات الشخصية"], ["addresses", "العناوين"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key as any)}
                className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${
                  tab === key ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-secondary/30"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Personal Info Tab: name / email / phone — قابلة للتعديل للاسم والهاتف ── */}
          {tab === "info" && (
            <Card className="border border-border bg-white shadow-sm rounded-2xl">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-foreground">البيانات الشخصية</p>
                  {!isEditingInfo && (
                    <button
                      onClick={startEditInfo}
                      className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80"
                    >
                      <Pencil className="w-3.5 h-3.5" /> تعديل
                    </button>
                  )}
                </div>

                {!isEditingInfo ? (
                  <div className="divide-y divide-border">
                    {[
                      { label: "الاسم الكامل", value: user.name || "—", icon: User },
                      { label: "البريد الإلكتروني", value: user.email || "—", icon: Mail },
                      { label: "رقم الهاتف", value: user.phone || "—", icon: Phone },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-4 py-3.5">
                        <div className="w-9 h-9 bg-accent/10 rounded-xl flex items-center justify-center flex-shrink-0">
                          <row.icon className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{row.label}</p>
                          <p className="font-bold text-foreground text-sm">{row.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1">الاسم الكامل</label>
                      <Input
                        value={infoForm.name}
                        onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                        placeholder="الاسم الكامل"
                        className="border-border bg-secondary/20 h-10 text-sm focus:ring-2 focus:ring-primary rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-foreground block mb-1">رقم الهاتف</label>
                      <Input
                        value={infoForm.phone}
                        onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
                        placeholder="+966501234567"
                        dir="ltr"
                        className="border-border bg-secondary/20 h-10 text-sm focus:ring-2 focus:ring-primary rounded-lg text-right"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-muted-foreground block mb-1">البريد الإلكتروني</label>
                      <p className="text-sm text-muted-foreground px-1">{user.email || "—"}</p>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button onClick={saveInfo} disabled={savingInfo}
                        className="flex-1 bg-primary text-white hover:bg-primary/90 font-bold h-10 rounded-lg">
                        {savingInfo ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
                      </Button>
                      <Button variant="outline" onClick={cancelEditInfo} disabled={savingInfo}
                        className="flex-1 border-border h-10 rounded-lg">
                        إلغاء
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Addresses Tab: add / edit / delete ── */}
          {tab === "addresses" && (
            <div className="space-y-3">
              {addrLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : addresses.length === 0 && !showForm ? (
                <div className="text-center py-8 text-muted-foreground text-sm">لا توجد عناوين مسجّلة</div>
              ) : (
                addresses.map((addr: any) => (
                  <Card key={addr.id} className="border border-border bg-white rounded-2xl shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary/30 rounded-xl flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-foreground text-sm">{addr.fullName}</p>
                            {addr.isDefault && (
                              <span className="text-[10px] bg-accent/10 text-primary px-1.5 py-0.5 rounded">افتراضي</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{addr.city}، {addr.address}</p>
                          <p className="text-xs text-muted-foreground">{addr.phone}</p>
                        </div>
                        <button
                          onClick={() => startEdit(addr)}
                          className="p-1.5 text-muted-foreground hover:text-primary hover:bg-accent/10 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteAddress.mutate({ id: addr.id })}
                          disabled={deleteAddress.isPending}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}

              {showForm ? (
                <Card className="border border-border bg-white rounded-2xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    {[
                      { key: "fullName", label: "الاسم الكامل", placeholder: "أحمد محمد" },
                      { key: "phone", label: "رقم الهاتف", placeholder: "+966501234567" },
                      { key: "city", label: "المدينة", placeholder: "الرياض" },
                      { key: "address", label: "العنوان التفصيلي", placeholder: "الشارع والحي" },
                    ].map((f) => (
                      <div key={f.key}>
                        <label className="text-xs font-bold text-foreground block mb-1">{f.label}</label>
                        <Input
                          placeholder={f.placeholder}
                          value={(form as any)[f.key]}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                          className="border-border bg-secondary/20 h-10 text-sm focus:ring-2 focus:ring-primary rounded-lg"
                        />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-xs font-bold text-foreground pt-1">
                      <input
                        type="checkbox"
                        checked={form.isDefault}
                        onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                        className="accent-primary w-4 h-4"
                      />
                      تعيين كعنوان افتراضي
                    </label>
                    <div className="flex gap-2 pt-1">
                      <Button onClick={handleSave} disabled={saving}
                        className="flex-1 bg-primary text-white hover:bg-primary/90 font-bold h-10 rounded-lg">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingId ? "حفظ التعديل" : "حفظ")}
                      </Button>
                      <Button variant="outline" onClick={resetForm} className="flex-1 border-border h-10 rounded-lg">
                        إلغاء
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Button
                  onClick={startAdd}
                  className="w-full h-14 bg-foreground text-background hover:bg-foreground/90 font-bold text-sm rounded-xl gap-2"
                >
                  <Plus className="w-4 h-4" /> إضافة عنوان جديد
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
