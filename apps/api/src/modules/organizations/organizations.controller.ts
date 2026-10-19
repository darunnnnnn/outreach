import type { Request, Response } from 'express';
import type {
  AuditLogQuery,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
} from '@outreach/shared';
import { requireRequestContext } from '../../http/context';
import { validatedQuery } from '../../http/middleware/validate';
import * as service from './organizations.service';

export async function getCurrent(req: Request, res: Response): Promise<void> {
  res.json(await service.getCurrent(requireRequestContext(req.ctx)));
}

export async function updateCurrent(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  res.json(await service.updateCurrent(ctx, req.body as UpdateOrganizationInput));
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  res.json({ data: await service.listMembers(requireRequestContext(req.ctx)) });
}

export async function updateMemberRole(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  const { role } = req.body as UpdateMemberRoleInput;
  const members = await service.updateMemberRole(ctx, req.params.userId as string, role);
  res.json({ data: members });
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  await service.removeMember(ctx, req.params.userId as string);
  res.status(204).end();
}

export async function transferOwnership(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  const { userId } = req.body as TransferOwnershipInput;
  res.json({ data: await service.transferOwnership(ctx, userId) });
}

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  res.json(await service.listAuditLogs(ctx, validatedQuery<AuditLogQuery>(req)));
}
