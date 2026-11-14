import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController readiness', () => {
  it('reports readiness only when database and required configuration are available', () => {
    const controller = new HealthController({ readyState: 1, db: {} } as any, { get: jest.fn().mockReturnValue('mongodb://configured') } as any);
    expect(controller.readiness()).toMatchObject({
      status: 'ready',
      service: 'solstra-retail-api',
      checks: { database: 'READY', configuration: 'PRESENT' },
    });
  });

  it('returns service unavailable when database is disconnected', () => {
    const controller = new HealthController({ readyState: 0, db: null } as any, { get: jest.fn().mockReturnValue('mongodb://configured') } as any);
    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);
  });

  it('returns service unavailable when required database configuration is missing', () => {
    const controller = new HealthController({ readyState: 1, db: {} } as any, { get: jest.fn().mockReturnValue('') } as any);
    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);
  });
});
