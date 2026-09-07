import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Menu, Search, ShoppingCart, Heart, User, LogOut, ShoppingBag, X, Home, Phone, Info, Bell } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import NotificationBell from "@/components/NotificationBell";
import { searchProducts, isAlgoliaConfigured } from "@/lib/algolia";

export default function Header() {
  const { user, logout, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ─────────────────────────────────────────────────────────────────────
  // 🔎 اقتراحات فورية (autocomplete) أثناء الكتابة — عبر Algolia فقط
  // (لا بديل محلي هنا لأن جلب كل الكتالوج فقط لعرض اقتراحات مكلف وغير
  // منطقي؛ بغياب Algolia تبقى تجربة "Enter للانتقال لصفحة النتائج" كما هي).
  // ─────────────────────────────────────────────────────────────────────
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const showSuggestions = isAlgoliaConfigured && isSearchOpen && debouncedQuery.length >= 2;
  const { data: suggestions = [] } = useQuery({
    queryKey: ["header-search-suggestions", debouncedQuery],
    queryFn: () => searchProducts({ query: debouncedQuery, hitsPerPage: 5 }),
    enabled: showSuggestions,
    staleTime: 30_000,
  });

  const goToProduct = (productId: string) => {
    setLocation(`/product/${productId}`);
    setSearchQuery("");
    setIsSearchOpen(false);
  };
  
  const { data: cartItems = [] } = trpc.firestore.getCart.useQuery(undefined, { enabled: !!user });
  const { data: storeSettings } = trpc.firestore.getStoreSettings.useQuery();
  const cartCount = cartItems.reduce((sum: number, item: any) => sum + item.quantity, 0);
  const storeName = storeSettings?.storeName || "Eleven";

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/products?q=${encodeURIComponent(searchQuery)}`);
      setSearchQuery("");
      setIsSearchOpen(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  // جميع روابط القائمة الجانبية
  const navLinks = [
    { label: "الرئيسية", href: "/", icon: <Home className="w-5 h-5" /> },
    { label: "المفضلة", href: "/favorites", icon: <Heart className="w-5 h-5" /> },
    { label: "طلباتي", href: "/orders", icon: <ShoppingBag className="w-5 h-5" /> },
    { label: "الملف الشخصي", href: "/profile", icon: <User className="w-5 h-5" /> },
    { label: "الإشعارات", href: "/notifications", icon: <Bell className="w-5 h-5" /> },
    { label: "الإعدادات", href: "/settings", icon: <Info className="w-5 h-5" /> },
    { label: "اتصل بنا", href: "/contact", icon: <Phone className="w-5 h-5" /> },
    { label: "حول", href: "/about", icon: <Info className="w-5 h-5" /> },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 md:h-20 items-center justify-between px-3 md:px-4">
        {/* ===== RIGHT SIDE (Menu + Cart) ===== */}
        <div className="flex items-center gap-3 md:gap-6">
          {/* Menu (Hamburger) */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="p-1.5 md:p-2 hover:bg-accent/10">
                <Menu className="w-5 h-5 text-foreground" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-80 p-0 text-right dir-rtl bg-background overflow-y-auto">
              <div className="flex flex-col h-full">
                {/* Sidebar Header with Logo */}
                <div className="p-6 border-b border-border bg-gradient-to-br from-primary/10 to-primary/5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl font-bold text-primary-foreground" style={{ fontFamily: 'Georgia, serif' }}>11</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-primary tracking-widest">ELEVEN</p>
                      <p className="text-xs text-muted-foreground mt-1">أهلاً بك في Eleven</p>
                    </div>
                  </div>
                </div>

                {/* Navigation Links - كل الروابط متتالية */}
                <nav className="flex-1 p-4">
                  <div className="flex flex-col gap-1">
                    {navLinks.map((link) => (
                      <Link key={link.href} href={link.href}>
                        <a
                          className="flex items-center gap-3 text-sm font-medium text-foreground hover:text-primary hover:bg-accent/5 rounded-lg px-3 py-3 transition-colors"
                          onClick={() => setIsOpen(false)}
                        >
                          {link.icon}
                          <span>{link.label}</span>
                        </a>
                      </Link>
                    ))}
                  </div>
                </nav>

                {/* تسجيل الخروج - في أسفل الصفحة */}
                {user ? (
                  <div className="p-4 border-t border-border">
                    <Button
                      variant="outline"
                      size="default"
                      onClick={handleLogout}
                      className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30 rounded-lg"
                    >
                      <LogOut className="w-5 h-5 ml-2" />
                      تسجيل الخروج
                    </Button>
                  </div>
                ) : (
                  <div className="p-4 border-t border-border">
                    <Button
                      size="lg"
                      className="w-full font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
                      onClick={() => {
                        setLocation("/login");
                        setIsOpen(false);
                      }}
                    >
                      تسجيل الدخول
                    </Button>
                    <p className="text-center text-xs text-muted-foreground mt-3">أهلاً بك في {storeName}</p>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Cart */}
          <Link href="/cart">
            <a className="relative p-2 text-foreground hover:text-primary transition-colors hover:bg-accent/5 rounded-lg">
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && (
                <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs bg-primary text-white rounded-full font-bold">
                  {cartCount > 99 ? "99+" : cartCount}
                </Badge>
              )}
            </a>
          </Link>
        </div>

        {/* ===== CENTER: Logo ===== */}
        <Link href="/">
          <a className="flex flex-col items-center gap-0 font-bold hover:opacity-80 transition-opacity">
            <span className="text-2xl md:text-3xl" style={{ fontFamily: 'Georgia, serif', color: 'var(--primary)' }}>11</span>
            <span className="text-xs tracking-widest" style={{ color: 'var(--primary)' }}>ELEVEN</span>
          </a>
        </Link>

        {/* ===== LEFT SIDE (Favorites + Search + User) ===== */}
        <div className="flex items-center gap-3 md:gap-6">
          {/* Notifications */}
          {user && <NotificationBell />}

          {/* Search */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className="p-2 text-foreground hover:text-primary transition-colors hover:bg-accent/5 rounded-lg"
          >
            {isSearchOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Search className="w-5 h-5" />
            )}
          </button>

          {/* User (Desktop) */}
          {loading ? (
            <div className="hidden md:block w-8 h-8 bg-muted rounded-full animate-pulse" />
          ) : user ? (
            <div className="hidden md:flex items-center gap-3">
              <Link href="/profile">
                <a className="p-2 text-foreground hover:text-primary transition-colors hover:bg-accent/5 rounded-lg">
                  <User className="w-5 h-5" />
                </a>
              </Link>
              <Link href="/settings">
                <a className="p-2 text-foreground hover:text-primary transition-colors hover:bg-accent/5 rounded-lg" title="الإعدادات">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </a>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-foreground hover:text-primary flex-row-reverse hover:bg-accent/5 rounded-lg"
              >
                <LogOut className="w-4 h-4 mr-2" />
                تسجيل الخروج
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="hidden md:inline-flex bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
              onClick={() => setLocation("/login")}
            >
              تسجيل الدخول
            </Button>
          )}
        </div>
      </div>

      {/* Search Bar - Expandable */}
      {isSearchOpen && (
        <div className="border-t border-border bg-card px-3 md:px-4 py-3 animate-in fade-in slide-in-from-top-2">
          <form onSubmit={handleSearch} className="container">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="ابحث عن منتجات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full px-4 py-2.5 pl-10 pr-4 rounded-lg border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-right"
              />
              <button
                type="submit"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  {suggestions.map((hit) => (
                    <button
                      key={hit.objectID}
                      type="button"
                      onClick={() => goToProduct(hit.objectID)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-right hover:bg-muted transition-colors"
                    >
                      {hit.imageUrl && (
                        <img src={hit.imageUrl} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
                      )}
                      <span className="text-sm text-foreground truncate">{hit.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>
      )}
    </header>
  );
}