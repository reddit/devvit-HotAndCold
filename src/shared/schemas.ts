import { z } from 'zod/v4';

export const nflSeasonWeek = z.number().min(1).max(18);

export const nflSeasonYear = z.number().min(2020).max(2500);
