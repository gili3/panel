import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "./ui/button";
import { reportPanelError } from "@/lib/errorReporter";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    // ✅ إضافة (بطلب الأدمن): أي خطأ React حقيقي يوقف عرض جزء من الصفحة
    // (وليس فقط خطأ سكريبت عام يمسكه window.onerror) يُسجَّل هنا أيضاً.
    reportPanelError(error.message, { stack: error.stack, severity: "error" });
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8 bg-background rounded-lg border border-dashed border-destructive/30">
          <div className="flex flex-col items-center w-full max-w-2xl text-center">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl font-bold mb-2">عذراً، حدث خطأ غير متوقع</h2>
            <p className="text-muted-foreground mb-6">لقد واجهنا مشكلة في تحميل هذا الجزء من الصفحة.</p>

            {process.env.NODE_ENV === 'development' && (
              <div className="p-4 w-full rounded bg-muted overflow-auto mb-6 text-right" dir="ltr">
                <pre className="text-xs text-muted-foreground whitespace-break-spaces">
                  {this.state.error?.message}
                  {this.state.error?.stack}
                </pre>
              </div>
            )}

            <div className="flex gap-4">
              <Button
                onClick={this.resetError}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RotateCcw size={16} />
                محاولة مرة أخرى
              </Button>
              <Button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2"
              >
                تحديث الصفحة بالكامل
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
