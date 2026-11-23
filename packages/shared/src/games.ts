// Game catalogue. Text is lifted unchanged from prototype/podium-v9.html (the GAMES object).
// Order matters: it is the display order of tabs, chips and cards in the prototype.

export type PadKind = "lr" | "a" | "lra";
export type SongKey = "a" | "b" | "c";

export interface GameMeta {
  name: string;
  tag: string;
  desc: string;
  /** One-line control hint shown at the start of a run. */
  keys: string;
  /** Rows of the controls table in the pre-game sheet. */
  ctl: [string, string][];
  featured: boolean;
  isNew: boolean;
  /** Touch pad layout: left/right, a single action button, or all three. */
  pad: PadKind;
  /** Label of the action button on the touch pad. */
  act: string;
  song: SongKey;
}

export const GAMES = {
  "traffic": {
    "name": "Traffic Rush",
    "tag": "3D",
    "desc": "Weave through three lanes of traffic. The further you get, the faster it goes.",
    "keys": "Left and right arrows, or tap either side",
    "ctl": [
      [
        "← →",
        "Change lane"
      ],
      [
        "Tap left / right",
        "Change lane on mobile"
      ]
    ],
    "featured": true,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "c"
  },
  "duck": {
    "name": "Duck Dash",
    "tag": "Reflex",
    "desc": "Paddle down the river and stay clear of the logs.",
    "keys": "Left and right arrows, or drag",
    "ctl": [
      [
        "← →",
        "Move"
      ],
      [
        "Drag",
        "Move on mobile"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "b"
  },
  "blade": {
    "name": "Blade Rush",
    "tag": "Timing",
    "desc": "Enemies close in from both sides. Strike the moment they step into range.",
    "keys": "Left and right arrows, or tap either side",
    "ctl": [
      [
        "←",
        "Strike left"
      ],
      [
        "→",
        "Strike right"
      ],
      [
        "Miss",
        "Locked for a moment"
      ]
    ],
    "featured": true,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "a"
  },
  "glide": {
    "name": "Storm Glide",
    "tag": "Precision",
    "desc": "Fly through the storm, threading the gaps in the ice.",
    "keys": "Space or tap to climb",
    "ctl": [
      [
        "Space",
        "Climb"
      ],
      [
        "Tap",
        "Climb on mobile"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "a",
    "act": "Climb",
    "song": "a"
  },
  "stack": {
    "name": "Stack Tower",
    "tag": "Timing",
    "desc": "Drop each block on the one below. Miss the edge and it gets trimmed.",
    "keys": "Space or tap to drop the block",
    "ctl": [
      [
        "Space",
        "Drop the block"
      ],
      [
        "Tap",
        "Drop on mobile"
      ],
      [
        "Perfect drop",
        "Keeps the full width"
      ]
    ],
    "featured": true,
    "isNew": false,
    "pad": "a",
    "act": "Drop",
    "song": "b"
  },
  "hop": {
    "name": "Sky Hop",
    "tag": "Arcade",
    "desc": "Bounce from cloud ledge to cloud ledge and climb as high as you can.",
    "keys": "Left and right arrows, or drag",
    "ctl": [
      [
        "← →",
        "Move"
      ],
      [
        "Drag",
        "Move on mobile"
      ],
      [
        "Screen edge",
        "Wraps to the other side"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "b"
  },
  "snake": {
    "name": "Snake Turn",
    "tag": "Classic",
    "desc": "Eat, grow, and keep out of your own way. It speeds up as you grow.",
    "keys": "Left arrow turns left, right arrow turns right, or tap either side",
    "ctl": [
      [
        "←",
        "Turn left"
      ],
      [
        "→",
        "Turn right"
      ],
      [
        "Tap left / right",
        "Turn on mobile"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "b"
  },
  "sprint": {
    "name": "Night Sprint",
    "tag": "Runner",
    "desc": "Run the rooftops and jump the spikes. You get one extra jump in the air.",
    "keys": "Space or tap to jump, again in the air for a double jump",
    "ctl": [
      [
        "Space",
        "Jump"
      ],
      [
        "Space in the air",
        "Double jump"
      ],
      [
        "Tap",
        "Jump on mobile"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "a",
    "act": "Jump",
    "song": "c"
  },
  "hoop": {
    "name": "Hoop Shot",
    "tag": "Timing",
    "desc": "The hoop keeps sliding. Shoot when it lines up. Three misses and you are out.",
    "keys": "Space or tap to shoot",
    "ctl": [
      [
        "Space",
        "Shoot"
      ],
      [
        "Tap",
        "Shoot on mobile"
      ],
      [
        "Three misses",
        "Run ends"
      ]
    ],
    "featured": false,
    "isNew": false,
    "pad": "a",
    "act": "Shoot",
    "song": "b"
  },
  "cube": {
    "name": "Cube Field",
    "tag": "3D",
    "desc": "Fly low through a field of cubes that never ends. Steer and survive.",
    "keys": "Left and right arrows, or hold either side",
    "ctl": [
      [
        "← →",
        "Steer"
      ],
      [
        "Hold left / right",
        "Steer on mobile"
      ]
    ],
    "featured": true,
    "isNew": false,
    "pad": "lr",
    "act": "Go",
    "song": "c"
  },
  "hopper": {
    "name": "Road Hopper",
    "tag": "3D",
    "desc": "Hop across highways and rivers in full 3D. Stop moving and the camera leaves you behind.",
    "keys": "Up or Space hops forward, left and right arrows sidestep",
    "ctl": [
      [
        "↑ / Space",
        "Hop forward"
      ],
      [
        "← →",
        "Sidestep"
      ],
      [
        "Tap middle / sides",
        "Hop on mobile"
      ],
      [
        "Logs",
        "Ride them across water"
      ]
    ],
    "featured": true,
    "isNew": true,
    "pad": "lra",
    "act": "Hop",
    "song": "b"
  },
  "blaster": {
    "name": "Star Blaster",
    "tag": "Shooter",
    "desc": "Waves of raiders, a boss every fifth wave, and power-ups that stack. Chain kills for an 8x combo.",
    "keys": "Left and right arrows or drag to fly. The ship fires on its own",
    "ctl": [
      [
        "← → / drag",
        "Fly"
      ],
      [
        "S capsule",
        "Spread shot"
      ],
      [
        "R capsule",
        "Rapid fire"
      ],
      [
        "H capsule",
        "Shield for one hit"
      ]
    ],
    "featured": true,
    "isNew": true,
    "pad": "lr",
    "act": "Go",
    "song": "c"
  },
  "breaker": {
    "name": "Brick Breaker",
    "tag": "Arcade",
    "desc": "Smash every brick to climb levels. Catch capsules for multi-ball, a wide paddle or an extra life.",
    "keys": "Left and right arrows or drag to move the paddle",
    "ctl": [
      [
        "← → / drag",
        "Move the paddle"
      ],
      [
        "M capsule",
        "Multi-ball"
      ],
      [
        "W capsule",
        "Wide paddle"
      ],
      [
        "S / L capsule",
        "Slow ball / extra life"
      ]
    ],
    "featured": true,
    "isNew": true,
    "pad": "lr",
    "act": "Go",
    "song": "a"
  }
} as const satisfies Record<string, GameMeta>;

export type GameKey = keyof typeof GAMES;
export const GAME_KEYS = Object.keys(GAMES) as GameKey[];
export const isGameKey = (k: unknown): k is GameKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(GAMES, k);
export const gameMeta = (k: GameKey): GameMeta => GAMES[k] as unknown as GameMeta;

/** Hero and tie-break order on the home page: featured games first, in this order. */
export const FEATURED_ORDER: GameKey[] = ["hopper", "blaster", "breaker", "traffic", "cube", "blade", "stack"];
