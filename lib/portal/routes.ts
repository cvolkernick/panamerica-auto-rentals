export type FunctionRoutes = {
  version: number;
  include: string[];
  exclude: string[];
};

/** Pages `_routes.json` patterns: `*` matches any remainder, and exclude wins. */
export function routePatternMatches(pathname: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(pathname);
}

export function functionsInvokedFor(pathname: string, routes: FunctionRoutes): boolean {
  const included = routes.include.some((pattern) => routePatternMatches(pathname, pattern));
  if (!included) return false;
  return !routes.exclude.some((pattern) => routePatternMatches(pathname, pattern));
}
