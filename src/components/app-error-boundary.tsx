import React from "react";
import { logAppError, installErrorLogger } from "@/lib/error-logger";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface State { error: Error | null }

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logAppError({
      type: "react_render_error",
      message: error.message,
      stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
      gravite: "critique",
    });
    reportLovableError(error, { boundary: "app_error_boundary" });
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="font-display text-2xl">Une erreur est survenue</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              L'incident a été enregistré automatiquement. Merci de réessayer.
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorLoggerBootstrap() {
  React.useEffect(() => { installErrorLogger(); }, []);
  return null;
}
