import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0C11] text-[#F4F4F6] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#14151C] border border-[#EF4444]/50 rounded-lg p-5 space-y-3">
            <h1 className="text-base font-bold text-[#FCA5A5]">Rustren Studio encountered an error</h1>
            <p className="text-xs text-[#A1A1AA] font-mono break-words">{this.state.message}</p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('rustren_studio_autosave_v1');
                  } catch {
                    // ignore
                  }
                  window.location.reload();
                }}
                className="px-3 py-1.5 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] text-xs font-bold"
              >
                Reset Autosave &amp; Reload
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded bg-[#252634] hover:bg-[#323446] text-xs text-white"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
