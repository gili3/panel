import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLocation, useParams, Link } from "wouter";
import { Heart, Share2, ChevronLeft, Loader2, ShoppingCart, ShoppingBag } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatNumber } from "@/lib/formatters";

interface Props { params?: { id: string } }

export default function ProductDetail({ params }: Props = {}) {
  const [, setLocation] = useLocation();
  const routeParams = useParams();
  const productId = params?.id || routeParams?.id;

  const [selectedImage, setSelectedImage] = useState(0);

  const { data: product, isLoading, error } = trpc.firestore.getProduct.useQuery(
    { id: productId || "" }, { enabled: !!productId }
  );
  const { data: favorites = [] } = trpc.firestore.getFavorites.useQuery();
  const utils = trpc.useUtils();

  const addToCart = trpc.firestore.addToCart.useMutation({
    onSuccess: () => { toast.success("تمت الإضافة إلى السلة 🛒"); utils.firestore.getCart.invalidate(); },
    onError: (err: any) => toast.error(err.message || "فشل في الإضافة"),
  });

  const toggleFav = trpc.firestore.toggleFavorite.useMutation({
    onSuccess: (data: any) => { toast.success(data.favorited ? "✨ تمت الإضافة للمفضلة" : "تمت الإزالة من المفضلة"); utils.firestore.getFavorites.invalidate(); },
  });

  const isFav = favorites.some((f: any) => f.productId === productId);
  const images = product?.images?.length ? product.images : (product?.image ? [product.image] : []);
  const discount = product?.originalPrice && product.originalPrice > product.price
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100) : 0;

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: product?.name, text: `${product?.name} - ${product?.price} ج.س`, url: window.location.href }).catch(() => {
        // ✅ إصلاح: navigator.share() يرفض الـPromise (AbortError) عند إلغاء
        // المستخدم لنافذة المشاركة نفسها — وهو سلوك طبيعي متوقَّع وليس خطأً،
        // فلا داعي لعرض أي رسالة خطأ للمستخدم بسببه.
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("تم نسخ الرابط");
    }
  };

  const isOutOfStock = (product?.stock ?? 0) <= 0;

  const handleAddToCart = () => {
    if (!product || isOutOfStock) return;
    addToCart.mutate({ productId: product.id, quantity: 1, price: product.price, name: product.name, image: images[0] || "" });
  };

  const handleBuyNow = () => {
    if (!product || isOutOfStock) return;
    // ✅ شراء الآن: ينتقل مباشرة للدفع بدون لمس السلة (نفس سلوك التطبيق)
    setLocation(`/checkout?buyNow=1&productId=${product.id}&quantity=1`);
  };

  if (isLoading) return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-40 gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground">جاري تحميل المنتج...</p>
      </div>
    </Layout>
  );

  if (error || !product) return (
    <Layout>
      <div className="container py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">المنتج غير موجود</h2>
        <Link href="/products"><a><Button className="bg-primary text-white">العودة للمتجر</Button></a></Link>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="min-h-screen bg-white pb-32">
        {/* Back + Actions — like APK TopAppBar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-border sticky top-0 z-10">
          <button onClick={() => window.history.back()} className="p-2 rounded-full hover:bg-secondary/30">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-foreground truncate max-w-[180px]" style={{ fontFamily: "Georgia, serif" }}>
            {product.name}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={handleShare} className="p-2 rounded-full hover:bg-secondary/30">
              <Share2 className="w-5 h-5 text-primary" />
            </button>
            <button onClick={() => toggleFav.mutate({ productId: product.id })} className="p-2 rounded-full hover:bg-secondary/30">
              <Heart className={`w-5 h-5 ${isFav ? "fill-red-500 text-red-500" : "text-primary"}`} />
            </button>
          </div>
        </div>

        {/* ── Image Gallery (matches APK) ── */}
        <div className="relative bg-gray-50" style={{ height: "380px" }}>
          <img
            src={images[selectedImage] || "https://via.placeholder.com/400"}
            alt={product.name}
            className="w-full h-full object-cover"
          />
          {/* Thumbnail row at bottom like APK */}
          {images.length > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 px-4">
              {images.map((img: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${selectedImage === i ? "border-foreground" : "border-transparent"}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Product Info (matches APK ProductDetailContent) ── */}
        <div className="px-6 py-6">
          {/* Badge */}
          <div className="flex items-center gap-3 mb-4">
            <div className="px-3 py-1 rounded-lg text-xs font-bold text-destructive-foreground bg-destructive">
              {product.isNew ? "جديد" : product.isOnSale ? "عرض خاص" : product.isBestSeller ? "الأكثر مبيعاً" : "مميز"}
            </div>
          </div>

          {/* Name */}
          <h1 className="text-2xl font-bold text-foreground mb-3" style={{ fontFamily: "Georgia, serif" }}>
            {product.name}
          </h1>

          {/* Price row like APK */}
          <div className="flex items-baseline gap-3 mb-5">
            <span className="text-2xl font-extrabold text-primary">{formatNumber(product.price)} ج.س</span>
            {product.originalPrice && product.originalPrice > product.price && (
              <>
                <span className="text-lg text-muted-foreground line-through">{formatNumber(product.originalPrice)} ج.س</span>
                <span className="text-xs font-bold text-white bg-primary px-2 py-0.5 rounded">-{discount}%</span>
              </>
            )}
          </div>

          <div className="border-t border-border my-5" />

          {/* Description like APK */}
          <h3 className="font-bold text-lg mb-2">الوصف</h3>
          <p className="text-muted-foreground leading-relaxed text-sm">
            {product.description || "تتميز هذه القطعة بتصميم أنيق وعصري يتناسب مع جميع الأذواق."}
          </p>

          <div className="border-t border-border my-5" />

          {/* حالة التوفر — اختيار الكمية أصبح من السلة فقط */}
          <h3 className="font-bold text-base mb-2">التوفر</h3>
          {isOutOfStock ? (
            <p className="text-sm font-bold text-red-500">نفذت الكمية من المخزون</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              متوفر في المخزون
              {typeof product.stock === "number" && product.stock <= 5 && (
                <span className="text-orange-500 font-semibold"> (بقي {product.stock} فقط)</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Fixed Bottom Buttons ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-border px-6 py-4 z-50">
        <div className="container max-w-3xl mx-auto grid grid-cols-2 gap-6">
          <Button
            onClick={handleAddToCart}
            disabled={addToCart.isPending || isOutOfStock}
            className="h-16 bg-foreground text-background hover:bg-foreground/90 font-bold text-lg rounded-2xl gap-3 disabled:opacity-50"
          >
            <ShoppingCart className="w-6 h-6" /> {isOutOfStock ? "نفذت الكمية" : "أضف للسلة"}
          </Button>
          <Button
            onClick={handleBuyNow}
            disabled={addToCart.isPending || isOutOfStock}
            className="h-16 bg-primary text-white hover:bg-primary/90 font-bold text-lg rounded-2xl disabled:opacity-50"
          >
            شراء الآن
          </Button>
        </div>
      </div>
    </Layout>
  );
}