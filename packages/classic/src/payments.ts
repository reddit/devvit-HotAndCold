import { addPaymentHandler } from '@devvit/payments';
import { type RedisClient } from '@devvit/public-api';
import { DateTime } from 'luxon';

class PaymentsRepo {
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

    // If the user doesn't have access, set it to 7 days from now
    if (existingAccess == null) {
      const newExpiry = DateTime.now().plus({ days: 7 });
      await this.#redis.set(PaymentsRepo.hardcoreModeAccessKey(userId), newExpiry.toISO());
      return;
    }

    // If the existing access is expired, also set it to 7 days from now
    if (DateTime.fromISO(existingAccess) < DateTime.now()) {
      const newExpiry = DateTime.now().plus({ days: 7 });
      await this.#redis.set(PaymentsRepo.hardcoreModeAccessKey(userId), newExpiry.toISO());
      return;
    }

    // If the existing access is not expired, add 7 days to it
    const newExpiry = DateTime.fromISO(existingAccess).plus({ days: 7 });
    await this.#redis.set(PaymentsRepo.hardcoreModeAccessKey(userId), newExpiry.toISO()!);
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
