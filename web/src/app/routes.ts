import { useEffect, useState } from "react";

export type AppRoute = "/" | "/setup" | "/game" | "/rules" | "/load" | "/settings";

const ROUTES = new Set<AppRoute>(["/", "/setup", "/game", "/rules", "/load", "/settings"]);

export function routeFromPathname(pathname: string): AppRoute {
  return ROUTES.has(pathname as AppRoute) ? (pathname as AppRoute) : "/";
}

export function navigateTo(route: AppRoute, replace = false): void {
  if (typeof window === "undefined") return;
  if (replace) {
    window.history.replaceState({}, "", route);
  } else {
    window.history.pushState({}, "", route);
  }
  window.scrollTo({ left: 0, top: 0 });
  window.dispatchEvent(new Event("popstate"));
}

export function useAppRoute(): [AppRoute, (route: AppRoute, replace?: boolean) => void] {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined" ? "/" : routeFromPathname(window.location.pathname),
  );

  useEffect(() => {
    const update = () => setRoute(routeFromPathname(window.location.pathname));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  return [route, navigateTo];
}
