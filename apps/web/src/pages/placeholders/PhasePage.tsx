import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/AppShell';
import { Card, EmptyState } from '../../components/ui';

export interface PhasePageProps {
  title: string;
  description: string;
  phase: number;
  /** What the finished screen will do — the acceptance criteria, in user terms. */
  capabilities: string[];
  /** What must land before this screen can work. */
  dependsOn?: string[];
}

/**
 * Routed, navigable placeholder for a screen a later phase delivers. These exist
 * so the shell is demonstrably complete and reviewable now: the navigation,
 * layout and empty states are real, and each phase replaces a page body rather
 * than inventing a new route and a new layout.
 */
export function PhasePage({ title, description, phase, capabilities, dependsOn }: PhasePageProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <span className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
            Phase {phase}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <EmptyState
            title={`Delivered in Phase ${phase}`}
            description="Nothing is stubbed behind this screen: the route, navigation and layout are real, and the feature lands here when its phase ships."
            action={
              <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
                Back to dashboard
              </Link>
            }
          />
        </Card>

        <div className="space-y-6">
          <Card title="What this screen will do">
            <ul className="space-y-2 text-sm text-slate-600">
              {capabilities.map((capability) => (
                <li key={capability}>· {capability}</li>
              ))}
            </ul>
          </Card>

          {dependsOn && dependsOn.length > 0 && (
            <Card title="Depends on">
              <ul className="space-y-2 text-sm text-slate-600">
                {dependsOn.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
