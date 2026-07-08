import { useEffect, useState } from "react";

export type AppRoute = "/" | "/setup" | "/game" | "/rules" | "/load" | "/settings";

const ROUTES = new Set<AppRoute>(["/", "/setup", "/game", "/rules", "/load", "/settings"]);
const REDIRECT_PATH_KEY = "assalto:redirect-path";

function basePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  if (base === "/" || base === "./") return "/";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}

function stripBase(pathname: string): string {
  const base = basePath();
  if (base === "/") return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length) || "/";
  return pathname;
}

function routeHref(route: AppRoute): string {
  const base = basePath();
  if (base === "/") return route;
  return route === "/" ? `${base}/` : `${base}${route}`;
}

function consumeStaticRedirect(): string | null {
  if (typeof window === "undefined") return null;
  const redirected = window.sessionStorage.getItem(REDIRECT_PATH_KEY);
  if (!redirected) return null;
  window.sessionStorage.removeItem(REDIRECT_PATH_KEY);
  return redirected;
}

export function routeFromPathname(pathname: string): AppRoute {
  const route = stripBase(pathname);
  return ROUTES.has(route as AppRoute) ? (route as AppRoute) : "/";
}

export function navigateTo(route: AppRoute, replace = false): void {
  if (typeof window === "undefined") return;
  if (replace) {
    window.history.replaceState({}, "", routeHref(route));
  } else {
    window.history.pushState({}, "", routeHref(route));
  }
  window.scrollTo({ left: 0, top: 0 });
  window.dispatchEvent(new Event("popstate"));
}

export function useAppRoute(): [AppRoute, (route: AppRoute, replace?: boolean) => void] {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === "undefined") return "/";
    const redirected = consumeStaticRedirect();
    if (redirected) {
      const nextRoute = routeFromPathname(new URL(redirected, window.location.origin).pathname);
      window.history.replaceState({}, "", routeHref(nextRoute));
      return nextRoute;
    }
    return routeFromPathname(window.location.pathname);
  });

  useEffect(() => {
    const update = () => setRoute(routeFromPathname(window.location.pathname));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  return [route, navigateTo];
}
