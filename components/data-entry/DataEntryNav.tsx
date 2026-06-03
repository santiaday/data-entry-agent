'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/lib/hooks/use-auth';

const BASE_ITEMS = [
  { href: '/data-entry', label: 'Dashboard', exact: true },
  { href: '/data-entry/search', label: 'Search', exact: false },
] as const;

export function DataEntryNav() {
  const pathname = usePathname() ?? '/data-entry';
  const perms = usePermissions();
  const p = perms.modules.data_entry;

  const items = [
    ...BASE_ITEMS,
    ...(p.can_view_analytics ? [{ href: '/data-entry/analytics', label: 'Analytics', exact: false }] : []),
    ...(p.can_edit_fields ? [{ href: '/data-entry/fields', label: 'Fields', exact: false }] : []),
    ...(p.can_edit_prompts ? [{ href: '/data-entry/prompts', label: 'Prompts', exact: false }] : []),
  ];

  return (
    <nav className="flex gap-1">
      {items.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              isActive
                ? 'bg-emerald-100 text-emerald-800'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
