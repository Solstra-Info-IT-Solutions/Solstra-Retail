import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { Tenant, TenantDocument } from '../tenants/schemas/tenant.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { Types } from 'mongoose';

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Tenant.name) private readonly tenants: Model<TenantDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.users.exists({ email })) {
      throw new ConflictException('An account with this email already exists');
    }

    const now = new Date(); // Authoritative server time; activation happens once here.
    const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_MS);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const slug = `${dto.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;

    // Atlas/replica-set transactions ensure a failed signup cannot leave half an account.
    const session = await this.users.db.startSession();
    let user: UserDocument | null = null;
    let tenant: TenantDocument | null = null;
    try {
      await session.withTransaction(async () => {
        [tenant] = await this.tenants.create([{
          name: dto.businessName.trim(),
          slug,
          status: 'active',
          subscriptionStatus: 'trial',
          trialStartedAt: now,
          trialEndsAt,
        }], { session });
        [user] = await this.users.create([{
          name: dto.name.trim(),
          email,
          passwordHash,
          tenantId: tenant._id,
          role: 'owner',
          isActive: true,
        }], { session });
      });
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('Account already exists');
      throw error;
    } finally {
      await session.endSession();
    }
    if (!user || !tenant) throw new Error('Account creation failed');
    return this.issueToken(user, tenant);
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

  async listTenantUsers(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.users.find({ tenantId: new Types.ObjectId(tenantId) })
      .select('_id name email role permissions isActive createdAt updatedAt')
      .sort({ createdAt: 1 }).lean();
  }

  async updateUserPermissions(tenantId: string, userId: string, dto: UpdateUserPermissionsDto) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid tenant or user ID');
    }
    const permissions = [...new Set(dto.permissions)];
    const user = await this.users.findOneAndUpdate(
      { _id: new Types.ObjectId(userId), tenantId: new Types.ObjectId(tenantId), role: 'staff' },
      { $set: { permissions } },
      { new: true, runValidators: true },
    ).select('_id name email role permissions isActive').lean();
    if (!user) throw new NotFoundException('Staff user not found in this business');
    return user;
  }

  private async issueToken(user: UserDocument, tenant: TenantDocument) {
    const accessToken = await this.jwt.signAsync({
      sub: String(user._id),
      tenantId: String(tenant._id),
      role: user.role,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      user: { id: String(user._id), name: user.name, email: user.email, role: user.role, permissions: user.permissions || [] },
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
