import { addPaymentHandler } from '@devvit/payments';
import { type RedisClient } from '@devvit/public-api';
import { HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { DateTime } from 'luxon';

export class PaymentsRepo {
  static hardcoreModeAccessKey(userId: string) {
    return `hardcore-mode-access:${userId}`;
  }

  #redis: RedisClient;
  constructor(redis: RedisClient) {
    this.#redis = redis;
  }
  async addHardcoreModeLifetimeAccess(userId: string) {
    await this.#redis.set(PaymentsRepo.hardcoreModeAccessKey(userId), '-1');
  }

  async incrHardcoreModeAccessBy7Days(userId: string) {
    const existingAccess = await this.#redis.get(PaymentsRepo.hardcoreModeAccessKey(userId));
    if (existingAccess === '-1') {
      console.log('User already has lifetime access to hardcore mode');
      return;
    }

    // If the user doesn't have access, or their access has expired, set the expiry to 7 days from now
    const hasExistingAccess = existingAccess != null;
    const isExpired =
      hasExistingAccess && DateTime.fromMillis(Number(existingAccess)) < DateTime.now();
    if (!hasExistingAccess || isExpired) {
      const newExpiry = DateTime.now().plus({ days: 7 });
      await this.#redis.set(
        PaymentsRepo.hardcoreModeAccessKey(userId),
        newExpiry.valueOf().toString()
      );
      return;
    }

    // If the existing access is not expired, add 7 days to it
    const newExpiry = DateTime.fromMillis(Number(existingAccess)).plus({ days: 7 });
    await this.#redis.set(
      PaymentsRepo.hardcoreModeAccessKey(userId),
      newExpiry.valueOf().toString()
    );
  }

  async getHardcoreAccessStatus(userId: string): Promise<HardcoreAccessStatus> {
    const key = PaymentsRepo.hardcoreModeAccessKey(userId);
    const currentAccess = await this.#redis.get(key);

    if (currentAccess === '-1') {
      return { status: 'active' };
    }

    if (!currentAccess) {
      return { status: 'inactive' };
    }

    const expiryMillis = Number(currentAccess);
    const expiryDate = DateTime.fromMillis(expiryMillis);
    if (expiryDate <= DateTime.now()) {
      return { status: 'inactive' };
    }
    return { status: 'active', expires: expiryDate.valueOf() };
  }
}

export function initPayments() {
  addPaymentHandler({
    fulfillOrder: async (order, ctx) => {
      const pr = new PaymentsRepo(ctx.redis);

      if (order.products.length !== 1) {
        return {
          success: false,
          reason: 'Invalid number of products',
        };
      }

      const sku = order.products[0].sku;
      switch (sku) {
        case 'hardcore-mode-lifetime-access':
          await pr.addHardcoreModeLifetimeAccess(ctx.userId!);
          return {
            success: true,
          };
        case 'hardcore-mode-seven-day-access':
          await pr.incrHardcoreModeAccessBy7Days(ctx.userId!);
          return {
            success: true,
          };
        default:
          return {
            success: false,
            reason: `Invalid product SKU: "${sku}"`,
          };
      }
    },
  });
}
