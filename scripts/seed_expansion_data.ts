export interface ExpansionCreatorDef {
  key: string;
  email: string;
  password: string;
  username: string;
  displayName: string;
  niche: string;
  bio: string;
  avatarSourceUrl: string;
  posts: Array<{
    id: string;
    sourceImageUrl: string;
    caption: string;
    tags: string[];
    location: string;
    createdAt: string;
  }>;
  reels: Array<{
    id: string;
    sourceVideoUrl: string;
    startSec: number;
    durationSec: number;
    caption: string;
    tags: string[];
    createdAt: string;
  }>;
}

export const EXPANSION_CREATORS_PART_1: ExpansionCreatorDef[] = [
  {
    key: 'lucas_silva',
    email: 'bilal.saeed.seed@sogosocial.com',
    password: 'SogoSeed#2026!Bilal',
    username: 'lucas_silva',
    displayName: 'Lucas Silva',
    niche: 'cars',
    bio: 'Classic builds, canyon drives, motorsport drifting & weekend track days.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_17',
        sourceImageUrl: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&auto=format&fit=crop&q=85',
        caption: 'Early Sunday canyon drive before the traffic starts. Nothing like flat-six acoustics echoing off the cliffs. #cars #automotive #canyondrive',
        tags: ['cars', 'automotive', 'canyondrive'],
        location: 'Crest Highway',
        createdAt: '2026-09-29T12:20:00.000Z',
      },
      {
        id: 'post_sogo_seed_18',
        sourceImageUrl: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1200&auto=format&fit=crop&q=85',
        caption: 'Dialed in the suspension alignment and tire pressures for this weekend’s track session. #cars #motorsport #trackday',
        tags: ['cars', 'motorsport', 'trackday'],
        location: 'Paddock Garage',
        createdAt: '2026-09-22T18:40:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_09',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Rali_Bae_-_Ghosty_and_the_home-made_Rally_Cars_tradition%2C_hillbilly-style.webm',
        startSec: 2,
        durationSec: 12,
        caption: 'When you and the crew build a custom gravity rally car from scratch and send it flying down the canyon road! #cars #rally #motorsport',
        tags: ['cars', 'rally', 'motorsport'],
        createdAt: '2026-09-25T22:10:00.000Z',
      },
    ],
  },
  {
    key: 'emma_wilson',
    email: 'amna.sheikh.seed@sogosocial.com',
    password: 'SogoSeed#2026!Amna',
    username: 'emma_wilson',
    displayName: 'Emma Wilson',
    niche: 'gaming',
    bio: 'Arcade speedruns, retro championships, robotics & late-night co-op challenges.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_19',
        sourceImageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&auto=format&fit=crop&q=85',
        caption: 'Friday night co-op tournament setup ready to roll. What is everyone playing this weekend? #gaming #esports #setup',
        tags: ['gaming', 'esports', 'setup'],
        location: 'Arcade Room',
        createdAt: '2026-09-29T05:50:00.000Z',
      },
      {
        id: 'post_sogo_seed_20',
        sourceImageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&auto=format&fit=crop&q=85',
        caption: 'Exploring retro arcade cabinets and pixel art classics this afternoon. #gaming #retrogaming #arcade',
        tags: ['gaming', 'retrogaming', 'arcade'],
        location: 'Neon Arcade',
        createdAt: '2026-09-22T09:20:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_10',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/af/Fractal_and_DogPlayingTetris_rolling_during_CTWC_2023.webm',
        startSec: 1,
        durationSec: 12,
        caption: 'When the speedrun reaches level 29 and the controller finger-rolling technique goes full turbo mode! #gaming #tetris #speedrun',
        tags: ['gaming', 'tetris', 'speedrun'],
        createdAt: '2026-09-25T15:40:00.000Z',
      },
    ],
  },
  {
    key: 'kwame_mensah',
    email: 'saad.qureshi.seed@sogosocial.com',
    password: 'SogoSeed#2026!Saad',
    username: 'kwame_mensah',
    displayName: 'Kwame Mensah',
    niche: 'comedy',
    bio: 'Funny challenges, unexpected street moments, physical comedy & daily laughs.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_21',
        sourceImageUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1200&auto=format&fit=crop&q=85',
        caption: 'Testing five minutes of new material at the open-mic comedy night. The front row had opinions! #comedy #standup #openmic',
        tags: ['comedy', 'standup', 'openmic'],
        location: 'Comedy Cellar',
        createdAt: '2026-09-28T19:05:00.000Z',
      },
      {
        id: 'post_sogo_seed_22',
        sourceImageUrl: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&auto=format&fit=crop&q=85',
        caption: 'Post-show laughs with the crew after a packed Friday late set. #comedy #friends #goodvibes',
        tags: ['comedy', 'friends', 'goodvibes'],
        location: 'Stage Lounge',
        createdAt: '2026-09-21T22:40:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_11',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/c2/Combat_juggling_Berlin-2011.webm',
        startSec: 1,
        durationSec: 12,
        caption: 'Last person still juggling wins! Competitive combat juggling gets chaotic way too fast. #comedy #challenge #funny',
        tags: ['comedy', 'challenge', 'funny'],
        createdAt: '2026-09-24T21:05:00.000Z',
      },
    ],
  },
  {
    key: 'olivia_martin',
    email: 'noor.fatima.seed@sogosocial.com',
    password: 'SogoSeed#2026!Noor',
    username: 'olivia_martin',
    displayName: 'Olivia Martin',
    niche: 'lifestyle',
    bio: 'Daily routines, cafe rituals, mindful productivity & coastal resets.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_23',
        sourceImageUrl: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&auto=format&fit=crop&q=85',
        caption: 'Small daily habits compound faster than occasional bursts of intensity. Top 3 priorities mapped out for today. #lifestyle #habits #focus',
        tags: ['lifestyle', 'habits', 'focus'],
        location: 'Morning Desk',
        createdAt: '2026-09-28T14:40:00.000Z',
      },
      {
        id: 'post_sogo_seed_24',
        sourceImageUrl: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=1200&auto=format&fit=crop&q=85',
        caption: 'Weekly reflection and planning for the new month ahead. Consistency over perfection. #lifestyle #mindset #goals',
        tags: ['lifestyle', 'mindset', 'goals'],
        location: 'Study Loft',
        createdAt: '2026-09-21T16:10:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_12',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Latte_Coffee_making.webm',
        startSec: 1,
        durationSec: 12,
        caption: 'Satisfying morning latte pour before opening the laptop. That microfoam texture is spot on today. #lifestyle #coffee #satisfying',
        tags: ['lifestyle', 'coffee', 'satisfying'],
        createdAt: '2026-09-24T12:30:00.000Z',
      },
    ],
  },
  {
    key: 'elena_rossi',
    email: 'zain.abbas.seed@sogosocial.com',
    password: 'SogoSeed#2026!Zain',
    username: 'elena_rossi',
    displayName: 'Elena Rossi',
    niche: 'art',
    bio: 'Watercolor studies, quick drawing tutorials, glass art & studio process.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_25',
        sourceImageUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=1200&auto=format&fit=crop&q=85',
        caption: 'Mixing warm ochre, ultramarine, and titanium white for a new large-scale canvas study. #art #painting #studio',
        tags: ['art', 'painting', 'studio'],
        location: 'Florence Atelier',
        createdAt: '2026-09-28T08:50:00.000Z',
      },
      {
        id: 'post_sogo_seed_26',
        sourceImageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=1200&auto=format&fit=crop&q=85',
        caption: 'Palette knife textures drying in the afternoon studio light. #art #contemporaryart #color',
        tags: ['art', 'contemporaryart', 'color'],
        location: 'Art Workshop',
        createdAt: '2026-09-20T18:30:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_13',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/How_to_draw_a_cube.webm',
        startSec: 2,
        durationSec: 12,
        caption: 'Quick 3D drawing hack: how to sketch clean geometric perspective lines step by step. #art #drawing #tutorial',
        tags: ['art', 'drawing', 'tutorial'],
        createdAt: '2026-09-23T18:45:00.000Z',
      },
    ],
  },
  {
    key: 'daniel_kim',
    email: 'mehak.rizvi.seed@sogosocial.com',
    password: 'SogoSeed#2026!Mehak',
    username: 'daniel_kim',
    displayName: 'Daniel Kim',
    niche: 'cooking',
    bio: 'Sizzling street food, weeknight skillets, kitchen hacks & comfort recipes.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_27',
        sourceImageUrl: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200&auto=format&fit=crop&q=85',
        caption: 'Prepping aromatics, toasted sesame, and chili oil for tonight’s stir-fry session. #cooking #homecooking #streetfood',
        tags: ['cooking', 'homecooking', 'streetfood'],
        location: 'Test Kitchen',
        createdAt: '2026-09-27T18:40:00.000Z',
      },
      {
        id: 'post_sogo_seed_28',
        sourceImageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=1200&auto=format&fit=crop&q=85',
        caption: 'One-pan roasted vegetables with herb grains and citrus glaze. #cooking #healthyfood #dinner',
        tags: ['cooking', 'healthyfood', 'dinner'],
        location: 'Pantry Table',
        createdAt: '2026-09-20T12:15:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_14',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e4/%E8%A0%94%E6%B2%B9%E8%9D%A6%E7%90%83%E8%9F%B9%E8%82%89%E4%BC%8A%E9%BA%B5_2019.webm',
        startSec: 2,
        durationSec: 12,
        caption: 'Sizzling garlic shrimp and crab e-fu noodles fresh off the high-heat wok! #cooking #foodie #streetfood',
        tags: ['cooking', 'foodie', 'streetfood'],
        createdAt: '2026-09-23T10:20:00.000Z',
      },
    ],
  },
  {
    key: 'noah_bennett',
    email: 'farhan.shah.seed@sogosocial.com',
    password: 'SogoSeed#2026!Farhan',
    username: 'noah_bennett',
    displayName: 'Noah Bennett',
    niche: 'sports',
    bio: 'Basketball runs, athletic conditioning, outdoor training & game-day highlights.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_29',
        sourceImageUrl: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200&auto=format&fit=crop&q=85',
        caption: 'Under the floodlights for tonight’s league match. Pitch is in prime condition. #sports #football #matchday',
        tags: ['sports', 'football', 'matchday'],
        location: 'City Arena Pitch',
        createdAt: '2026-09-27T11:50:00.000Z',
      },
      {
        id: 'post_sogo_seed_30',
        sourceImageUrl: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=1200&auto=format&fit=crop&q=85',
        caption: 'Early morning hard-court tennis drills working on first-serve placement and footwork. #sports #tennis #training',
        tags: ['sports', 'tennis', 'training'],
        location: 'Club Courts',
        createdAt: '2026-09-19T14:00:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_15',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/34/Conditioning_Drill_3-_Alternate_Staggered_Squat_Jump.webm',
        startSec: 2,
        durationSec: 12,
        caption: 'Explosive lower-body plyometrics—alternate staggered squat jumps for vertical leap and agility! #sports #training #athletics',
        tags: ['sports', 'training', 'athletics'],
        createdAt: '2026-09-22T17:15:00.000Z',
      },
    ],
  },
  {
    key: 'amara_okafor',
    email: 'alina.baig.seed@sogosocial.com',
    password: 'SogoSeed#2026!Alina',
    username: 'amara_okafor',
    displayName: 'Amara Okafor',
    niche: 'beauty',
    bio: 'Wellness, mindful ceramics, skincare science & everyday confidence.',
    avatarSourceUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&auto=format&fit=crop&q=85',
    posts: [
      {
        id: 'post_sogo_seed_31',
        sourceImageUrl: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&auto=format&fit=crop&q=85',
        caption: 'Keeping the autumn skincare routine simple: gentle cleanser, hyaluronic hydration, and daily SPF. #beauty #skincare #glow',
        tags: ['beauty', 'skincare', 'glow'],
        location: 'Vanity Studio',
        createdAt: '2026-09-26T19:30:00.000Z',
      },
      {
        id: 'post_sogo_seed_32',
        sourceImageUrl: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&auto=format&fit=crop&q=85',
        caption: 'Testing warm rosewood and terracotta tones for a soft, everyday five-minute look. #beauty #makeup #cleanbeauty',
        tags: ['beauty', 'makeup', 'cleanbeauty'],
        location: 'Beauty Bar',
        createdAt: '2026-09-19T08:45:00.000Z',
      },
    ],
    reels: [
      {
        id: 'vid_sogo_seed_16',
        sourceVideoUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Pottery_01.webm',
        startSec: 1,
        durationSec: 12,
        caption: 'Weekend studio reset—shaping custom ceramic vanity dishes on the pottery wheel! #wellness #ceramics #satisfying',
        tags: ['wellness', 'ceramics', 'satisfying'],
        createdAt: '2026-09-21T20:40:00.000Z',
      },
    ],
  },
];
