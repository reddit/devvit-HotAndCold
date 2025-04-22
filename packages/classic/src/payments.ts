import { addPaymentHandler } from '@devvit/payments';
import { type RedisClient } from '@devvit/public-api';
import { DateTime } from 'luxon';

class PaymentsRepo {
  #redis: RedisClient;
  constructor(redis: RedisClient) {
    this.#redis = redis;
  }
  async addHardcoreModeLifetimeAccess(userId: string) {
    await this.#redis.set(`hardcore-mode-lifetime-access:${userId}`, `1`);
  }
  async addHardcoreMode7DayAccess(userId: string) {
    const sevenDaysFromNow = DateTime.now().plus({ days: 7 });
    await this.#redis.set(`hardcore-mode-seven-day-access:${userId}`, sevenDaysFromNow.toISO());
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
          await pr.addHardcoreMode7DayAccess(ctx.userId!);
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
