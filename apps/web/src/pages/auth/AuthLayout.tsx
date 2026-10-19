import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full">
      {/* Marketing panel is decorative; it collapses away below lg. */}
      <div className="hidden w-1/2 flex-col justify-between bg-slate-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-xs font-bold">
            OS
          </span>
          <span className="font-semibold tracking-tight">OutreachOS</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-snug">
            From ideal customer profile to a tracked, multichannel campaign.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Describe who you want to reach, qualify the leads that match, draft messages grounded
            in what you actually know about each prospect, and run the sequence across email and
            LinkedIn with one shared lead state.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-400">
            <li>· Approval before send, on by default</li>
            <li>· Follow-ups stop the moment someone replies or opts out</li>
            <li>· Every lead carries its source, consent basis and retention date</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          Authorized integrations only. No scraping, no credential sharing.
        </p>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">
              OS
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
