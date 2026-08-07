import { CAPABILITIES, capabilitiesFor } from '@/lib/capabilities/registry';
import { loadSpaces, overviewSnapshot } from '@/lib/data/aggregate';
import { getWorkspace } from '@/lib/data/store';
import { conversation } from '@/lib/ai/assistant';
import { activeProvider } from '@/lib/ai/providers';
import { ASSISTANT_SUGGESTIONS, COMPANY_SUGGESTIONS } from '@/lib/ai/prompts';
import { isIconName } from '@/components/ui/Icon';
import { ShellFrame } from '@/components/shell/ShellFrame';
import type { Command } from '@/components/shell/CommandPalette';
import { Rail } from '@/components/shell/Rail';
import { Strip } from '@/components/shell/Strip';

/**
 * The workspace lives on the local filesystem and every mutation is a Server
 * Action, so nothing here can be prerendered at build time.
 */
export const dynamic = 'force-dynamic';

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const [workspace, spaces, snapshot] = await Promise.all([
    getWorkspace(),
    loadSpaces(),
    overviewSnapshot(),
  ]);

  const provider = await activeProvider();
  const initialMessages = (await conversation({ kind: 'founder' })).slice(-8);

  const commands = buildCommands(workspace.companies.map((c) => ({ id: c.id, name: c.name })), workspace.personal.displayName);

  const companyNames = Object.fromEntries(workspace.companies.map((c) => [c.id, c.name]));

  // Counted from the spaces already loaded for the rail rather than by re-reading
  // every scope file: the shell renders on every navigation.
  const approvalsWaiting = spaces.reduce(
    (sum, space) => sum + space.data.toolCalls.filter((call) => call.status === 'awaiting-approval').length,
    0,
  );

  return (
    <ShellFrame
      commands={commands}
      rail={
        <Rail
          spaces={spaces}
          openSuggestions={snapshot.openSuggestions}
          upgradesAwaiting={snapshot.upgradesAwaiting}
          approvalsWaiting={approvalsWaiting}
        />
      }
      strip={<Strip snapshot={snapshot} />}
      copilot={{
        assistantName: workspace.settings.assistantName,
        providerLabel: provider.label,
        providerSimulated: provider.simulated,
        initialMessages,
        companyNames,
        personalName: workspace.personal.displayName,
        suggestions: ASSISTANT_SUGGESTIONS,
        companySuggestions: COMPANY_SUGGESTIONS,
      }}
    >
      {children}
    </ShellFrame>
  );
}

/**
 * Every destination in the OS, flattened for ⌘K.
 *
 * Built from the same registry the navigation and routing use, so a new
 * capability becomes searchable without anyone remembering to add it here.
 */
function buildCommands(
  companies: ReadonlyArray<{ id: string; name: string }>,
  personalName: string,
): Command[] {
  const commands: Command[] = [
    { id: 'home', label: 'Home', group: 'OS', href: '/', icon: 'home', keywords: 'overview today' },
    { id: 'mission-control', label: 'Mission Control', group: 'OS', href: '/mission-control', icon: 'pulse', keywords: 'live activity pending decisions running' },
    { id: 'timeline', label: 'Timeline', group: 'OS', href: '/timeline', icon: 'clock', keywords: 'history audit trail events log' },
    { id: 'brain', label: 'Brain — memory & intelligence', group: 'OS', href: '/brain', icon: 'brain', keywords: 'memory learned' },
    { id: 'assistant', label: 'Assistant', group: 'OS', href: '/assistant', icon: 'assistant', keywords: 'chat ai copilot' },
    { id: 'companies', label: 'All companies', group: 'OS', href: '/companies', icon: 'building' },
    { id: 'new-company', label: 'Create a company', group: 'OS', href: '/companies/new', icon: 'plus', keywords: 'new add start' },
    { id: 'life', label: `${personalName} · Life`, group: 'OS', href: '/life', icon: 'life', keywords: 'personal private' },
    { id: 'intel', label: 'AI Intelligence Center', group: 'Systems', href: '/intelligence', icon: 'telescope', keywords: 'discoveries models ecosystem' },
    { id: 'upgrades', label: 'Safe Upgrade Pipeline', group: 'Systems', href: '/intelligence/upgrades', icon: 'shield', keywords: 'approve reject test' },
    { id: 'reports', label: 'Learning Reports', group: 'Systems', href: '/intelligence/reports', icon: 'file', keywords: 'daily weekly monthly' },
    { id: 'studio', label: 'Creative Studio', group: 'Systems', href: '/studio', icon: 'sparkle', keywords: 'images video ads brand' },
    { id: 'factory', label: 'AI Product Factory', group: 'Systems', href: '/factory', icon: 'factory', keywords: 'idea product plan' },
    { id: 'finance', label: 'Finance Center', group: 'Systems', href: '/finance', icon: 'coins', keywords: 'money cash revenue' },
    { id: 'automations', label: 'Automation Platform', group: 'Systems', href: '/automations', icon: 'bolt', keywords: 'workflow trigger' },
    { id: 'settings', label: 'Settings', group: 'OS', href: '/settings', icon: 'settings', keywords: 'theme data reset' },
  ];

  for (const capability of CAPABILITIES) {
    commands.push({
      id: `cap:${capability.id}`,
      label: `${capability.name} — across every space`,
      group: 'Capability',
      href: `/capabilities/${capability.id}`,
      icon: isIconName(capability.icon) ? capability.icon : 'gear',
      keywords: capability.tagline,
    });
  }

  for (const company of companies) {
    commands.push({
      id: `space:${company.id}`,
      label: company.name,
      group: 'Company',
      href: `/companies/${company.id}`,
      icon: 'building',
    });
    commands.push({
      id: `space:${company.id}:dna`,
      label: `${company.name} · DNA`,
      group: 'Company',
      href: `/companies/${company.id}/dna`,
      icon: 'diamond',
    });
    commands.push({
      id: `space:${company.id}:team`,
      label: `${company.name} · Team`,
      group: 'Company',
      href: `/companies/${company.id}/team`,
      icon: 'users',
      keywords: 'agents roster hire specialists',
    });
    for (const capability of capabilitiesFor('company')) {
      commands.push({
        id: `space:${company.id}:${capability.id}`,
        label: `${company.name} · ${capability.name}`,
        group: 'Company',
        href: `/companies/${company.id}/${capability.id}`,
        icon: isIconName(capability.icon) ? capability.icon : 'gear',
      });
    }
  }

  commands.push({
    id: 'life:dna',
    label: `${personalName} · Personal DNA`,
    group: 'Life',
    href: '/life/dna',
    icon: 'diamond',
  });
  commands.push({
    id: 'life:team',
    label: `${personalName} · Team`,
    group: 'Life',
    href: '/life/team',
    icon: 'users',
    keywords: 'agents roster hire coach',
  });
  for (const capability of capabilitiesFor('personal')) {
    commands.push({
      id: `life:${capability.id}`,
      label: `${personalName} · ${capability.namePersonal ?? capability.name}`,
      group: 'Life',
      href: `/life/${capability.id}`,
      icon: isIconName(capability.icon) ? capability.icon : 'gear',
    });
  }

  return commands;
}
