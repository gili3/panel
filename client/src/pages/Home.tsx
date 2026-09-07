import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Loader2, ShoppingBag, ShoppingCart, Heart } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatNumber } from "@/lib/formatters";

/* ── Product Card — مطابقة تماماً لـ HomeProductCard في التطبيق ──
   - شارة الخصم أعلى يمين الصورة
   - زر المفضلة أعلى يسار الصورة (ظاهر دائماً، بدون hover)
   - زر إضافة للسلة أسفل يمين معلومات المنتج (ظاهر دائماً، بدون hover)          */
function ProductCard({ product, onAddToCart, isFavorite, onToggleFavorite }: {
  product: any; onAddToCart: (p: any) => void; isFavorite: boolean; onToggleFavorite: (id: string) => void;
}) {
  const discount = product.originalPrice && product.originalPrice > product.price
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;
  const outOfStock = (product.stock ?? 0) <= 0;
  return (
    <Link href={`/product/${product.id}`}>
      <a className="group block">
        <div className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md border border-gray-100 hover:border-primary/30 transition-all">
          {/* Square image like APK */}
          <div className="relative w-full aspect-square overflow-hidden bg-gray-50">
            <img
              src={product.images?.[0] || product.image || "https://via.placeholder.com/400"}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            {discount > 0 && (
              <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-0.5 rounded text-xs font-bold">
                -{discount}%
              </div>
            )}
            {/* زر المفضلة — شفاف الخلفية، أعلى يسار — موحّد مع باقي البطاقات */}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(product.id); }}
              className="absolute top-2 left-2 bg-transparent p-1 flex items-center justify-center"
              aria-label="المفضلة"
            >
              <Heart className={`w-5 h-5 drop-shadow-md ${isFavorite ? "fill-red-500 text-red-500" : "fill-white/30 text-white"}`} />
            </button>
          </div>
          {/* Info like APK */}
          <div className="p-2.5">
            <h3 className="font-bold text-foreground text-xs line-clamp-1 mb-1">{product.name}</h3>
            <div className="flex items-end justify-between gap-1">
              <div className="flex flex-col">
                <span className="text-sm font-extrabold text-primary">{formatNumber(product.price)} ج.س</span>
                {product.originalPrice && product.originalPrice > product.price && (
                  <span className="text-xs text-muted-foreground line-through">{formatNumber(product.originalPrice)}</span>
                )}
              </div>
              {/* زر إضافة للسلة — ظاهر دائماً، أسفل يمين — مطابق للتطبيق */}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!outOfStock) onAddToCart(product); }}
                disabled={outOfStock}
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${outOfStock ? "bg-muted-foreground/40" : "bg-primary hover:bg-primary/90"}`}
                aria-label="أضف للسلة"
              >
                <ShoppingCart className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      </a>
    </Link>
  );
}

/* ── Section Header (matches APK SectionHeader exactly) ── */
function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex justify-between items-center px-4 pt-6 pb-3">
      <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>{title}</h2>
      <Link href={href}>
        <a className="flex items-center gap-1 text-primary text-sm font-bold hover:text-primary/80">
          عرض المزيد <ArrowRight className="w-4 h-4" />
        </a>
      </Link>
    </div>
  );
}

/* ── Category Item (matches APK CategoryItem exactly) ── */
function CategoryItem({ category }: { category: any }) {
  return (
    <Link href={`/products?category=${category.id}`}>
      <a className="flex flex-col items-center gap-1.5 flex-shrink-0">
        <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
          {category.image
            ? <img src={category.image} alt={category.name} className="w-full h-full object-cover" />
            : <ShoppingBag className="w-6 h-6 text-muted-foreground" />
          }
        </div>
        <span className="text-xs font-medium text-center text-foreground w-16 truncate">{category.name}</span>
      </a>
    </Link>
  );
}

/* ── Brand Card (matches APK BrandCard exactly) ── */
function BrandCard({ brand }: { brand: any }) {
  return (
    <Link href={`/products?filter=brands&brand=${brand.id}`}>
      <a className="flex-shrink-0 w-24 h-24 bg-white rounded-xl border border-border shadow-sm hover:shadow-md flex items-center justify-center p-3 transition-all">
        <img src={brand.logo} alt={brand.name} className="w-full h-full object-contain" />
      </a>
    </Link>
  );
}

/* ── Product Row (matches APK ProductRow — horizontal scroll of 3) ── */
function ProductRow({ products, onAddToCart, favoriteIds, onToggleFavorite }: {
  products: any[]; onAddToCart: (p: any) => void; favoriteIds: Set<string>; onToggleFavorite: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2 px-4">
      <div className="flex gap-3" style={{ minWidth: "max-content" }}>
        {products.slice(0, 3).map((p: any) => (
          <div key={p.id} style={{ width: "160px" }}>
            <ProductCard
              product={p}
              onAddToCart={onAddToCart}
              isFavorite={favoriteIds.has(p.id)}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const utils = trpc.useUtils();

  const { data: banners = [], isLoading: isBannersLoading } = trpc.firestore.getBanners.useQuery();
  const { data: categories = [] } = trpc.firestore.getCategories.useQuery();
  const { data: featuredProducts = [] } = trpc.firestore.getProducts.useQuery({ isFeatured: true });
  const { data: newArrivals = [] } = trpc.firestore.getProducts.useQuery({ isNew: true });
  const { data: bestSellers = [] } = trpc.firestore.getProducts.useQuery({ isBestSeller: true });
  const { data: onSaleProducts = [] } = trpc.firestore.getProducts.useQuery({ onSale: true });
  const { data: brands = [] } = trpc.firestore.getBrands.useQuery();
  const { data: favorites = [] } = trpc.firestore.getFavorites.useQuery();
  const favoriteIds = new Set<string>((favorites as any[]).map((f: any) => f.productId));

  const addToCart = trpc.firestore.addToCart.useMutation({
    onSuccess: () => { toast.success("تمت الإضافة إلى السلة 🛒"); utils.firestore.getCart.invalidate(); },
    onError: (err: any) => toast.error(err.message || "فشل في الإضافة"),
  });

  const toggleFavorite = trpc.firestore.toggleFavorite.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.favorited ? "✨ تمت الإضافة للمفضلة" : "🗑️ تمت الإزالة من المفضلة");
      utils.firestore.getFavorites.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "حدث خطأ"),
  });

  const handleAddToCart = (p: any) => {
    addToCart.mutate({ productId: p.id, quantity: 1, price: p.price, name: p.name, image: p.images?.[0] || p.image || "" });
  };

  const handleToggleFavorite = (productId: string) => {
    toggleFavorite.mutate({ productId });
  };

  // Auto-slide banner like APK (5 seconds)
  useEffect(() => {
    if (banners.length === 0) return;
    const t = setInterval(() => setCurrentSlide(prev => (prev + 1) % banners.length), 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  return (
    <Layout>
      {/* ── 1. Banner Slider (matches APK BannerSlider) ── */}
      <div className="relative mx-4 mt-3 rounded-2xl overflow-hidden bg-secondary" style={{ height: "200px" }}>
        {isBannersLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : banners.length > 0 ? (
          <>
            {banners.map((b: any, i: number) => (
              <div key={b.id} className={`absolute inset-0 transition-opacity duration-1000 ${i === currentSlide ? "opacity-100" : "opacity-0"}`}>
                {b.image && <img src={b.image} alt={b.title} className="w-full h-full object-cover" />}
                <div className="absolute inset-0 bg-gradient-to-l from-black/50 to-transparent" />
              </div>
            ))}
            {/* Banner Text like APK */}
            <div className="absolute inset-0 flex items-center px-5">
              <div className="text-white max-w-xs">
                <h1 className="text-xl font-bold leading-tight mb-1" style={{ fontFamily: "Georgia, serif" }}>
                  {banners[currentSlide]?.title}
                </h1>
                <p className="text-xs text-white/85 mb-3 line-clamp-2">{banners[currentSlide]?.description}</p>
                <Link href="/products">
                  <Button size="sm" className="bg-primary text-white hover:bg-primary/90 font-bold rounded-lg px-4 text-xs h-8">
                    {banners[currentSlide]?.cta || "تسوق الآن"}
                  </Button>
                </Link>
              </div>
            </div>
            {/* Dot indicators like APK */}
            {banners.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {banners.map((_: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`الانتقال إلى الشريحة ${i + 1} من ${banners.length}`}
                    aria-current={i === currentSlide}
                    className={`transition-all rounded-full h-1.5 ${i === currentSlide ? "w-5 bg-primary" : "w-1.5 bg-white/60"}`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-start px-6 h-full bg-gradient-to-l from-primary/80 to-primary text-white">
            <div>
              <h1 className="text-xl font-bold mb-1" style={{ fontFamily: "Georgia, serif" }}>مرحباً في Eleven</h1>
              <p className="text-xs mb-3 text-white/85">اكتشف مجموعتنا الحصرية</p>
              <Link href="/products"><Button size="sm" className="bg-white text-primary hover:bg-white/90 font-bold text-xs h-8">تسوق الآن</Button></Link>
            </div>
          </div>
        )}
      </div>

      {/* ── 2. Categories (matches APK — horizontal scroll of 4) ── */}
      {categories.length > 0 && (
        <div>
          <div className="flex justify-between items-center px-4 pt-6 pb-3">
            <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>التصنيفات</h2>
            <Link href="/products"><a className="text-primary text-sm font-bold flex items-center gap-1">عرض المزيد <ArrowRight className="w-4 h-4" /></a></Link>
          </div>
          <div className="overflow-x-auto pb-2 px-4">
            <div className="flex gap-4" style={{ minWidth: "max-content" }}>
              {categories.slice(0, 4).map((cat: any) => (
                <CategoryItem key={cat.id} category={cat} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 3. On Sale ── */}
      {onSaleProducts.length > 0 && (
        <div>
          <SectionHeader title="العروض والخصومات" href="/products?filter=onSale" />
          <ProductRow products={onSaleProducts} onAddToCart={handleAddToCart} favoriteIds={favoriteIds} onToggleFavorite={handleToggleFavorite} />
        </div>
      )}

      {/* ── 4. Featured ── */}
      {featuredProducts.length > 0 && (
        <div>
          <SectionHeader title="المنتجات المميزة" href="/products?filter=featured" />
          <ProductRow products={featuredProducts} onAddToCart={handleAddToCart} favoriteIds={favoriteIds} onToggleFavorite={handleToggleFavorite} />
        </div>
      )}

      {/* ── 5. Best Sellers ── */}
      {bestSellers.length > 0 && (
        <div>
          <SectionHeader title="الأكثر مبيعاً" href="/products?filter=bestSeller" />
          <ProductRow products={bestSellers} onAddToCart={handleAddToCart} favoriteIds={favoriteIds} onToggleFavorite={handleToggleFavorite} />
        </div>
      )}

      {/* ── 6. New Arrivals ── */}
      {newArrivals.length > 0 && (
        <div>
          <SectionHeader title="المنتجات الجديدة" href="/products?filter=new" />
          <ProductRow products={newArrivals} onAddToCart={handleAddToCart} favoriteIds={favoriteIds} onToggleFavorite={handleToggleFavorite} />
        </div>
      )}

      {/* ── 7. Brands (matches APK — horizontal scroll) ── */}
      {brands.length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between items-center px-4 pt-6 pb-3">
            <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "Georgia, serif" }}>العلامات التجارية</h2>
            <Link href="/products?filter=brands"><a className="text-primary text-sm font-bold flex items-center gap-1">عرض المزيد <ArrowRight className="w-4 h-4" /></a></Link>
          </div>
          <div className="overflow-x-auto pb-2 px-4">
            <div className="flex gap-3" style={{ minWidth: "max-content" }}>
              {brands.slice(0, 3).map((b: any) => (
                <BrandCard key={b.id} brand={b} />
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
