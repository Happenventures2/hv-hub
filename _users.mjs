/**
 * _users.mjs — HV Hub per-user tab config
 *
 * ARCHITECTURE: email is the filter key everywhere.
 * Universal tabs (Home / Tasks / HV Bot / Tools) appear for ALL users.
 * roleTabs are rendered dynamically per user on dropdown switch.
 *
 * Usage (in index.html JS):
 *   import { USER_CONFIG } from './_users.mjs';
 *   OR inline the USER_CONFIG object directly (used in single-file index.html).
 */

export const USER_CONFIG = {

  'jessica@happenventures.com': {
    slug: 'jess',
    name: 'Jess Gonzalez',
    role: 'solutions-admin',
    subtitle: 'Solutions Admin',
    initials: 'JG',
    roleTabs: [
      { tab: 'deals',  icon: 'handshake', label: 'Deals' },
      { tab: 'olivia', icon: 'smart_toy', label: 'Olivia' },
    ],
    viewAsToggle: true,   // can impersonate other users
  },

  'joan@happenventures.com': {
    slug: 'joan',
    name: 'Joan Moya',
    role: 'r3-laundry',
    subtitle: 'R3 · Laundry',
    initials: 'JM',
    roleTabs: [
      { tab: 'sites',    icon: 'store',      label: 'Sites' },
      { tab: 'partners', icon: 'handshake',  label: 'Partners' },
      { tab: 'robin',    icon: 'smart_toy',  label: 'Robin' },
    ],
  },

  'celi@happenventures.com': {
    slug: 'celi',
    name: 'Celi',
    role: 'r3-amazon',
    subtitle: 'R3 · Amazon',
    initials: 'CE',
    roleTabs: [
      { tab: 'sites',    icon: 'store',      label: 'Sites' },
      { tab: 'partners', icon: 'handshake',  label: 'Partners' },
      { tab: 'robin',    icon: 'smart_toy',  label: 'Robin' },
    ],
    // Amazon-specific data filter applied server-side via ?email=celi@happenventures.com
  },

  'mario@happenventures.com': {
    slug: 'mario',
    name: 'Mario',
    role: 'junk-pm',
    subtitle: 'Junk PM',
    initials: 'MA',
    roleTabs: [
      { tab: 'junk-pipeline',  icon: 'delete_forever', label: 'Junk Pipeline' },
      { tab: 'cold-outreach',  icon: 'call',           label: 'Cold Outreach' },
    ],
  },

  'danny@happenventures.com': {
    slug: 'danny',
    name: 'Danny',
    role: 'donations-pm',
    subtitle: 'Donations PM',
    initials: 'DA',
    roleTabs: [
      { tab: 'donations-pipeline', icon: 'volunteer_activism', label: 'Donations Pipeline' },
      { tab: 'routes',             icon: 'route',              label: 'Routes' },
    ],
  },

  'milos@happenventures.com': {
    slug: 'milos',
    name: 'Milos',
    role: 'recycle-pm',
    subtitle: 'Recycle PM',
    initials: 'MI',
    roleTabs: [
      { tab: 'recycle-pipeline', icon: 'recycling', label: 'Recycle Pipeline' },
    ],
  },

  'ivan@happenventures.com': {
    slug: 'ivan',
    name: 'Ivan',
    role: 'cgo-sales',
    subtitle: 'CGO · Sales',
    initials: 'IV',
    roleTabs: [
      { tab: 'sales-pipeline',  icon: 'trending_up',   label: 'Sales Pipeline' },
      { tab: 'sales-outreach',  icon: 'outgoing_mail', label: 'Outreach' },
    ],
  },

  'farid@happenventures.com': {
    slug: 'farid',
    name: 'Farid',
    role: 'product-admin',
    subtitle: 'Product Admin',
    initials: 'FA',
    roleTabs: [
      { tab: 'build-queue',    icon: 'build',          label: 'Build Queue' },
      { tab: 'agents',         icon: 'smart_toy',      label: 'Agents' },
      { tab: 'system-health',  icon: 'monitor_heart',  label: 'System Health' },
    ],
    viewAsToggle: true,   // can view-as any user
  },

};

/**
 * UNIVERSAL TABS — same for every user, don't change:
 *   Home / Tasks / HV Bot / Tools
 *
 * TASKS TAB is always dynamic:
 *   /api/tasks?email=X filters by owner — every new user automatically inherits this.
 *   Never hardcode task data to a specific user.
 *
 * ROLE TABS — each tab maps to a data-panel=\"<tab>\" section in index.html.
 *   If a panel hasn't been built yet, stub it with a \"Coming soon\" placeholder.
 *
 * FILTER KEY: email is used everywhere data is fetched.
 *   currentUserEmail() → passed to all API calls, bot context, activity feed, etc.
 */
