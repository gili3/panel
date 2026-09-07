import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Eye, Loader2, ShoppingBag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/formatters";
import { useAuth } from "@/_core/hooks/useAuth";
// ✅ إصلاح: ألوان/تسميات حالة الطلب أصبحت من مصدر واحد موحّد بدل تعريف
// محلي مكرَّر بألوان مختلفة عن باقي صفحات الموقع (راجع lib/orderStatus.ts)
import { getOrderStatusConfig } from "@/lib/orderStatus";

export default function Orders() {
  const { user, loading: authLoading } = useAuth();
  const { data: orders = [], isLoading: ordersLoading } = trpc.firestore.getOrders.useQuery(
    undefined,
    { enabled: !!user }
  );
  const isLoading = authLoading || ordersLoading;

  if (!authLoading && !user) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
          <p className="text-muted-foreground">سجّل الدخول لعرض طلباتك</p>
          <Link href="/login">
            <a>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                تسجيل الدخول
              </Button>
            </a>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-12 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2" style={{ fontFamily: 'Georgia, serif' }}>
            طلباتي
          </h1>
          <div className="w-12 h-1 bg-primary rounded-full mb-3"></div>
          <p className="text-muted-foreground text-sm">تتبع جميع طلباتك وحالتها</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-40">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
          </div>
        ) : orders.length > 0 ? (
          <div className="space-y-3">
            {orders.map((order: any) => {
              const statusConfig = getOrderStatusConfig(order.status);
              const date = order.createdAt?.toDate
                ? order.createdAt.toDate()
                : new Date(order.createdAt);
              const itemCount = order.items?.length || 0;
              const total =
                order.total ||
                order.items?.reduce(
                  (s: number, i: any) => s + i.price * i.quantity, 0
                ) || 0;

              return (
                <Link key={order.id} href={`/order/${order.id}`}>
                  <a className="block group">
                    <Card className="border-border bg-card hover:shadow-md hover:border-primary/30 transition-all overflow-hidden cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-bold text-foreground text-sm">
                                طلب #{order.orderNumber}
                              </span>
                              <Badge
                                style={statusConfig.style}
                                className="border-0 font-semibold text-xs px-2 py-0.5"
                              >
                                {statusConfig.label}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {formatDate(date)}
                            </p>
                            {itemCount > 0 && (
                              <p className="text-xs text-muted-foreground">
                                عدد المنتجات: {itemCount}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {total > 0 && (
                              <span className="font-bold text-primary text-sm">
                                {total} ج.س
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-primary hover:text-primary/80 hover:bg-accent/10"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </a>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card className="border-border bg-card">
            <CardContent className="py-20 text-center">
              <div className="w-24 h-24 bg-accent/10 border-2 border-primary rounded-full flex items-center justify-center mx-auto mb-6">
                <ShoppingBag className="w-12 h-12 text-primary" />
              </div>
              <h2
                className="text-3xl font-bold text-foreground mb-3"
                style={{ fontFamily: 'Georgia, serif' }}
              >
                لا توجد طلبات بعد
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                ابدأ التسوق الآن واستمتع بمنتجاتنا الرائعة والمختارة بعناية
              </p>
              <Link href="/products">
                <a>
                  <Button
                    size="lg"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2"
                  >
                    <ShoppingBag className="w-5 h-5" />
                    ابدأ التسوق
                  </Button>
                </a>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
