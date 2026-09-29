/**
 * أدوات تحسين الأداء والتحميل الكسول
 */

/**
 * تحميل الصور بشكل كسول (Lazy Loading)
 */
export function setupImageLazyLoading(): void {
  if ("IntersectionObserver" in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const src = img.dataset.src;
          
          if (src) {
            img.src = src;
            img.removeAttribute("data-src");
            observer.unobserve(img);
          }
        }
      });
    });

    // مراقبة جميع الصور ذات data-src
    document.querySelectorAll("img[data-src]").forEach((img) => {
      imageObserver.observe(img);
    });
  }
}

/**
 * تحسين الأداء من خلال تقليل حجم الصور
 */
export function getOptimizedImageUrl(
  url: string,
  _width: number = 400,
  _height: number = 400
): string {
  // إذا كانت الصورة من Firebase Storage، يمكنك إضافة معاملات التحسين
  if (url.includes("firebasestorage.googleapis.com")) {
    // يمكنك استخدام Firebase Image Optimization
    // أو إضافة معاملات مخصصة
    return url;
  }
  
  return url;
}

/**
 * قياس أداء الصفحة
 */
export function measurePagePerformance(): void {
  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          console.log(`${entry.name}: ${entry.duration}ms`);
        }
      });

      observer.observe({ entryTypes: ["measure", "navigation"] });
    } catch {
      console.warn("Performance monitoring not available");
    }
  }
}

/**
 * تحسين الأداء من خلال Debouncing
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * تحسين الأداء من خلال Throttling
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * تحسين الأداء من خلال Memoization
 */
export function memoize<T extends (...args: any[]) => any>(func: T): T {
  const cache = new Map();

  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = func(...args);
    cache.set(key, result);

    return result;
  }) as T;
}

/**
 * تحميل مسبق للموارد (Preload)
 */
export function preloadResource(url: string, type: "image" | "script" | "style" = "image"): void {
  const link = document.createElement("link");
  link.rel = "preload";
  link.href = url;
  
  switch (type) {
    case "image":
      link.as = "image";
      break;
    case "script":
      link.as = "script";
      break;
    case "style":
      link.as = "style";
      break;
  }

  document.head.appendChild(link);
}

/**
 * تحسين الأداء من خلال تقليل حجم الحزم
 * استخدم Code Splitting و Dynamic Imports
 */
export async function dynamicImport<T>(
  importFn: () => Promise<{ default: T }>
): Promise<T> {
  const module = await importFn();
  return module.default;
}
