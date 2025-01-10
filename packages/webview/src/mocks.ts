import { ChallengeLeaderboardResponse, Game, PlayerProgress } from '@hotandcold/shared';

/**
 * Mocks are ran when the game is started with Vite's
 */
export const PLAYING_GAME: Partial<Game> = {
  'number': 14,
  'challengeUserInfo': {
    'username': 'UnluckyHuckleberry53',
    'score': undefined,
    'startedPlayingAtMs': 1732565702424,
    'guesses': [
      {
        'word': 'apple',
        'similarity': 0.291276811392983,
        'normalizedSimilarity': 36,
        'timestamp': 1732565703374,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'banana',
        'similarity': 0.225650409550931,
        'normalizedSimilarity': 28,
        'timestamp': 1732567455420,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'space',
        'similarity': 0.379734184169698,
        'normalizedSimilarity': 47,
        'timestamp': 1732567459044,
        'rank': 980,
        'isHint': true,
      },
      {
        'word': 'beaut',
        'similarity': 0.428761852644737,
        'normalizedSimilarity': 53,
        'timestamp': 1732567461440,
        'rank': 338,
        'isHint': true,
      },
      {
        'word': 'shoe',
        'similarity': 0.300118365887355,
        'normalizedSimilarity': 37,
        'timestamp': 1732567473026,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'foot',
        'similarity': 0.217750098437083,
        'normalizedSimilarity': 27,
        'timestamp': 1732567474935,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'web',
        'similarity': 0.255054943112883,
        'normalizedSimilarity': 31,
        'timestamp': 1732567476904,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'spider',
        'similarity': 0.338275472912249,
        'normalizedSimilarity': 42,
        'timestamp': 1732567478437,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'cassette',
        'similarity': 0.226390413236332,
        'normalizedSimilarity': 28,
        'timestamp': 1732567481606,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'television',
        'similarity': 0.226587749319904,
        'normalizedSimilarity': 28,
        'timestamp': 1732567483666,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'remote',
        'similarity': 0.21697111034049,
        'normalizedSimilarity': 27,
        'timestamp': 1732567489481,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'chic',
        'similarity': 0.393815558964478,
        'normalizedSimilarity': 48,
        'timestamp': 1732567494370,
        'rank': 695,
        'isHint': true,
      },
      {
        'word': 'spall',
        'similarity': 0.395460474626409,
        'normalizedSimilarity': 49,
        'timestamp': 1732567496013,
        'rank': 670,
        'isHint': true,
      },
      {
        'word': 'diva',
        'similarity': 0.411790146551757,
        'normalizedSimilarity': 51,
        'timestamp': 1732567497151,
        'rank': 464,
        'isHint': true,
      },
      {
        'word': 'showgirl',
        'similarity': 0.399532532580509,
        'normalizedSimilarity': 49,
        'timestamp': 1732567498468,
        'rank': 600,
        'isHint': true,
      },
      {
        'word': 'moonbeam',
        'timestamp': 1732567499407,
        'similarity': 0.456435341557686,
        'normalizedSimilarity': 56,
        'rank': 188,
        'isHint': true,
      },
    ],
  },
  'challengeInfo': {
    'totalPlayers': 1,
    'totalSolves': 0,
    'totalGuesses': 9,
    'totalHints': 7,
    'totalGiveUps': 0,
  },
  'challengeProgress': [
    {
      'avatar': null,
      'username': 'UnluckyHuckleberry53',
      'isPlayer': true,
      'progress': 56,
    },
  ],
};

export const WINNING_GAME: Partial<Game> = {
  'number': 14,
  'challengeUserInfo': {
    'username': 'UnluckyHuckleberry53',
    'score': {
      version: '1',
      finalScore: 72,
      breakdown: {
        solvingBonus: 10,
        timeBonus: {
          points: 35,
          timeInSeconds: 45,
          isOptimal: false,
        },
        guessBonus: {
          points: 40,
          numberOfGuesses: 15,
          isOptimal: false,
        },
        hintPenalty: {
          numberOfHints: 1,
          penaltyMultiplier: 0.85,
        },
      },
    },
    'startedPlayingAtMs': 1732565702424,
    'solvedAtMs': 1732567596993,
    'guesses': [
      {
        'word': 'apple',
        'similarity': 0.291276811392983,
        'normalizedSimilarity': 36,
        'timestamp': 1732565703374,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'banana',
        'similarity': 0.225650409550931,
        'normalizedSimilarity': 28,
        'timestamp': 1732567455420,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'space',
        'similarity': 0.379734184169698,
        'normalizedSimilarity': 47,
        'timestamp': 1732567459044,
        'rank': 980,
        'isHint': true,
      },
      {
        'word': 'beaut',
        'similarity': 0.428761852644737,
        'normalizedSimilarity': 53,
        'timestamp': 1732567461440,
        'rank': 338,
        'isHint': true,
      },
      {
        'word': 'shoe',
        'similarity': 0.300118365887355,
        'normalizedSimilarity': 37,
        'timestamp': 1732567473026,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'foot',
        'similarity': 0.217750098437083,
        'normalizedSimilarity': 27,
        'timestamp': 1732567474935,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'web',
        'similarity': 0.255054943112883,
        'normalizedSimilarity': 31,
        'timestamp': 1732567476904,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'spider',
        'similarity': 0.338275472912249,
        'normalizedSimilarity': 42,
        'timestamp': 1732567478437,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'cassette',
        'similarity': 0.226390413236332,
        'normalizedSimilarity': 28,
        'timestamp': 1732567481606,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'television',
        'similarity': 0.226587749319904,
        'normalizedSimilarity': 28,
        'timestamp': 1732567483666,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'remote',
        'similarity': 0.21697111034049,
        'normalizedSimilarity': 27,
        'timestamp': 1732567489481,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'chic',
        'similarity': 0.393815558964478,
        'normalizedSimilarity': 48,
        'timestamp': 1732567494370,
        'rank': 695,
        'isHint': true,
      },
      {
        'word': 'spall',
        'similarity': 0.395460474626409,
        'normalizedSimilarity': 49,
        'timestamp': 1732567496013,
        'rank': 670,
        'isHint': true,
      },
      {
        'word': 'diva',
        'similarity': 0.411790146551757,
        'normalizedSimilarity': 51,
        'timestamp': 1732567497151,
        'rank': 464,
        'isHint': true,
      },
      {
        'word': 'showgirl',
        'similarity': 0.399532532580509,
        'normalizedSimilarity': 49,
        'timestamp': 1732567498468,
        'rank': 600,
        'isHint': true,
      },
      {
        'word': 'moonbeam',
        'similarity': 0.456435341557686,
        'normalizedSimilarity': 56,
        'timestamp': 1732567499407,
        'rank': 188,
        'isHint': true,
      },
      {
        'word': 'sparkle',
        'timestamp': 1732567596949,
        'similarity': 1,
        'normalizedSimilarity': 99,
        'rank': -1,
        'isHint': false,
      },
    ],
  },
  'challengeInfo': {
    'totalPlayers': 2,
    'totalSolves': 1,
    'totalGuesses': 10,
    'totalHints': 7,
    'totalGiveUps': 0,
  },
  'challengeProgress': [
    {
      'avatar': null,
      'username': 'UnluckyHuckleberry53',
      'isPlayer': true,
      'progress': 99,
    },
  ],
};

export const GIVE_UP_GAME: Partial<Game> = {
  'number': 10,
  'challengeUserInfo': {
    'username': 'UnluckyHuckleberry53',
    'score': undefined,
    'startedPlayingAtMs': 1732567723390,
    'gaveUpAtMs': 1732567731857,
    'guesses': [
      {
        'word': 'apple',
        'similarity': 0.277987847687999,
        'normalizedSimilarity': 34,
        'timestamp': 1732567724326,
        'rank': -1,
        'isHint': false,
      },
      {
        'word': 'sparkle',
        'timestamp': 1732567596949,
        'similarity': 1,
        'normalizedSimilarity': 99,
        'rank': -1,
        'isHint': false,
      },
    ],
  },
  'challengeInfo': {
    'totalPlayers': 1,
    'totalSolves': 0,
    'totalGuesses': 1,
    'totalHints': 0,
    'totalGiveUps': 1,
  },
  'challengeProgress': [],
};

interface MockDataOptions {
  /**
   * Total number of players to generate
   * @default 5000
   */
  totalPlayers?: number;
  /**
   * Progress value for the active player (0-100)
   * @default 45
   */
  playerProgress?: number;
  /**
   * Percentage of players to cluster near the beginning (0-10%)
   * @default 0.3
   */
  earlyPlayerRatio?: number;
  /**
   * Percentage of players who have completed (100%)
   * @default 0.1
   */
  completedPlayerRatio?: number;
}

/**
 * Generates mock data for testing the Progress Bar component
 */
export const generateMockProgressData = ({
  totalPlayers = 5000,
  playerProgress = 45,
  earlyPlayerRatio = 0.3,
  completedPlayerRatio = 0.1,
}: MockDataOptions = {}) => {
  const players: PlayerProgress = [];

  // Add the active player
  players.push({
    username: 'You',
    progress: playerProgress,
    isPlayer: true,
    avatar: null,
  });

  // Calculate distribution
  const earlyPlayers = Math.floor(totalPlayers * earlyPlayerRatio);
  const completedPlayers = Math.floor(totalPlayers * completedPlayerRatio);
  const midRangePlayers = totalPlayers - earlyPlayers - completedPlayers;

  // Generate early players (0-10%)
  for (let i = 0; i < earlyPlayers; i++) {
    players.push({
      username: `early_player_${i}`,
      progress: Math.random() * 10,
      isPlayer: false,
      avatar: null,
    });
  }

  // Generate mid-range players (10-99%)
  for (let i = 0; i < midRangePlayers; i++) {
    players.push({
      username: `mid_player_${i}`,
      progress: 10 + Math.random() * 89,
      isPlayer: false,
      avatar: null,
    });
  }

  // Generate completed players (100%)
  for (let i = 0; i < completedPlayers; i++) {
    players.push({
      username: `completed_player_${i}`,
      progress: 100,
      isPlayer: false,
      avatar: null,
    });
  }

  return players;
};

/**
 * Generates different test scenarios for the Progress Bar
 */
export const generateTestScenarios = () => {
  return {
    // Scenario 1: Player just starting (lots of players ahead)
    earlyProgress: generateMockProgressData({
      playerProgress: 5,
      totalPlayers: 10000,
      earlyPlayerRatio: 0.2,
      completedPlayerRatio: 0.1,
    }),

    // Scenario 2: Player in middle of pack
    midProgress: generateMockProgressData({
      playerProgress: 45,
      totalPlayers: 5000,
      earlyPlayerRatio: 0.3,
      completedPlayerRatio: 0.2,
    }),

    // Scenario 3: Player nearly complete
    lateProgress: generateMockProgressData({
      playerProgress: 95,
      totalPlayers: 8000,
      earlyPlayerRatio: 0.4,
      completedPlayerRatio: 0.05,
    }),

    // Scenario 4: Player completed
    completed: generateMockProgressData({
      playerProgress: 100,
      totalPlayers: 6000,
      earlyPlayerRatio: 0.5,
      completedPlayerRatio: 0.15,
    }),

    // Scenario 5: Small player pool (no grouping)
    smallPool: generateMockProgressData({
      playerProgress: 50,
      totalPlayers: 500,
      earlyPlayerRatio: 0.2,
      completedPlayerRatio: 0.1,
    }),
  };
};

export const CHALLENGE_LEADERBOARD_RESPONSE: ChallengeLeaderboardResponse = {
  'userStreak': 6,
  'leaderboardByScore': [
    {
      'score': 451,
      'member': 'mwood230',
    },
    {
      'score': 394,
      'member': 'UnluckyHuckleberry53',
    },
  ],
  'leaderboardByFastest': [
    {
      'score': 34219,
      'member': 'UnluckyHuckleberry53',
    },
    {
      'score': 6844,
      'member': 'mwood230',
    },
  ],
  'userRank': {
    'score': 2,
    'timeToSolve': 1,
  },
};
