import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg shadow-lg border-border bg-card">
        <div className="h-1 bg-primary"></div>
        <CardContent className="pt-12 pb-12 text-center">
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 rounded-full bg-destructive/10 border-2 border-destructive flex items-center justify-center">
              <AlertCircle className="w-12 h-12 text-destructive" />
            </div>
          </div>

          <h1 className="text-6xl font-bold text-foreground mb-3" style={{ fontFamily: 'Georgia, serif' }}>
            404
          </h1>

          <h2 className="text-2xl font-bold text-foreground mb-4">
            الصفحة غير موجودة
          </h2>

          <p className="text-muted-foreground mb-10 leading-relaxed max-w-sm mx-auto">
            عذراً، الصفحة التي تبحث عنها غير موجودة. قد تكون قد تم نقلها أو حذفها.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={handleGoHome}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 px-8 py-6 rounded-lg transition-all duration-200"
            >
              <Home className="w-5 h-5" />
              العودة للرئيسية
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-8">
            إذا استمرت المشكلة، يرجى <a href="mailto:support@eleven.com" className="text-primary hover:text-primary/80 font-semibold">التواصل معنا</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
