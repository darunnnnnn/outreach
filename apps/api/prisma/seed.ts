/**
 * Seed data for local development. Idempotent: safe to run repeatedly.
 *
 *   npm run db:seed
 *
 * Creates one organisation with a user in each role, plus a pending invitation
 * and a couple of audit entries, so every Phase 1 screen has something to show.
 * Passwords are weak on purpose and the script refuses to run against
 * NODE_ENV=production.
 */
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

const ORG_NAME = 'Nordwind Textiles';
const ORG_SLUG = 'nordwind-textiles-demo';
const PASSWORD = 'DemoPassword123';

const PEOPLE: Array<{ email: string; name: string; role: Role }> = [
  { email: 'owner@example.com', name: 'Ava Lindqvist', role: 'OWNER' },
  { email: 'admin@example.com', name: 'Marco Bellini', role: 'ADMIN' },
  { email: 'member@example.com', name: 'Priya Raghunathan', role: 'MEMBER' },
  { email: 'viewer@example.com', name: 'Tomas Novak', role: 'VIEWER' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      timezone: 'Europe/Berlin',
      settings: {
        // A placeholder ICP so the Phase 2 audience builder has a starting point.
        defaultIcp: {
          industries: ['Textile manufacturing', 'Home textile export'],
          countries: ['DE', 'NL'],
          employeeBands: ['20-50', '51-200', '201-500'],
          jobTitles: ['Export Manager', 'Procurement Manager', 'Managing Director'],
        },
      },
    },
  });

  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { role: person.role },
      create: { userId: user.id, organizationId: organization.id, role: person.role },
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });

  // A pending invitation with a known token, so the accept screen can be opened
  // locally without reading the mail log.
  const inviteToken = 'seed-invitation-token-for-local-development';
  const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
  const pending = await prisma.invitation.findFirst({
    where: { organizationId: organization.id, email: 'invited@example.com', status: 'PENDING' },
  });
  if (pending) {
    await prisma.invitation.update({
      where: { id: pending.id },
      data: { tokenHash, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
  } else {
    await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        email: 'invited@example.com',
        role: 'MEMBER',
        tokenHash,
        invitedById: owner.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
  }

  const auditCount = await prisma.auditLog.count({ where: { organizationId: organization.id } });
  if (auditCount === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId: organization.id,
          actorUserId: owner.id,
          action: 'auth.registered',
          targetType: 'organization',
          targetId: organization.id,
          metadata: { organizationName: ORG_NAME, seeded: true },
        },
        {
          organizationId: organization.id,
          actorUserId: owner.id,
          action: 'invitation.created',
          targetType: 'invitation',
          targetId: 'seed',
          metadata: { email: 'invited@example.com', role: 'MEMBER', seeded: true },
        },
      ],
    });
  }

  console.log('Seed complete.');
  console.log(`  Organization : ${ORG_NAME} (${organization.id})`);
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(6)}       : ${p.email} / ${PASSWORD}`);
  console.log(`  Invite link  : /accept-invite?token=${inviteToken}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
