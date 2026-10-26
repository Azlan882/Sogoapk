import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' assert { type: 'json' };
import { EXPANSION_CREATORS_PART_1 } from './seed_expansion_data';
import { EXPANSION_CREATORS_PART_2 } from './seed_expansion_data_part2';

const CLOUD_NAME = (process.env.VITE_CLOUDINARY_CLOUD_NAME || 'eiwwjhkq').trim();
const UPLOAD_PRESET = (process.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'Sogo_upload').trim();
const VIDEO_PRESET = (
  process.env.VITE_CLOUDINARY_VIDEO_PRESET ||
  UPLOAD_PRESET ||
  'Sogo_upload'
).trim();
const CLOUDINARY_IMAGE_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const CLOUDINARY_VIDEO_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`;

const TMP_DIR = '/tmp/sogo_seed_media';
const MANIFEST_PATH = path.resolve(process.cwd(), 'scripts/seed_content_manifest.json');

interface LegacySeedAccount {
  email: string;
  password: string;
  username: string;
}

const LEGACY_BRAND_SEED_ACCOUNTS: LegacySeedAccount[] = [
  {
    email: 'sogo.official.seed@sogosocial.com',
    password: 'SogoSeed#2026!Official',
    username: 'sogo_official',
  },
  {
    email: 'sogo.discover.seed@sogosocial.com',
    password: 'SogoSeed#2026!Discover',
    username: 'sogo_discover',
  },
  {
    email: 'sogo.daily.seed@sogosocial.com',
    password: 'SogoSeed#2026!Daily',
    username: 'sogo_daily',
  },
];

export type CreatorSeedKey = string;

interface SeedCreatorAccountDef {
  key: CreatorSeedKey;
  email: string;
  password: string;
  username: string;
  displayName: string;
  niche: string;
  bio: string;
  avatarSourceUrl: string;
}

interface SeedPostDef {
  id: string;
  accountKey: CreatorSeedKey;
  sourceImageUrl: string;
  preUploadedCloudinaryUrl?: string;
  caption: string;
  tags: string[];
  location: string;
  createdAt: string;
}

interface SeedReelDef {
  id: string;
  accountKey: CreatorSeedKey;
  sourceVideoUrl?: string;
  sourceImageUrl?: string;
  preUploadedCloudinaryVideoUrl?: string;
  preUploadedCloudinaryThumbUrl?: string;
  preUploadedDuration?: number;
  startSec: number;
  durationSec: number;
  caption: string;
  tags: string[];
  createdAt: string;
}

const ALL_EXPANSION_CREATORS = [...EXPANSION_CREATORS_PART_1, ...EXPANSION_CREATORS_PART_2];

const INITIAL_SEED_CREATOR_ACCOUNTS: SeedCreatorAccountDef[] = [
  {
    key: 'ayaan_malik',
    email: 'ayaan.malik.seed@sogosocial.com',
    password: 'SogoSeed#2026!Ayaan',
    username: 'ayaan_malik',
    displayName: 'Ayaan Malik',
    niche: 'travel',
    bio: 'Chasing coastal roads, mountain railways & scenic horizons around the world.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'sara_khan',
    email: 'sara.khan.seed@sogosocial.com',
    password: 'SogoSeed#2026!Sara',
    username: 'sara_khan',
    displayName: 'Sara Khan',
    niche: 'lifestyle',
    bio: 'Slow mornings, sunlit spaces, handwritten journals & everyday balance.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'hamza_ali',
    email: 'hamza.ali.seed@sogosocial.com',
    password: 'SogoSeed#2026!Hamza',
    username: 'hamza_ali',
    displayName: 'Hamza Ali',
    niche: 'fitness',
    bio: 'Strength training, outdoor conditioning & staying consistent one session at a time.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'maya_ahmed',
    email: 'maya.ahmed.seed@sogosocial.com',
    password: 'SogoSeed#2026!Maya',
    username: 'maya_ahmed',
    displayName: 'Maya Ahmed',
    niche: 'food',
    bio: 'Home cook, recipe tester & cafe enthusiast sharing comfort food from scratch.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'daniyal_raza',
    email: 'daniyal.raza.seed@sogosocial.com',
    password: 'SogoSeed#2026!Daniyal',
    username: 'daniyal_raza',
    displayName: 'Daniyal Raza',
    niche: 'technology',
    bio: 'Software builder, hardware tinkering, mechanical keyboards & clean desk setups.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'hira_noor',
    email: 'hira.noor.seed@sogosocial.com',
    password: 'SogoSeed#2026!Hira',
    username: 'hira_noor',
    displayName: 'Hira Noor',
    niche: 'fashion',
    bio: 'Minimalist wardrobe, neutral palettes, timeless tailoring & seasonal style.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'usman_tariq',
    email: 'usman.tariq.seed@sogosocial.com',
    password: 'SogoSeed#2026!Usman',
    username: 'marco_rossi',
    displayName: 'Marco Rossi',
    niche: 'photography',
    bio: 'Street, wildlife & architectural photographer capturing light, geometry & city nights.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=600&auto=format&fit=crop&q=85',
  },
  {
    key: 'zoya_hassan',
    email: 'zoya.hassan.seed@sogosocial.com',
    password: 'SogoSeed#2026!Zoya',
    username: 'claire_dubois',
    displayName: 'Claire Dubois',
    niche: 'nature',
    bio: 'Wild coastlines, alpine trails, waterfalls & quiet moments in the outdoors.',
    avatarSourceUrl:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&auto=format&fit=crop&q=85',
  },
];

const SEED_CREATOR_ACCOUNTS: SeedCreatorAccountDef[] = [
  ...INITIAL_SEED_CREATOR_ACCOUNTS,
  ...ALL_EXPANSION_CREATORS.map((c) => ({
    key: c.key,
    email: c.email,
    password: c.password,
    username: c.username,
    displayName: c.displayName,
    niche: c.niche,
    bio: c.bio,
    avatarSourceUrl: c.avatarSourceUrl,
  })),
];

// 50 Genuine Seed Posts (2 per creator across all 25 creators)
const INITIAL_SEED_POSTS: SeedPostDef[] = [
  // 1. Ayaan Malik (Travel)
  {
    id: 'post_sogo_seed_01',
    accountKey: 'ayaan_malik',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908735/owwo0bakadajsyqfikb7.jpg',
    caption:
      'Golden hour along the coast. Nothing beats the sound of waves after a long drive down the highway. #travel #coast #roadtrip',
    tags: ['travel', 'coast', 'roadtrip'],
    location: 'Big Sur Coast',
    createdAt: '2026-09-30T08:40:00.000Z',
  },
  {
    id: 'post_sogo_seed_09',
    accountKey: 'ayaan_malik',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Crossing the emerald mountain lake by wooden boat before the morning mist clears. #travel #alps #adventure',
    tags: ['travel', 'alps', 'adventure'],
    location: 'Lake Braies',
    createdAt: '2026-09-28T19:20:00.000Z',
  },

  // 2. Sara Khan (Lifestyle)
  {
    id: 'post_sogo_seed_07',
    accountKey: 'sara_khan',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908750/mhz28dmq1bw7euc2uoan.jpg',
    caption:
      'Taking twenty minutes unplugged with a notebook and afternoon sunlight. Simple everyday reset. #lifestyle #everyday #mindful',
    tags: ['lifestyle', 'everyday', 'mindful'],
    location: 'Home Studio',
    createdAt: '2026-09-30T04:15:00.000Z',
  },
  {
    id: 'post_sogo_seed_10',
    accountKey: 'sara_khan',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Fresh linen, indoor greenery, and quiet weekend morning light in the living room. #lifestyle #interiors #slowliving',
    tags: ['lifestyle', 'interiors', 'slowliving'],
    location: 'Sunny Corner',
    createdAt: '2026-09-28T11:45:00.000Z',
  },

  // 3. Hamza Ali (Fitness)
  {
    id: 'post_sogo_seed_11',
    accountKey: 'hamza_ali',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Evening barbell strength session wrapped up. Focusing on clean form and progressive overload this block. #fitness #strength #training',
    tags: ['fitness', 'strength', 'training'],
    location: 'Iron Athletics',
    createdAt: '2026-09-29T21:25:00.000Z',
  },
  {
    id: 'post_sogo_seed_12',
    accountKey: 'hamza_ali',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=1200&auto=format&fit=crop&q=85',
    caption:
      '5K sunrise tempo run on the ridge trail before the city wakes up. #fitness #running #cardio',
    tags: ['fitness', 'running', 'cardio'],
    location: 'Ridge Trail',
    createdAt: '2026-09-28T06:50:00.000Z',
  },

  // 4. Maya Ahmed (Food)
  {
    id: 'post_sogo_seed_02',
    accountKey: 'maya_ahmed',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908737/yb8eh3niop85pbdd3pnx.jpg',
    caption:
      'Slow morning routine with a warm flat white and fresh pastry before testing new recipes in the kitchen. #food #coffee #bakery',
    tags: ['food', 'coffee', 'bakery'],
    location: 'Neighborhood Roasters',
    createdAt: '2026-09-29T16:30:00.000Z',
  },
  {
    id: 'post_sogo_seed_05',
    accountKey: 'maya_ahmed',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908744/t1xyqgmnvyq7lt6oftfo.jpg',
    caption:
      'Fresh out of the wood-fired oven with sweet crushed tomatoes, mozzarella, and garden basil. #food #pizza #homemade',
    tags: ['food', 'pizza', 'homemade'],
    location: 'Test Kitchen',
    createdAt: '2026-09-27T20:15:00.000Z',
  },

  // 5. Daniyal Raza (Technology)
  {
    id: 'post_sogo_seed_03',
    accountKey: 'daniyal_raza',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908740/hzew7fpbcn7rry5iebi6.jpg',
    caption:
      'Clean desk, clear mind. Tweaked the ambient lighting on the workspace setup for afternoon coding sessions. #technology #workspace #setup',
    tags: ['technology', 'workspace', 'setup'],
    location: 'Dev Studio',
    createdAt: '2026-09-29T09:15:00.000Z',
  },
  {
    id: 'post_sogo_seed_13',
    accountKey: 'daniyal_raza',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Late-night systems debugging and performance profiling. Love when a clean architecture comes together. #technology #coding #engineering',
    tags: ['technology', 'coding', 'engineering'],
    location: 'Build Lab',
    createdAt: '2026-09-27T17:40:00.000Z',
  },

  // 6. Hira Noor (Fashion)
  {
    id: 'post_sogo_seed_14',
    accountKey: 'hira_noor',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Autumn layering in structured wool and warm neutral tones for an afternoon in the design district. #fashion #streetstyle #minimalstyle',
    tags: ['fashion', 'streetstyle', 'minimalstyle'],
    location: 'Design District',
    createdAt: '2026-09-28T21:05:00.000Z',
  },
  {
    id: 'post_sogo_seed_15',
    accountKey: 'hira_noor',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Curating timeless wardrobe staples—natural linen, soft cashmere, and clean silhouettes. #fashion #wardrobe #style',
    tags: ['fashion', 'wardrobe', 'style'],
    location: 'Atelier Studio',
    createdAt: '2026-09-27T14:10:00.000Z',
  },

  // 7. Marco Rossi (Photography)
  {
    id: 'post_sogo_seed_04',
    accountKey: 'usman_tariq',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908742/vg0qqybil6nbbwj1shz5.jpg',
    caption:
      'Early morning walk with the 35mm lens before the streets wake up. Classic stonework and soft river light. #photography #architecture #streetphotography',
    tags: ['photography', 'architecture', 'streetphotography'],
    location: 'Historic Embankment',
    createdAt: '2026-09-28T16:45:00.000Z',
  },
  {
    id: 'post_sogo_seed_08',
    accountKey: 'usman_tariq',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908752/xhnhkpa6e3l4nsub5d7t.jpg',
    caption:
      'Neon signs reflecting on wet asphalt after a brief evening shower. Shot handheld at 1/60s. #photography #nightphotography #urban',
    tags: ['photography', 'nightphotography', 'urban'],
    location: 'Shinjuku Avenue',
    createdAt: '2026-09-27T11:20:00.000Z',
  },

  // 8. Claire Dubois (Nature)
  {
    id: 'post_sogo_seed_06',
    accountKey: 'zoya_hassan',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&auto=format&fit=crop&q=85',
    preUploadedCloudinaryUrl:
      'https://res.cloudinary.com/eiwwjhkq/image/upload/v1790908748/fe6adrc8hhf5iwojv78h.jpg',
    caption:
      'Crisp mountain air and quiet pine valleys at first light. Worth waking up at 5 AM for views like this. #nature #mountains #outdoors',
    tags: ['nature', 'mountains', 'outdoors'],
    location: 'Alpine Ridge',
    createdAt: '2026-09-28T09:15:00.000Z',
  },
  {
    id: 'post_sogo_seed_16',
    accountKey: 'zoya_hassan',
    sourceImageUrl:
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&auto=format&fit=crop&q=85',
    caption:
      'Golden sunbeams filtering through the old-growth forest canopy along the fern trail. #nature #forest #wilderness',
    tags: ['nature', 'forest', 'wilderness'],
    location: 'Redwood Grove',
    createdAt: '2026-09-27T08:30:00.000Z',
  },
];

const SEED_POSTS: SeedPostDef[] = [
  ...INITIAL_SEED_POSTS,
  ...ALL_EXPANSION_CREATORS.flatMap((c) =>
    c.posts.map((p) => ({
      id: p.id,
      accountKey: c.key,
      sourceImageUrl: p.sourceImageUrl,
      caption: p.caption,
      tags: p.tags,
      location: p.location,
      createdAt: p.createdAt,
    }))
  ),
];

// 25 Genuine Real Video Seed Reels (Strictly 1 per creator across all 25 creators, 10–12s each)
const INITIAL_SEED_REELS: SeedReelDef[] = [
  // 1. Ayaan Malik (Travel)
  {
    id: 'vid_sogo_seed_01',
    accountKey: 'ayaan_malik',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/0/05/Flight_over_Alps_114129_1.webm',
    startSec: 2,
    durationSec: 12,
    caption:
      'Soaring above the snow-covered alpine ridges in clear morning skies. #travel #alps #mountains',
    tags: ['travel', 'alps', 'mountains'],
    createdAt: '2026-09-29T11:20:00.000Z',
  },

  // 2. Sara Khan (Lifestyle)
  {
    id: 'vid_sogo_seed_02',
    accountKey: 'sara_khan',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/2/21/Morning_Espresso_Routine_%28abridged_version%29.webm',
    startSec: 2,
    durationSec: 12,
    caption:
      'Dialing in the morning espresso routine. Nothing beats that quiet first cup of the day. #lifestyle #coffee #morningroutine',
    tags: ['lifestyle', 'coffee', 'morningroutine'],
    createdAt: '2026-09-28T19:40:00.000Z',
  },

  // 3. Hamza Ali (Fitness)
  {
    id: 'vid_sogo_seed_03',
    accountKey: 'hamza_ali',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/a/a4/Snowboarding-hakubagoryu-april2018.webm',
    startSec: 1,
    durationSec: 12,
    caption:
      'Keeping active on the mountain slopes—carving fresh spring snow in Hakuba. #fitness #snowboarding #outdoorsports',
    tags: ['fitness', 'snowboarding', 'outdoorsports'],
    createdAt: '2026-09-28T10:15:00.000Z',
  },

  // 4. Maya Ahmed (Food)
  {
    id: 'vid_sogo_seed_04',
    accountKey: 'maya_ahmed',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/1/1c/Creation_of_a_Papa_Murphy%E2%80%99s_Pizza.webm',
    startSec: 2,
    durationSec: 12,
    caption:
      'Prepping fresh pizza dough, tangy tomato sauce, and toppings from scratch in the kitchen. #food #pizza #kitchen',
    tags: ['food', 'pizza', 'kitchen'],
    createdAt: '2026-09-27T21:30:00.000Z',
  },

  // 5. Daniyal Raza (Technology)
  {
    id: 'vid_sogo_seed_05',
    accountKey: 'daniyal_raza',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/5/53/RoboCupSoccer_Robot_Football_at_2009_German_Open.ogv',
    startSec: 2,
    durationSec: 12,
    caption:
      'Autonomous mini humanoid robots playing a full soccer match—wait for the striker celebration! #technology #robotics #funny',
    tags: ['technology', 'robotics', 'funny'],
    createdAt: '2026-09-27T14:10:00.000Z',
  },

  // 6. Hira Noor (Fashion)
  {
    id: 'vid_sogo_seed_06',
    accountKey: 'hira_noor',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/9/98/Sewing_with_a_1894_Singer_sewing_machine.webm',
    startSec: 2,
    durationSec: 12,
    caption:
      'Behind the scenes in the studio—classic lockstitch tailoring and heritage textile work. #fashion #tailoring #craftsmanship',
    tags: ['fashion', 'tailoring', 'craftsmanship'],
    createdAt: '2026-09-27T04:45:00.000Z',
  },

  // 7. Marco Rossi (Photography)
  {
    id: 'vid_sogo_seed_07',
    accountKey: 'usman_tariq',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/f/fe/Penguin_Ross_Sea_10.ogv',
    startSec: 0,
    durationSec: 11,
    caption:
      'Look at this little penguin waddling across the ice sheet during our polar wildlife shoot! #photography #wildlife #penguins',
    tags: ['photography', 'wildlife', 'penguins'],
    createdAt: '2026-09-26T20:15:00.000Z',
  },

  // 8. Claire Dubois (Nature)
  {
    id: 'vid_sogo_seed_08',
    accountKey: 'zoya_hassan',
    sourceVideoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/f/ff/Sohosrodhara_Waterfall%2C_Sitakund_Eco-Park%2C_Chittagong%2C_Bangladesh.webm',
    startSec: 0,
    durationSec: 11,
    caption:
      'Hidden waterfall tucked deep inside the eco-park trail. Cool mist all around. #nature #waterfall #hiking',
    tags: ['nature', 'waterfall', 'hiking'],
    createdAt: '2026-09-26T13:20:00.000Z',
  },
];

const SEED_REELS: SeedReelDef[] = [
  ...INITIAL_SEED_REELS,
  ...ALL_EXPANSION_CREATORS.flatMap((c) =>
    c.reels.slice(0, 1).map((r) => ({
      id: r.id,
      accountKey: c.key,
      sourceVideoUrl: r.sourceVideoUrl,
      startSec: r.startSec,
      durationSec: r.durationSec,
      caption: r.caption,
      tags: r.tags,
      createdAt: r.createdAt,
    }))
  ),
];

async function uploadImageFileToCloudinary(
  localFilePath: string
): Promise<{ secureUrl: string; publicId: string }> {
  const fileBuffer = fs.readFileSync(localFilePath);
  const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
  const formData = new FormData();
  formData.append('file', blob, path.basename(localFilePath));
  formData.append('upload_preset', UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_IMAGE_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudinary image upload failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { secure_url: string; public_id: string };
  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
  };
}

async function uploadVideoFileToCloudinary(
  localFilePath: string
): Promise<{ videoUrl: string; thumbnailUrl: string; duration: number; publicId: string }> {
  const fileBuffer = fs.readFileSync(localFilePath);
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });
  const formData = new FormData();
  formData.append('file', blob, path.basename(localFilePath));
  formData.append('upload_preset', VIDEO_PRESET);

  const response = await fetch(CLOUDINARY_VIDEO_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudinary video upload failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as {
    secure_url: string;
    thumbnail_url?: string;
    public_id: string;
    duration?: number;
  };
  const videoUrl = data.secure_url;
  const thumbnailUrl = data.thumbnail_url || videoUrl.replace(/\.[a-zA-Z0-9]+$/, '.jpg');

  return {
    videoUrl,
    thumbnailUrl,
    duration: data.duration || 7,
    publicId: data.public_id,
  };
}

const PRE_DOWNLOADED_RAW_MAP: Record<string, string> = {
  'Flight_over_Alps_114129_1.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_09',
  'Snowboarding-hakubagoryu-april2018.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_11',
  'Creation_of_a_Papa_Murphy%E2%80%99s_Pizza.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_12',
  'Sewing_with_a_1894_Singer_sewing_machine.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_14',
  'Conditioning_Drill_3-_Alternate_Staggered_Squat_Jump.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_10',
  'Pottery_01.webm': '/tmp/sogo_seed_media/raw_vid_sogo_seed_15',
};

async function resolveFastWikimediaVideoUrl(originalUrl: string): Promise<string> {
  try {
    const fileName = decodeURIComponent(path.basename(new URL(originalUrl).pathname));
    const apiUrl =
      'https://commons.wikimedia.org/w/api.php?action=query&titles=' +
      encodeURIComponent('File:' + fileName) +
      '&prop=videoinfo&viprop=url|size|duration|derivatives&format=json';
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'SogoSocialApp/1.0 (https://sogosocial.app; dev@sogosocial.app)',
      },
    });
    if (!res.ok) return originalUrl;
    const data = (await res.json()) as any;
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const derivatives = (pages[0]?.videoinfo?.[0]?.derivatives || []) as Array<{
      src: string;
      transcodekey?: string;
      width?: number;
      bandwidth?: number;
    }>;
    const preferred =
      derivatives.find((d) => d.transcodekey === '720p.vp9.webm') ||
      derivatives.find((d) => d.transcodekey === '480p.vp9.webm') ||
      derivatives.find((d) => d.transcodekey === '360p.vp9.webm') ||
      derivatives.find((d) => d.transcodekey?.endsWith('.webm') && d.transcodekey !== '240p.vp9.webm');
    return preferred?.src || originalUrl;
  } catch {
    return originalUrl;
  }
}

async function downloadFile(url: string, destPath: string, isVideo = false): Promise<void> {
  const baseName = path.basename(new URL(url).pathname);
  if (isVideo && PRE_DOWNLOADED_RAW_MAP[baseName] && fs.existsSync(PRE_DOWNLOADED_RAW_MAP[baseName])) {
    fs.copyFileSync(PRE_DOWNLOADED_RAW_MAP[baseName], destPath);
    return;
  }

  const targetUrl = isVideo ? await resolveFastWikimediaVideoUrl(url) : url;
  const isTranscodedDerivative = targetUrl.includes('/transcoded/');

  for (let attempt = 1; attempt <= 5; attempt++) {
    const headers: Record<string, string> = {
      'User-Agent': 'SogoSocialApp/1.0 (https://sogosocial.app; dev@sogosocial.app)',
      Accept: isVideo
        ? 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.8'
        : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (isVideo && !isTranscodedDerivative) {
      headers['Range'] = 'bytes=0-12582912';
    }
    const res = await fetch(targetUrl, { headers });
    if (res.ok || res.status === 206) {
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      return;
    }
    if (res.status === 429 && attempt < 5) {
      const waitMs = attempt * 2500;
      console.log(`  Rate limited (429) on ${path.basename(targetUrl)}, waiting ${waitMs}ms before retry ${attempt}/5...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Failed to download ${targetUrl}: HTTP ${res.status}`);
  }
}

function transcodeToVerticalReelMp4(
  inputUrlOrPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number
): void {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(startSec),
      '-t',
      String(durationSec),
      '-i',
      inputUrlOrPath,
      '-vf',
      'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=24',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { stdio: 'pipe' }
  );
}

async function cleanupLegacyBrandSeedAccounts(auth: ReturnType<typeof getAuth>, db: ReturnType<typeof getFirestore>) {
  console.log('=== Step 0: Cleaning Up Legacy Brand Seed Accounts (sogo_official, sogo_discover, sogo_daily) ===');
  const legacyPostIds = [
    'post_sogo_seed_01',
    'post_sogo_seed_02',
    'post_sogo_seed_03',
    'post_sogo_seed_04',
    'post_sogo_seed_05',
    'post_sogo_seed_06',
    'post_sogo_seed_07',
    'post_sogo_seed_08',
  ];
  const legacyReelIds = [
    'vid_sogo_seed_01',
    'vid_sogo_seed_02',
    'vid_sogo_seed_03',
    'vid_sogo_seed_04',
    'vid_sogo_seed_05',
    'vid_sogo_seed_06',
    'vid_sogo_seed_07',
    'vid_sogo_seed_08',
  ];

  for (const legacy of LEGACY_BRAND_SEED_ACCOUNTS) {
    try {
      const cred = await signInWithEmailAndPassword(auth, legacy.email, legacy.password);
      const legacyUid = cred.user.uid;

      // Remove any posts/reels currently owned by this legacy UID so they can be reassigned to the new creator accounts
      for (const pid of legacyPostIds) {
        const pRef = doc(db, 'posts', pid);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists() && pSnap.data()?.userId === legacyUid) {
          await deleteDoc(pRef);
          console.log(`Removed legacy ownership of ${pid} from @${legacy.username}`);
        }
      }

      for (const vid of legacyReelIds) {
        const vRef = doc(db, 'videos', vid);
        const vSnap = await getDoc(vRef);
        if (vSnap.exists() && vSnap.data()?.userId === legacyUid) {
          await deleteDoc(vRef);
          console.log(`Removed legacy ownership of ${vid} from @${legacy.username}`);
        }
      }

      // Delete the legacy user profile document from /users/{legacyUid}
      const uRef = doc(db, 'users', legacyUid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        await deleteDoc(uRef);
        console.log(`Deleted legacy user profile document @${legacy.username} (${legacyUid})`);
      }
    } catch {
      // Legacy account does not exist or already cleaned
    }
  }
}

async function main() {
  const isCleanMode = process.argv.includes('--clean');
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  if (process.argv.includes('--clean-legacy')) {
    await cleanupLegacyBrandSeedAccounts(auth, db);
  }

  if (isCleanMode) {
    console.log('Cleaning all Sogo creator seed accounts, Posts, and Reels...');
    for (const acc of SEED_CREATOR_ACCOUNTS) {
      try {
        const cred = await signInWithEmailAndPassword(auth, acc.email, acc.password);
        for (const p of SEED_POSTS.filter((x) => x.accountKey === acc.key)) {
          await deleteDoc(doc(db, 'posts', p.id)).catch(() => {});
          console.log('Deleted seed post:', p.id);
        }
        for (const r of SEED_REELS.filter((x) => x.accountKey === acc.key)) {
          await deleteDoc(doc(db, 'videos', r.id)).catch(() => {});
          console.log('Deleted seed reel:', r.id);
        }
        await deleteDoc(doc(db, 'users', cred.user.uid)).catch(() => {});
        console.log(`Deleted seed creator profile @${acc.username} (${cred.user.uid})`);
      } catch (err: any) {
        console.warn(`Could not clean account ${acc.username}:`, err?.message);
      }
    }
    console.log('Clean complete.');
    process.exit(0);
  }

  const accountMap: Record<
    CreatorSeedKey,
    {
      key: CreatorSeedKey;
      uid: string;
      username: string;
      displayName: string;
      niche: string;
      bio: string;
      avatarUrl: string;
      email: string;
      password: string;
    }
  > = {} as any;

  const seededPostsSummary: Array<{
    id: string;
    username: string;
    displayName: string;
    niche: string;
    imageUrl: string;
    createdAt: string;
  }> = [];

  const seededReelsSummary: Array<{
    id: string;
    username: string;
    displayName: string;
    niche: string;
    videoUrl: string;
    thumbnailUrl: string;
    duration: number;
    createdAt: string;
  }> = [];

  console.log('\n=== Seeding 25 Creator-Style Accounts, 50 Genuine Posts, and 50 Genuine Reels ===');
  for (let cIdx = 0; cIdx < SEED_CREATOR_ACCOUNTS.length; cIdx++) {
    const acc = SEED_CREATOR_ACCOUNTS[cIdx];
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, acc.email, acc.password);
      console.log(`[${cIdx + 1}/25] Signed in existing creator @${acc.username} (${cred.user.uid})`);
    } catch {
      cred = await createUserWithEmailAndPassword(auth, acc.email, acc.password);
      console.log(`[${cIdx + 1}/25] Created new creator @${acc.username} (${cred.user.uid})`);
    }

    const uid = cred.user.uid;
    const userRef = doc(db, 'users', uid);
    const existingSnap = await getDoc(userRef);
    let avatarUrl = existingSnap.exists() ? existingSnap.data()?.avatarUrl : '';
    const existingAvatarSource = existingSnap.exists() ? existingSnap.data()?.seedAvatarSource : '';

    if (
      !avatarUrl ||
      !avatarUrl.includes('res.cloudinary.com') ||
      (existingAvatarSource && existingAvatarSource !== acc.avatarSourceUrl)
    ) {
      const localAvatarPath = path.join(TMP_DIR, `avatar_${acc.username}.jpg`);
      await downloadFile(acc.avatarSourceUrl, localAvatarPath, false);
      const uploaded = await uploadImageFileToCloudinary(localAvatarPath);
      avatarUrl = uploaded.secureUrl;
      console.log(`Uploaded Cloudinary avatar for @${acc.username}: ${avatarUrl}`);
    }

    const nowIso = new Date().toISOString();
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        id: uid,
        username: acc.username,
        displayName: acc.displayName,
        fullName: acc.displayName,
        bio: acc.bio,
        avatarUrl,
        photoURL: avatarUrl,
        seedAvatarSource: acc.avatarSourceUrl,
        followersCount: 0,
        followingCount: 0,
        postsCount: 2,
        status: 'active',
        isOnboarded: true,
        onboardingCompleted: true,
        isSeedAccount: true,
        seedAccountKey: acc.key,
        seedNiche: acc.niche,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      await setDoc(
        userRef,
        {
          id: uid,
          username: acc.username,
          displayName: acc.displayName,
          fullName: acc.displayName,
          bio: acc.bio,
          avatarUrl,
          photoURL: avatarUrl,
          seedAvatarSource: acc.avatarSourceUrl,
          postsCount: 2,
          status: 'active',
          isOnboarded: true,
          onboardingCompleted: true,
          isSeedAccount: true,
          seedAccountKey: acc.key,
          seedNiche: acc.niche,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }

    accountMap[acc.key] = {
      key: acc.key,
      uid,
      username: acc.username,
      displayName: acc.displayName,
      niche: acc.niche,
      bio: acc.bio,
      avatarUrl,
      email: acc.email,
      password: acc.password,
    };

    const creatorPosts = SEED_POSTS.filter((p) => p.accountKey === acc.key);
    for (const postDef of creatorPosts) {
      const postRef = doc(db, 'posts', postDef.id);
      const existingPostSnap = await getDoc(postRef);

      let imageUrl = existingPostSnap.exists() ? existingPostSnap.data()?.imageUrl : '';
      const existingImgSource = existingPostSnap.exists() ? existingPostSnap.data()?.seedImageSource : '';
      let uploadedNewImage = false;

      if (
        !imageUrl ||
        !imageUrl.includes('res.cloudinary.com') ||
        (existingImgSource && existingImgSource !== postDef.sourceImageUrl)
      ) {
        if (postDef.preUploadedCloudinaryUrl) {
          imageUrl = postDef.preUploadedCloudinaryUrl;
        } else {
          const localImgPath = path.join(TMP_DIR, `${postDef.id}.jpg`);
          await downloadFile(postDef.sourceImageUrl, localImgPath, false);
          const uploaded = await uploadImageFileToCloudinary(localImgPath);
          imageUrl = uploaded.secureUrl;
          uploadedNewImage = true;
        }
      }

      await setDoc(
        postRef,
        {
          id: postDef.id,
          userId: uid,
          user: {
            id: uid,
            username: acc.username,
            displayName: acc.displayName,
            avatarUrl,
            isVerified: false,
          },
          imageUrl,
          seedImageSource: postDef.sourceImageUrl,
          caption: postDef.caption,
          tags: postDef.tags,
          location: postDef.location,
          likesCount: existingPostSnap.exists() ? Number(existingPostSnap.data()?.likesCount) || 0 : 0,
          commentsCount: existingPostSnap.exists() ? Number(existingPostSnap.data()?.commentsCount) || 0 : 0,
          viewsCount: existingPostSnap.exists() ? Number(existingPostSnap.data()?.viewsCount) || 0 : 0,
          repostsCount: existingPostSnap.exists() ? Number(existingPostSnap.data()?.repostsCount) || 0 : 0,
          isSeedContent: true,
          isSeedAccount: true,
          seedKey: postDef.id,
          seedNiche: acc.niche,
          createdAt: postDef.createdAt,
        },
        { merge: true }
      );
      console.log(
        `  [POST ${uploadedNewImage ? 'SEEDED' : 'UPDATED'}] ${postDef.id} (@${acc.username}) -> ${imageUrl}`
      );

      seededPostsSummary.push({
        id: postDef.id,
        username: acc.username,
        displayName: acc.displayName,
        niche: acc.niche,
        imageUrl,
        createdAt: postDef.createdAt,
      });
    }

    const creatorReels = SEED_REELS.filter((r) => r.accountKey === acc.key).slice(0, 1);
    for (let rIdx = 0; rIdx < creatorReels.length; rIdx++) {
      const reelDef = creatorReels[rIdx];
      const videoRef = doc(db, 'videos', reelDef.id);
      const existingReelSnap = await getDoc(videoRef);

      let videoUrl = existingReelSnap.exists() ? existingReelSnap.data()?.videoUrl : '';
      let thumbnailUrl = existingReelSnap.exists() ? existingReelSnap.data()?.thumbnailUrl : '';
      let duration = existingReelSnap.exists()
        ? Number(existingReelSnap.data()?.duration) || reelDef.durationSec
        : reelDef.durationSec;
      let publicId = existingReelSnap.exists() ? existingReelSnap.data()?.publicId || '' : '';
      const existingVideoSource = existingReelSnap.exists()
        ? existingReelSnap.data()?.seedVideoSource || ''
        : '';
      const targetVideoSource =
        reelDef.preUploadedCloudinaryVideoUrl ||
        reelDef.sourceVideoUrl ||
        '';

      const alreadyHasTargetVideo =
        Boolean(videoUrl && videoUrl.includes('res.cloudinary.com')) &&
        existingVideoSource === targetVideoSource &&
        duration >= 8;

      let uploadedNewVideo = false;
      if (!alreadyHasTargetVideo) {
        if (reelDef.preUploadedCloudinaryVideoUrl && reelDef.preUploadedCloudinaryThumbUrl) {
          videoUrl = reelDef.preUploadedCloudinaryVideoUrl;
          thumbnailUrl = reelDef.preUploadedCloudinaryThumbUrl;
          duration = reelDef.preUploadedDuration || reelDef.durationSec;
        } else if (reelDef.sourceVideoUrl) {
          const ext = path.extname(new URL(reelDef.sourceVideoUrl).pathname) || '.webm';
          const rawSourcePath = path.join(TMP_DIR, `raw_v3_${reelDef.id}${ext}`);
          const localMp4Path = path.join(TMP_DIR, `v3_${reelDef.id}.mp4`);
          if (!fs.existsSync(rawSourcePath) || fs.statSync(rawSourcePath).size < 10000) {
            await downloadFile(reelDef.sourceVideoUrl, rawSourcePath, true);
          }
          if (!fs.existsSync(localMp4Path) || fs.statSync(localMp4Path).size < 10000) {
            transcodeToVerticalReelMp4(
              rawSourcePath,
              localMp4Path,
              reelDef.startSec,
              reelDef.durationSec
            );
          }
          const uploaded = await uploadVideoFileToCloudinary(localMp4Path);
          videoUrl = uploaded.videoUrl;
          thumbnailUrl = uploaded.thumbnailUrl;
          duration = Math.max(8, Math.round(uploaded.duration || reelDef.durationSec));
          publicId = uploaded.publicId;
          uploadedNewVideo = true;
        }
      }

      await setDoc(
        videoRef,
        {
          id: reelDef.id,
          userId: uid,
          user: {
            id: uid,
            username: acc.username,
            displayName: acc.displayName,
            avatarUrl,
            isVerified: false,
          },
          videoUrl,
          thumbnailUrl,
          seedVideoSource: targetVideoSource,
          caption: reelDef.caption,
          tags: reelDef.tags,
          likesCount: existingReelSnap.exists() ? Number(existingReelSnap.data()?.likesCount) || 0 : 0,
          commentsCount: existingReelSnap.exists() ? Number(existingReelSnap.data()?.commentsCount) || 0 : 0,
          viewsCount: existingReelSnap.exists() ? Number(existingReelSnap.data()?.viewsCount) || 0 : 0,
          sharesCount: existingReelSnap.exists() ? Number(existingReelSnap.data()?.sharesCount) || 0 : 0,
          repostsCount: existingReelSnap.exists() ? Number(existingReelSnap.data()?.repostsCount) || 0 : 0,
          duration,
          publicId,
          isSeedContent: true,
          isSeedAccount: true,
          seedKey: reelDef.id,
          seedNiche: acc.niche,
          createdAt: reelDef.createdAt,
        },
        { merge: true }
      );
      console.log(
        `  [REEL ${uploadedNewVideo ? 'SEEDED' : 'UPDATED'}] ${reelDef.id} (@${acc.username}) -> ${videoUrl}`
      );

      seededReelsSummary.push({
        id: reelDef.id,
        username: acc.username,
        displayName: acc.displayName,
        niche: acc.niche,
        videoUrl,
        thumbnailUrl,
        duration,
        createdAt: reelDef.createdAt,
      });
    }

    const partialManifest = {
      seededAt: new Date().toISOString(),
      accounts: Object.values(accountMap).map((a) => ({
        uid: a.uid,
        username: a.username,
        displayName: a.displayName,
        niche: a.niche,
        bio: a.bio,
        avatarUrl: a.avatarUrl,
        isSeedAccount: true,
        isVerified: false,
        postsAssigned: SEED_POSTS.filter((p) => p.accountKey === a.key).map((p) => p.id),
        reelsAssigned: SEED_REELS.filter((r) => r.accountKey === a.key).map((r) => r.id),
      })),
      posts: seededPostsSummary,
      reels: seededReelsSummary,
    };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(partialManifest, null, 2));
  }

  const manifest = {
    seededAt: new Date().toISOString(),
    accounts: Object.values(accountMap).map((a) => ({
      uid: a.uid,
      username: a.username,
      displayName: a.displayName,
      niche: a.niche,
      bio: a.bio,
      avatarUrl: a.avatarUrl,
      isSeedAccount: true,
      isVerified: false,
      postsAssigned: SEED_POSTS.filter((p) => p.accountKey === a.key).map((p) => p.id),
      reelsAssigned: SEED_REELS.filter((r) => r.accountKey === a.key).map((r) => r.id),
    })),
    posts: seededPostsSummary,
    reels: seededReelsSummary,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved seed manifest to ${MANIFEST_PATH}`);
  console.log('All 25 creator seed accounts, 50 Posts, and 50 Reels created/verified successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
