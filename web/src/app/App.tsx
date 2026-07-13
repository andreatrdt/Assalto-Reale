import { AppRouter } from "./AppRouter";
import { ErrorBoundary } from "./ErrorBoundary";
import { AccountProvider } from "../account/AccountProvider";
import "../styles/errorFallback.css";

export function App() {
  return (
    <ErrorBoundary>
      <AccountProvider>
        <AppRouter />
      </AccountProvider>
    </ErrorBoundary>
  );
}
