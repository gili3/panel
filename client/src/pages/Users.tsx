import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminGuard from "@/components/AdminGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, ShieldCheck, ShieldOff, Ban, CheckCircle2 } from "lucide-react";
import { ADMIN_PERMISSIONS, ADMIN_PERMISSION_LABELS, type AdminPermission } from "@shared/adminPermissions";

type AdminUserRow = {
  uid: string;
  email: string | null;
  name: string | null;
  disabled: boolean;
  role: "admin" | "user";
  isSuperAdmin: boolean;
  adminPermissions: string[];
};

function PermissionsDialog({
  targetUser,
  onClose,
}: {
  targetUser: AdminUserRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<AdminPermission[]>(
    (targetUser.adminPermissions as AdminPermission[]) ?? []
  );

  const setAdminStatus = trpc.adminUsers.setAdminStatus.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث صلاحيات المستخدم");
      utils.adminUsers.getUsers.invalidate();
      utils.adminUsers.listAdmins.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });
  const updatePermissions = trpc.adminUsers.updateAdminPermissions.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ الصلاحيات");
      utils.adminUsers.getUsers.invalidate();
      utils.adminUsers.listAdmins.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  const togglePermission = (perm: AdminPermission) => {
    setSelected((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSave = () => {
    if (targetUser.role === "admin") {
      updatePermissions.mutate({ uid: targetUser.uid, permissions: selected });
    } else {
      setAdminStatus.mutate({ uid: targetUser.uid, isAdmin: true, permissions: selected });
    }
  };

  const isPending = setAdminStatus.isPending || updatePermissions.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {targetUser.role === "admin" ? "تعديل صلاحيات" : "ترقية لأدمن"} — {targetUser.email || targetUser.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {ADMIN_PERMISSIONS.map((perm) => (
            <label key={perm} className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={selected.includes(perm)}
                onCheckedChange={() => togglePermission(perm)}
              />
              <span className="text-sm">{ADMIN_PERMISSION_LABELS[perm]}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between items-center pt-2">
          {targetUser.role === "admin" && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => setAdminStatus.mutate({ uid: targetUser.uid, isAdmin: false })}
            >
              إزالة صلاحية الأدمن
            </Button>
          )}
          <Button onClick={handleSave} disabled={isPending} className="mr-auto">
            {isPending ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
            حفظ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UsersContent({ user }: { user: { isSuperAdmin?: boolean } }) {
  const utils = trpc.useUtils();
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [searchEmail, setSearchEmail] = useState("");
  const [permissionsTarget, setPermissionsTarget] = useState<AdminUserRow | null>(null);

  const { data, isLoading } = trpc.adminUsers.getUsers.useQuery(
    { pageToken: pageTokens[pageIndex] },
    { enabled: !searchEmail }
  );
  const { data: searchResult, isFetching: isSearching } = trpc.adminUsers.findUserByEmail.useQuery(
    { email: searchEmail },
    { enabled: searchEmail.length > 3 && searchEmail.includes("@") }
  );

  const setUserDisabled = trpc.adminUsers.setUserDisabled.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث حالة الحساب");
      utils.adminUsers.getUsers.invalidate();
      utils.adminUsers.findUserByEmail.invalidate();
    },
    onError: (err) => toast.error(err.message || "حدث خطأ"),
  });

  const rows: AdminUserRow[] = searchEmail
    ? (searchResult ? [searchResult as AdminUserRow] : [])
    : ((data?.users ?? []) as AdminUserRow[]);

  const goNext = () => {
    if (!data?.nextPageToken) return;
    setPageTokens((prev) => [...prev.slice(0, pageIndex + 1), data.nextPageToken]);
    setPageIndex((i) => i + 1);
  };
  const goPrev = () => {
    if (pageIndex === 0) return;
    setPageIndex((i) => i - 1);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <CardTitle>إدارة المستخدمين</CardTitle>
        <div className="relative w-full sm:w-64">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ابحث ببريد إلكتروني كامل..."
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            className="pr-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {(isLoading || isSearching) ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>البريد الإلكتروني</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الدور</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.uid}>
                    <TableCell className="font-medium">{row.email || "-"}</TableCell>
                    <TableCell>{row.name || "-"}</TableCell>
                    <TableCell>
                      {row.isSuperAdmin ? (
                        <span className="text-primary font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-4 h-4" /> صاحب المتجر
                        </span>
                      ) : row.role === "admin" ? (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-4 h-4" /> أدمن
                        </span>
                      ) : (
                        <span className="text-muted-foreground">مستخدم</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.disabled ? (
                        <span className="text-destructive text-sm">محظور</span>
                      ) : (
                        <span className="text-emerald-600 text-sm">نشط</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {user.isSuperAdmin && !row.isSuperAdmin && (
                          <Button variant="ghost" size="sm" onClick={() => setPermissionsTarget(row)}>
                            {row.role === "admin" ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                            {row.role === "admin" ? " الصلاحيات" : " ترقية لأدمن"}
                          </Button>
                        )}
                        {!row.isSuperAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={row.disabled ? "text-emerald-600" : "text-destructive"}
                            disabled={setUserDisabled.isPending}
                            onClick={() => setUserDisabled.mutate({ uid: row.uid, disabled: !row.disabled })}
                          >
                            {row.disabled ? <CheckCircle2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                            {row.disabled ? " فك الحظر" : " حظر"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!searchEmail && (
              <div className="flex justify-center gap-2 pt-4">
                <Button variant="outline" size="sm" onClick={goPrev} disabled={pageIndex === 0}>
                  السابق
                </Button>
                <Button variant="outline" size="sm" onClick={goNext} disabled={!data?.nextPageToken}>
                  التالي
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">لا يوجد مستخدمون</div>
        )}
      </CardContent>
      {permissionsTarget && (
        <PermissionsDialog targetUser={permissionsTarget} onClose={() => setPermissionsTarget(null)} />
      )}
    </Card>
  );
}

export default function Users() {
  return (
    <AdminGuard activeKey="users">
      {(user) => <UsersContent user={user} />}
    </AdminGuard>
  );
}
