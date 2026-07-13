import { AppRouter } from "./AppRouter";
import { ErrorBoundary } from "./ErrorBoundary";
import "../styles/errorFallback.css";

export function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  );
}
