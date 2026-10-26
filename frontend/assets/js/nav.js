/** Navigation model shared by the sidebar, mobile nav and router guards. */
export const primaryNav = [
  { id: 'dashboard', label: 'Overview', href: '#/dashboard', icon: 'dashboard', phase: 1 },
  { id: 'bots', label: 'My Bots', href: '#/bots', icon: 'bot', phase: 2 },
  { id: 'commands', label: 'Commands', href: '#/bots/:botId/commands', icon: 'terminal', botScoped: true, phase: 3 },
  { id: 'workflows', label: 'Automations', href: '#/bots/:botId/workflows', icon: 'workflow', botScoped: true, phase: 4 },
  { id: 'builder', label: 'Visual Builder', href: '#/bots/:botId/builder', icon: 'canvas', botScoped: true, phase: 4 },
  { id: 'simulator', label: 'Testing Lab', href: '#/bots/:botId/simulator', icon: 'flask', botScoped: true, phase: 5 },
  { id: 'executions', label: 'Execution Logs', href: '#/bots/:botId/executions', icon: 'logs', botScoped: true, phase: 6 },
];

export const secondaryNav = [
  { id: 'account', label: 'Account Settings', href: '#/settings', icon: 'user', phase: 1 },
];

export const mobileNav = [
  { id: 'dashboard', label: 'Overview', href: '#/dashboard', icon: 'dashboard' },
  { id: 'bots', label: 'Bots', href: '#/bots', icon: 'bot' },
  { id: 'workflows', label: 'Automations', href: '#/bots/:botId/workflows', icon: 'workflow', botScoped: true },
  { id: 'simulator', label: 'Testing', href: '#/bots/:botId/simulator', icon: 'flask', botScoped: true },
  { id: 'executions', label: 'Logs', href: '#/bots/:botId/executions', icon: 'logs', botScoped: true },
];

/** Resolve a nav entry to a concrete hash, substituting the active bot id. */
export function resolveHref(href, botId) {
  if (!href.includes(':botId')) return href;
  if (!botId) return null;
  return href.replace(':botId', encodeURIComponent(botId));
}

export function resolveNav(items, botId) {
  return items.map((item) => {
    const resolved = resolveHref(item.href, botId);
    return { ...item, href: resolved, disabled: Boolean(item.botScoped && !resolved) };
  });
}
