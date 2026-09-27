import React, { createContext, useContext, useState, useEffect } from "react";

type Lang = "ar" | "en";

const translations: Record<Lang, Record<string, string>> = {
  ar: {
    // Navigation
    "home": "الرئيسية",
    "products": "المنتجات",
    "categories": "التصنيفات",
    "favorites": "المفضلة",
    "cart": "السلة",
    "orders": "طلباتي",
    "profile": "الملف الشخصي",
    "notifications": "الإشعارات",
    "settings": "الإعدادات",
    "about": "حول",
    "contact": "اتصل بنا",
    "logout": "تسجيل الخروج",
    "login": "تسجيل الدخول",
    "register": "إنشاء حساب",
    // Products
    "add_to_cart": "أضف للسلة",
    "buy_now": "شراء الآن",
    "add_to_favorites": "إضافة للمفضلة",
    "remove_from_favorites": "إزالة من المفضلة",
    "in_stock": "متوفر",
    "out_of_stock": "غير متوفر",
    "quantity": "الكمية",
    "price": "السعر",
    "discount": "خصم",
    "free_shipping": "شحن مجاني",
    "description": "الوصف",
    "search": "بحث",
    "search_placeholder": "ابحث عن منتج...",
    "all_categories": "جميع الفئات",
    "view_all": "عرض الكل",
    "view_more": "عرض المزيد",
    "no_products": "لا توجد منتجات",
    // Cart
    "cart_empty": "سلتك فارغة",
    "order_summary": "ملخص الطلب",
    "subtotal": "المجموع الفرعي",
    "shipping": "الشحن",
    "total": "الإجمالي",
    "coupon_code": "كود الخصم",
    "apply": "تطبيق",
    "checkout": "إتمام الطلب",
    "continue_shopping": "متابعة التسوق",
    // Orders
    "order_number": "رقم الطلب",
    "order_status": "حالة الطلب",
    "order_date": "تاريخ الطلب",
    "under_review": "قيد المراجعة",
    "processing": "قيد التجهيز",
    "out_for_delivery": "قيد التوصيل",
    "delivered": "تم التسليم",
    "cancelled": "ملغي",
    "payment_failed": "دفع فاشل",
    // Auth
    "email": "البريد الإلكتروني",
    "password": "كلمة المرور",
    "confirm_password": "تأكيد كلمة المرور",
    "full_name": "الاسم الكامل",
    "phone": "رقم الهاتف",
    "forgot_password": "نسيت كلمة المرور؟",
    "reset_password": "استعادة كلمة المرور",
    // Settings
    "language": "اللغة",
    "appearance": "المظهر",
    "dark_mode": "الوضع الداكن",
    "account_management": "إدارة الحساب",
    "change_password": "تغيير كلمة المرور",
    "delete_account": "حذف الحساب",
    "privacy_security": "الخصوصية والأمان",
    // Misc
    "loading": "جاري التحميل...",
    "error": "حدث خطأ",
    "retry": "إعادة المحاولة",
    "save": "حفظ",
    "cancel": "إلغاء",
    "confirm": "تأكيد",
    "delete": "حذف",
    "edit": "تعديل",
    "add": "إضافة",
    "version": "النسخة",
  },
  en: {
    // Navigation
    "home": "Home",
    "products": "Products",
    "categories": "Categories",
    "favorites": "Favorites",
    "cart": "Cart",
    "orders": "My Orders",
    "profile": "Profile",
    "notifications": "Notifications",
    "settings": "Settings",
    "about": "About",
    "contact": "Contact Us",
    "logout": "Sign Out",
    "login": "Sign In",
    "register": "Create Account",
    // Products
    "add_to_cart": "Add to Cart",
    "buy_now": "Buy Now",
    "add_to_favorites": "Add to Favorites",
    "remove_from_favorites": "Remove from Favorites",
    "in_stock": "In Stock",
    "out_of_stock": "Out of Stock",
    "quantity": "Quantity",
    "price": "Price",
    "discount": "Discount",
    "free_shipping": "Free Shipping",
    "description": "Description",
    "search": "Search",
    "search_placeholder": "Search for a product...",
    "all_categories": "All Categories",
    "view_all": "View All",
    "view_more": "View More",
    "no_products": "No products found",
    // Cart
    "cart_empty": "Your cart is empty",
    "order_summary": "Order Summary",
    "subtotal": "Subtotal",
    "shipping": "Shipping",
    "total": "Total",
    "coupon_code": "Coupon Code",
    "apply": "Apply",
    "checkout": "Checkout",
    "continue_shopping": "Continue Shopping",
    // Orders
    "order_number": "Order #",
    "order_status": "Order Status",
    "order_date": "Order Date",
    "under_review": "Under Review",
    "processing": "Processing",
    "out_for_delivery": "Out for Delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "payment_failed": "Payment Failed",
    // Auth
    "email": "Email",
    "password": "Password",
    "confirm_password": "Confirm Password",
    "full_name": "Full Name",
    "phone": "Phone Number",
    "forgot_password": "Forgot Password?",
    "reset_password": "Reset Password",
    // Settings
    "language": "Language",
    "appearance": "Appearance",
    "dark_mode": "Dark Mode",
    "account_management": "Account Management",
    "change_password": "Change Password",
    "delete_account": "Delete Account",
    "privacy_security": "Privacy & Security",
    // Misc
    "loading": "Loading...",
    "error": "An error occurred",
    "retry": "Retry",
    "save": "Save",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "delete": "Delete",
    "edit": "Edit",
    "add": "Add",
    "version": "Version",
  },
};

interface LangContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
  dir: "rtl" | "ltr";
}

const LanguageContext = createContext<LangContextType>({
  lang: "ar",
  setLang: () => {},
  t: (k) => k,
  dir: "rtl",
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem("app_lang") as Lang) || "ar";
  });

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem("app_lang", lang);
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);
  const t = (key: string) => translations[lang][key] || key;
  const dir: "rtl" | "ltr" = lang === "ar" ? "rtl" : "ltr";

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
