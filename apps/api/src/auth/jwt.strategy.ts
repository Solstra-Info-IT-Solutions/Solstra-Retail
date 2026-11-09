import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

type JwtPayload = { sub: string; tenantId: string; role: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!Types.ObjectId.isValid(payload.sub) || !Types.ObjectId.isValid(payload.tenantId)) {
      throw new UnauthorizedException();
    }
    const user = await this.users.findOne({
      _id: new Types.ObjectId(payload.sub),
      tenantId: new Types.ObjectId(payload.tenantId),
      isActive: true,
    }).select('_id tenantId role name email').lean();
    if (!user) throw new UnauthorizedException();
    return {
      userId: String(user._id),
      tenantId: String(user.tenantId),
      role: user.role,
      name: user.name,
      email: user.email,
    };
  }
}
