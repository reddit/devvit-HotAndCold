import { z } from 'zod';

/**
 * Shared type definitions for the core game logic.
 */

export type GameMode = 'regular' | 'hardcore';

// Define and export the Zod schema for GameMode
export const zodGameMode = z.enum(['regular', 'hardcore']);
