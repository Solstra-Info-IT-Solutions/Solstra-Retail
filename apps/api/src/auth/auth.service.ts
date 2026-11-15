import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { Tenant, TenantDocument } from '../tenants/schemas/tenant.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { RequestPasswordChangeDto } from './dto/request-password-change.dto';
import { RegistrationApprovalRequest, PasswordChangeApprovalRequest } from './schemas/identity-approval.schema';
import { randomBytes } from 'crypto';

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Tenant.name) private readonly tenants: Model<TenantDocument>,
    @InjectModel(RegistrationApprovalRequest.name) private readonly registrationRequests: Model<any>,
    @InjectModel(PasswordChangeApprovalRequest.name) private readonly passwordChangeRequests: Model<any>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.registrationRequests.collection.dropIndex('expiresAt_1').catch(() => undefined);
    await Promise.all([this.registrationRequests.createIndexes(), this.passwordChangeRequests.createIndexes()]);
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const now = new Date();
    await this.registrationRequests.updateMany({ email, status: 'PENDING_APPROVAL', expiresAt: { $lte: now } }, { $set: { status: 'EXPIRED' }, $unset: { passwordHash: 1, expiresAt: 1 } });
    if (await this.users.exists({ email }) || await this.registrationRequests.exists({ email, status: 'PENDING_APPROVAL', expiresAt: { $gt: now } })) {
      throw new ConflictException('An account or pending registration with this email already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    try {
      if (dto.gstRegistered && dto.gstin?.slice(0, 2) !== dto.stateCode) {
        throw new BadRequestException('GSTIN state code must match the registered business state');
      }
      if (!dto.gstRegistered && dto.gstin) throw new BadRequestException('GSTIN must be omitted when the business is not GST registered');
      const { password: _password, ...businessProfile } = dto;
      void _password;
      const request = await this.registrationRequests.create({
        ...businessProfile,
        name: dto.name.trim(),
        businessName: dto.businessName.trim(),
        storeName: dto.storeName.trim(),
        email,
        passwordHash,
        status: 'PENDING_APPROVAL',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      return {
        requestId: String(request._id),
        status: 'PENDING_APPROVAL',
        message: 'Registration submitted for Solstra verification. Your workspace and login access will be created only after approval.',
      };
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('A pending registration already exists for this email');
      throw error;
    }
  }

  private assertPlatformAdmin(userId: string) {
    const allowed = (this.config.get<string>('PLATFORM_ADMIN_USER_IDS') || '')
      .split(',').map(value => value.trim()).filter(Boolean);
    if (!allowed.includes(userId)) throw new ForbiddenException('Solstra platform approval access is not configured for this account');
  }

  async listRegistrationApprovalRequests(userId: string) {
    this.assertPlatformAdmin(userId);
    return this.registrationRequests.find({ status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } })
      .select('_id name businessName storeName email ownerPhone alternatePhone businessType businessCategory businessDescription addressLine1 addressLine2 city district state stateCode pincode country gstRegistered gstin gstLegalName gstRegistrationType businessEmail website status createdAt +logoDataUrl')
      .sort({ createdAt: 1 }).limit(200).lean();
  }

  async reviewRegistrationApproval(userId: string, requestId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    this.assertPlatformAdmin(userId);
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(requestId)) throw new BadRequestException('Invalid approval identity');
    const request = await this.registrationRequests.findOne({ _id: new Types.ObjectId(requestId), status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } }).select('+passwordHash +logoDataUrl');
    if (!request) throw new NotFoundException('Pending registration request not found');
    const now = new Date();
    if (decision === 'REJECT') {
      const rejected = await this.registrationRequests.updateOne(
        { _id: request._id, status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } },
        { $set: { status: 'REJECTED', reviewedBy: new Types.ObjectId(userId), reviewedAt: now, reviewReason: reason.trim() }, $unset: { passwordHash: 1, expiresAt: 1 } },
      );
      if (!rejected.modifiedCount) throw new ConflictException('Registration request was already reviewed');
      return { requestId, status: 'REJECTED', reviewedAt: now };
    }

    if (await this.users.exists({ email: request.email })) throw new ConflictException('An active account already uses this email');
    const session = await this.users.db.startSession();
    let tenant: any = null;
    let user: any = null;
    try {
      await session.withTransaction(async () => {
        const current = await this.registrationRequests.findOne({ _id: request._id, status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } }).select('+passwordHash +logoDataUrl').session(session);
        if (!current) throw new ConflictException('Registration request was already reviewed');
        const activatedAt = new Date();
        const trialEndsAt = new Date(activatedAt.getTime() + TRIAL_DURATION_MS);
        const slugBase = current.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'business';
        [tenant] = await this.tenants.create([{
          name: current.businessName,
          storeName: current.storeName || current.businessName,
          ownerName: current.name,
          ownerPhone: current.ownerPhone,
          alternatePhone: current.alternatePhone || null,
          businessType: current.businessType,
          businessCategory: current.businessCategory || '',
          businessDescription: current.businessDescription || '',
          businessEmail: current.businessEmail || current.email,
          website: current.website || '',
          addressLine1: current.addressLine1,
          addressLine2: current.addressLine2 || '',
          city: current.city,
          district: current.district || '',
          state: current.state,
          stateCode: current.stateCode,
          pincode: current.pincode,
          country: current.country || 'India',
          gstRegistered: Boolean(current.gstRegistered),
          gstin: current.gstRegistered ? current.gstin : null,
          gstLegalName: current.gstRegistered ? current.gstLegalName || '' : '',
          gstRegistrationType: current.gstRegistered ? current.gstRegistrationType || '' : '',
          logoDataUrl: current.logoDataUrl || null,
          slug: slugBase + '-' + randomBytes(4).toString('hex'),
          status: 'active', subscriptionStatus: 'trial', trialStartedAt: activatedAt, trialEndsAt,
        }], { session });
        [user] = await this.users.create([{
          name: current.name, email: current.email, passwordHash: current.passwordHash,
          tenantId: tenant._id, role: 'owner', isActive: true, tokenVersion: 0,
        }], { session });
        const reviewed = await this.registrationRequests.updateOne(
          { _id: current._id, status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } },
          { $set: { status: 'APPROVED', reviewedBy: new Types.ObjectId(userId), reviewedAt: activatedAt, reviewReason: reason.trim() }, $unset: { passwordHash: 1, expiresAt: 1 } },
          { session },
        );
        if (!reviewed.modifiedCount) throw new ConflictException('Registration request was reviewed concurrently');
      });
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('An account or workspace with these details already exists');
      throw error;
    } finally {
      await session.endSession();
    }
    return {
      requestId, status: 'APPROVED',
      account: user ? { id: String(user._id), email: user.email, name: user.name } : null,
      workspace: tenant ? { id: String(tenant._id), name: tenant.name, trialStartedAt: tenant.trialStartedAt, trialEndsAt: tenant.trialEndsAt } : null,
      message: 'Registration approved. The client can now sign in using the password chosen during registration.',
    };
  }

  async requestPasswordChange(userId: string, tenantId: string, dto: RequestPasswordChangeDto) {
    if (![userId, tenantId].every(id => Types.ObjectId.isValid(id))) throw new BadRequestException('Invalid account context');
    const user = await this.users.findOne({ _id: new Types.ObjectId(userId), tenantId: new Types.ObjectId(tenantId), isActive: true }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) throw new BadRequestException('New password must be different from the current password');
    await this.passwordChangeRequests.updateMany({ userId: user._id, status: 'PENDING_APPROVAL', expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' }, $unset: { newPasswordHash: 1, expiresAt: 1 } });
    if (await this.passwordChangeRequests.exists({ userId: user._id, status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } })) {
      throw new ConflictException('A password change request is already awaiting Solstra approval');
    }
    const newPasswordHash = await bcrypt.hash(dto.newPassword, 12);
    try {
      const request = await this.passwordChangeRequests.create({
        userId: user._id, tenantId: user.tenantId, email: user.email,
        newPasswordHash, status: 'PENDING_APPROVAL',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      return { requestId: String(request._id), status: 'PENDING_APPROVAL', message: 'Password change submitted. Your current password remains active until Solstra approves the request.' };
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('A password change request is already pending');
      throw error;
    }
  }

  async getMyPasswordChangeRequest(userId: string, tenantId: string) {
    if (![userId, tenantId].every(id => Types.ObjectId.isValid(id))) throw new BadRequestException('Invalid account context');
    await this.passwordChangeRequests.updateMany({ userId: new Types.ObjectId(userId), status: 'PENDING_APPROVAL', expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' }, $unset: { newPasswordHash: 1, expiresAt: 1 } });
    const request = await this.passwordChangeRequests.findOne({ userId: new Types.ObjectId(userId), tenantId: new Types.ObjectId(tenantId) })
      .select('_id status reviewReason reviewedAt createdAt').sort({ createdAt: -1 }).lean();
    return request || { status: 'NONE' };
  }

  async getPlatformRegistrationSummary(userId: string) {
    this.assertPlatformAdmin(userId);
    const [pending, approved, rejected, expired, totalStores, activeStores, suspendedStores] = await Promise.all([
      this.registrationRequests.countDocuments({ status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } }),
      this.registrationRequests.countDocuments({ status: 'APPROVED' }),
      this.registrationRequests.countDocuments({ status: 'REJECTED' }),
      this.registrationRequests.countDocuments({ status: 'EXPIRED' }),
      this.tenants.countDocuments({}),
      this.tenants.countDocuments({ status: 'active' }),
      this.tenants.countDocuments({ status: 'suspended' }),
    ]);
    return { registrations: { pending, approved, rejected, expired }, stores: { total: totalStores, active: activeStores, suspended: suspendedStores } };
  }

  async listPlatformStoreDirectory(userId: string) {
    this.assertPlatformAdmin(userId);
    const tenants = await this.tenants.find({})
      .select('+logoDataUrl name storeName slug status subscriptionStatus subscriptionPlan trialStartedAt trialEndsAt gstRegistered gstin gstLegalName gstRegistrationType businessType businessCategory businessDescription businessEmail website ownerName ownerPhone alternatePhone addressLine1 addressLine2 city district state stateCode pincode country createdAt')
      .sort({ createdAt: -1 }).limit(500).lean();
    const ids = tenants.map((tenant: any) => tenant._id);
    const owners = await this.users.find({ tenantId: { $in: ids }, role: 'owner' })
      .select('tenantId name email isActive createdAt').lean();
    const ownerByTenant = new Map(owners.map((owner: any) => [String(owner.tenantId), owner]));
    return tenants.map((tenant: any) => ({ ...tenant, owner: ownerByTenant.get(String(tenant._id)) || null }));
  }

  async listPasswordChangeApprovalRequests(userId: string) {
    this.assertPlatformAdmin(userId);
    return this.passwordChangeRequests.find({ status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } })
      .select('_id userId tenantId email status createdAt')
      .populate('userId', 'name email')
      .populate('tenantId', 'name slug')
      .sort({ createdAt: 1 }).limit(200).lean();
  }

  async reviewPasswordChangeApproval(userId: string, requestId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    this.assertPlatformAdmin(userId);
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(requestId)) throw new BadRequestException('Invalid approval identity');
    const session = await this.users.db.startSession();
    let status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    try {
      await session.withTransaction(async () => {
        const request = await this.passwordChangeRequests.findOne({ _id: new Types.ObjectId(requestId), status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } })
          .select('+newPasswordHash').session(session);
        if (!request) throw new NotFoundException('Pending password change request not found');
        if (String(request.userId) === userId) throw new BadRequestException('A user cannot approve their own password change');
        const now = new Date();
        if (decision === 'APPROVE') {
          const updated = await this.users.updateOne(
            { _id: request.userId, tenantId: request.tenantId, isActive: true },
            { $set: { passwordHash: request.newPasswordHash }, $inc: { tokenVersion: 1 } },
            { session },
          );
          if (!updated.modifiedCount) throw new NotFoundException('Account is no longer active');
        }
        const reviewed = await this.passwordChangeRequests.updateOne(
          { _id: request._id, status: 'PENDING_APPROVAL', expiresAt: { $gt: new Date() } },
          { $set: { status, reviewedBy: new Types.ObjectId(userId), reviewedAt: now, reviewReason: reason.trim() }, $unset: { newPasswordHash: 1, expiresAt: 1 } },
          { session },
        );
        if (!reviewed.modifiedCount) throw new ConflictException('Password change request was reviewed concurrently');
      });
    } finally {
      await session.endSession();
    }
    return { requestId, status, message: decision === 'APPROVE' ? 'Password changed successfully. All previous sessions have been revoked; sign in again.' : 'Password change rejected. The existing password remains active.' };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      email: dto.email.toLowerCase().trim(), isActive: true,
    }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const tenant = await this.tenants.findById(user.tenantId);
    if (!tenant || tenant.status !== 'active') throw new UnauthorizedException('Workspace unavailable');
    return this.issueToken(user, tenant);
  }

  async createStaffUser(tenantId: string, dto: CreateStaffUserDto) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const tenant = await this.tenants.findById(tenantId).select('maxUsers').lean();
    if (!tenant) throw new NotFoundException('Workspace not found');
    const userCount = await this.users.countDocuments({ tenantId: new Types.ObjectId(tenantId) });
    if (userCount >= Number(tenant.maxUsers || 3)) throw new ConflictException('Workspace user limit reached for the current subscription plan');
    const email = dto.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    try {
      const [user] = await this.users.create([{
        tenantId: new Types.ObjectId(tenantId),
        name: dto.name.trim(),
        email,
        passwordHash,
        role: 'staff',
        designation: dto.designation?.trim() || '',
        phone: dto.phone || null,
        permissions: [...new Set(dto.permissions || [])],
        isActive: true,
      }]);
      return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation || '',
        phone: user.phone || '',
        permissions: user.permissions || [],
        isActive: user.isActive,
      };
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('An account with this email already exists');
      throw error;
    }
  }

  async listTenantUsers(tenantId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    const users = await this.users.find({ tenantId: new Types.ObjectId(tenantId) })
      .select('_id name email role designation phone permissions isActive createdAt updatedAt')
      .sort({ createdAt: 1 }).lean();
    return users.map((user) => ({ ...user, permissions: user.permissions || [] }));
  }

  async updateStaffStatus(tenantId: string, changedBy: string, userId: string, isActive: boolean, reason = '') {
    if (![tenantId, changedBy, userId].every(id => Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Invalid tenant or user ID');
    }
    if (changedBy === userId) throw new BadRequestException('You cannot deactivate your own account');
    const filter = { _id: new Types.ObjectId(userId), tenantId: new Types.ObjectId(tenantId), role: 'staff' };
    const existing = await this.users.findOne(filter).select('isActive').lean();
    if (!existing) throw new NotFoundException('Staff user not found in this business');
    if (existing.isActive === isActive) return { id: userId, isActive, unchanged: true };
    const user = await this.users.findOneAndUpdate(filter, {
      $set: { isActive },
      $inc: { tokenVersion: 1 },
      $push: { accountStatusHistory: { changedBy: new Types.ObjectId(changedBy), isActive, reason: reason.trim(), changedAt: new Date() } },
    }, { new: true }).select('_id name email role designation phone permissions isActive').lean();
    if (!user) throw new ConflictException('Staff account changed concurrently; refresh and retry');
    return user;
  }

  async updateUserPermissions(tenantId: string, changedBy: string, userId: string, dto: UpdateUserPermissionsDto) {
    if (![tenantId, changedBy, userId].every((id) => Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Invalid tenant or user ID');
    }
    const filter = {
      _id: new Types.ObjectId(userId),
      tenantId: new Types.ObjectId(tenantId),
      role: 'staff',
    };
    const existing = await this.users.findOne(filter).select('permissions').lean();
    if (!existing) throw new NotFoundException('Staff user not found in this business');
    const previousPermissions = existing.permissions || [];
    const permissions = [...new Set(dto.permissions)];
    const concurrencyFilter = previousPermissions.length
      ? { permissions: previousPermissions }
      : { $or: [{ permissions: [] }, { permissions: { $exists: false } }] };
    const user = await this.users.findOneAndUpdate(
      { ...filter, ...concurrencyFilter },
      {
        $set: { permissions },
        $push: {
          permissionHistory: {
            changedBy: new Types.ObjectId(changedBy),
            previousPermissions,
            newPermissions: permissions,
            changedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    ).select('_id name email role permissions isActive').lean();
    if (!user) throw new ConflictException('Staff permissions changed concurrently; reload and retry');
    return user;
  }

  private async issueToken(user: UserDocument, tenant: TenantDocument) {
    const accessToken = await this.jwt.signAsync({
      sub: String(user._id),
      tenantId: String(tenant._id),
      role: user.role,
      tokenVersion: Number((user as any).tokenVersion || 0),
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      user: { id: String(user._id), tenantId: String(tenant._id), name: user.name, email: user.email, role: user.role, permissions: user.permissions || [] },
      tenant: {
        id: String(tenant._id),
        name: tenant.name,
        trialStartedAt: tenant.trialStartedAt,
        trialEndsAt: tenant.trialEndsAt,
        trialDurationHours: 168,
      },
    };
  }
}
