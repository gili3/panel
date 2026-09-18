// ELEVEN STORE — سجل تحذيرات النظام (لوحة التحكم فقط، ليست إشعارات تجارية)
// ─────────────────────────────────────────────────────────────────────────
// ✅ إضافة: كان firestoreConnectionStatus.ts مخصصاً فقط لفشل اتصال Firestore
// المباشر، ويُعرض كبانر مستقل بأعلى كل صفحة. بطلب الأدمن: كل تحذيرات النظام
// (لا فرق مصدرها) يجب أن تظهر بمكان واحد مخصّص بدل بانر لكل نوع عطل على
// حدة. هذا الملف يعمّم الفكرة: أي جزء بالتطبيق يسجّل تحذيره بمعرّف ثابت
// (id)، ويُعرض الكل معاً بلوحة SystemWarningsCenter.tsx (أيقونة بالهيدر،
// نفس نمط جرس الإشعارات). التحذير يُمسح تلقائياً حين يُستدعى clearSystemWarning
// بنفس الـid (تعافي فعلي)، أو يدوياً من المستخدم عبر dismiss.
//
// هذا **ليس** بديلاً لـuseAdminAlerts/useNotifications (تلك إشعارات تجارية:
// طلب جديد، رسالة تواصل، مخزون منخفض...) — هذا فقط لأعطال تقنية بالتطبيق
// نفسه يحتاج الأدمن معرفتها (فشل App Check، فشل اتصال حي، إلخ).
import { useEffect, useState } from "react";

export type SystemWarningSeverity = "warning" | "error";

export interface SystemWarning {
  id: string; // معرّف ثابت لكل مصدر تحذير — تسجيل جديد بنفس الـid يستبدل القديم لا يضيف نسخة ثانية
  title: string;
  message: string;
  severity: SystemWarningSeverity;
  dismissible: boolean;
  at: number; // Date.now()
}

const warnings = new Map<string, SystemWarning>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function reportSystemWarning(
  id: string,
  data: { title: string; message: string; severity?: SystemWarningSeverity; dismissible?: boolean }
): void {
  warnings.set(id, {
    id,
    title: data.title,
    message: data.message,
    severity: data.severity ?? "warning",
    dismissible: data.dismissible ?? true,
    at: Date.now(),
  });
  notify();
}

/** يُستدعى عند تعافي المصدر فعلياً (مثلاً: onSnapshot نجح من جديد). */
export function clearSystemWarning(id: string): void {
  if (warnings.delete(id)) notify();
}

/** يُستدعى حين يُخفي المستخدم تحذيراً يدوياً (dismissible فقط) — يعود لو تكرر العطل من جديد. */
export function dismissSystemWarning(id: string): void {
  const w = warnings.get(id);
  if (w?.dismissible) {
    warnings.delete(id);
    notify();
  }
}

export function useSystemWarnings(): SystemWarning[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return Array.from(warnings.values()).sort((a, b) => b.at - a.at);
}
