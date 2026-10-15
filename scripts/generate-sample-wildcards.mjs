/**
 * Generates the shipped SFW sample_wildcards library.
 * Run: node scripts/generate-sample-wildcards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'sample_wildcards');

function write(rel, body) {
  const abs = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const text = String(body).replace(/\r\n/g, '\n').trimEnd() + '\n';
  fs.writeFileSync(abs, text, 'utf8');
}

function lines(...items) {
  return items.flat().filter(Boolean).join('\n');
}

// Wipe and recreate so generation is deterministic.
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Master root — named 0main so it sorts first without using "!", which some
// ComfyUI Dynamic Prompts setups reject in wildcard filenames.
// ---------------------------------------------------------------------------
write(
  '0main.txt',
  lines(
    '# Sample master prompt for Wildcards Manager.',
    '# Open this folder as a library root and select 0main.txt.',
    '',
    '__people-count__, __age__, __race__, {__gender-male__, __clothes-male__, __hairstyle-male__ | __gender-female__, __clothes-female__, __hairstyle-female__ {|, __jewelry__}} {|, __expression__} {|, __view__} {|, __pose__} {|, __location__} {|, __lighting__} {|, __style__}',
  ),
);

// ---------------------------------------------------------------------------
// People basics
// ---------------------------------------------------------------------------
write(
  'people-count.txt',
  lines(
    'one person',
    'a single person',
    'solo portrait of one person',
    '{two|three} persons',
    'a pair of people',
    'a small group of {three|four|five} people',
    'a {group|crowd} of people',
    'several people in the frame',
    'a gathering of people',
  ),
);

write(
  'age.txt',
  lines(
    'young adult',
    'adult',
    'middle-aged',
    'elderly',
    'teenager',
    'child',
    'toddler',
    'about {18|20|25|30|35|40|45|50|60|70} years old',
  ),
);

write(
  'race.txt',
  lines(
    'asian',
    'east asian',
    'southeast asian',
    'south asian',
    'korean',
    'japanese',
    'chinese',
    'indian',
    'caucasian',
    'white',
    'european',
    'black',
    'african',
    'african american',
    'latino',
    'hispanic',
    'mexican',
    'brazilian',
    'middle eastern',
    'arabic',
    'persian',
    'mixed ethnicity',
  ),
);

write(
  'gender-male.txt',
  lines('man', 'male', 'gentleman', 'boy', 'young man'),
);

write(
  'gender-female.txt',
  lines('woman', 'female', 'lady', 'girl', 'young woman'),
);

// ---------------------------------------------------------------------------
// Clothes — deep female branch + male branch
// ---------------------------------------------------------------------------
write(
  'clothes-female.txt',
  lines(
    '{|__color__,} {|__print-patterns__,} {|,__time-period__} __clothes-female-type__',
    '{|__color__,} {|__fabric__,} __clothes-female-type__',
    '{|__color__,} __clothes-female-type__ with __clothes-female-layer__',
    '__clothes-female-outfit__',
  ),
);

write(
  'clothes-female-type.txt',
  lines(
    'blouse',
    'button-up shirt',
    't-shirt',
    'sweater',
    'cardigan',
    'hoodie',
    'dress',
    'sundress',
    'midi dress',
    'maxi dress',
    'skirt',
    'pleated skirt',
    'jeans',
    'trousers',
    'wide-leg pants',
    'shorts',
    'jumpsuit',
    'overalls',
    'blazer',
    'coat',
    'trench coat',
    'jacket',
    'raincoat',
    'kimono-inspired wrap',
    'hanbok-inspired outfit',
    'business suit',
    'athletic wear',
    'school uniform style outfit',
    'cottagecore dress',
    'formal evening dress',
    'wrap dress',
    'shirt dress',
    'pencil skirt',
    'cargo pants',
    'leggings with a tunic',
    'peacoat',
    'parka',
    'bomber jacket',
    'vest over a blouse',
  ),
);

write(
  'clothes-female-layer.txt',
  lines(
    'a light scarf',
    'a denim jacket',
    'a wool coat',
    'a cropped cardigan',
    'a tailored blazer',
    'a quilted vest',
    'a soft shawl',
    'an open trench coat',
  ),
);

write(
  'clothes-female-outfit.txt',
  lines(
    'casual streetwear outfit',
    'minimalist outfit',
    'preppy chic outfit',
    'bohemian outfit',
    'classic vintage outfit',
    'elegant formal outfit',
    'sporty athleisure outfit',
    'business casual outfit',
    'romantic floral outfit',
    'cozy knitwear outfit',
    'smart summer vacation look',
    'layered autumn outfit',
    'winter outerwear look',
    'artsy eclectic outfit',
    'monochrome tailored look',
  ),
);

write(
  'clothes-male.txt',
  lines(
    '{|__color__,} {|__fabric__,} {|,__time-period__} __clothes-male-type__',
    '{|__color__,} __clothes-male-type__ with __clothes-male-layer__',
    '__clothes-male-outfit__',
  ),
);

write(
  'clothes-male-type.txt',
  lines(
    't-shirt',
    'polo shirt',
    'button-up shirt',
    'oxford shirt',
    'sweater',
    'hoodie',
    'jeans',
    'chinos',
    'trousers',
    'shorts',
    'suit',
    'blazer',
    'jacket',
    'bomber jacket',
    'coat',
    'trench coat',
    'vest',
    'overalls',
    'workwear shirt',
    'flannel shirt',
  ),
);

write(
  'clothes-male-layer.txt',
  lines(
    'a denim jacket',
    'a wool overcoat',
    'a field jacket',
    'a knit cardigan',
    'a tailored blazer',
    'a rain shell',
    'a quilted vest',
  ),
);

write(
  'clothes-male-outfit.txt',
  lines(
    'casual everyday outfit',
    'smart casual outfit',
    'business formal suit',
    'streetwear outfit',
    'outdoor hiking outfit',
    'preppy campus look',
    'minimalist wardrobe look',
    'rugged workwear outfit',
    'athletic training outfit',
    'evening formalwear',
  ),
);

write(
  'fabric.txt',
  lines(
    'cotton',
    'linen',
    'denim',
    'wool',
    'flannel',
    'tweed',
    'jersey',
    'fleece',
    'corduroy',
    'suede',
    'leather',
    'silk',
    'satin',
    'chiffon',
    'knit',
    'canvas',
    'velvet',
  ),
);

write(
  'color.txt',
  lines(
    'red',
    'crimson',
    'green',
    'emerald',
    'blue',
    'navy blue',
    'sky blue',
    'yellow',
    'gold',
    'pink',
    'rose',
    'orange',
    'purple',
    'violet',
    'black',
    'white',
    'ivory',
    'gray',
    'charcoal',
    'brown',
    'beige',
    'tan',
    'teal',
    'turquoise',
    'maroon',
    'olive',
    '{light|dark|vivid|pastel|muted} {red|blue|green|pink|purple|yellow|orange}',
  ),
);

write(
  'print-patterns.txt',
  lines(
    'solid color',
    'striped',
    'plaid',
    'checkered',
    'polka dot',
    'floral print',
    'geometric print',
    'abstract print',
    'paisley',
    'animal-inspired print',
    'camouflage pattern',
    'color-block',
    'tie-dye',
    'herringbone',
    'argyle',
    'subtle texture',
  ),
);

write(
  'time-period.txt',
  lines(
    'medieval',
    'renaissance',
    'victorian',
    'edwardian',
    '1920s',
    '1950s',
    '1960s',
    '1970s',
    '1980s',
    '1990s',
    'modern',
    'contemporary',
    'futuristic',
    'cyberpunk-inspired',
    'steampunk-inspired',
    'fantasy historical',
  ),
);

// ---------------------------------------------------------------------------
// Hair, jewelry, expression
// ---------------------------------------------------------------------------
write(
  'hairstyle-male.txt',
  lines(
    'short hair',
    'crew cut',
    'fade haircut',
    'side part',
    'messy hair',
    'slicked back hair',
    'wavy hair',
    'curly hair',
    'buzz cut',
    'undercut',
    'medium-length hair',
    'long hair tied back',
    'bald head',
    '{black|brown|blonde|auburn|gray|silver} hair',
  ),
);

write(
  'hairstyle-female.txt',
  lines(
    'long straight hair',
    'long wavy hair',
    'curly hair',
    'bob haircut',
    'pixie cut',
    'ponytail',
    'high ponytail',
    'braided hair',
    'twin braids',
    'bun',
    'messy bun',
    'half-up hairstyle',
    'shoulder-length hair',
    'layered hair',
    'bangs',
    'side-swept bangs',
    '{black|brown|blonde|auburn|red|silver} hair',
  ),
);

write(
  'jewelry.txt',
  lines(
    'simple necklace',
    'pendant necklace',
    'stud earrings',
    'hoop earrings',
    'drop earrings',
    'bracelet',
    'watch',
    'ring',
    'layered necklaces',
    'thin gold chain',
    'silver bracelet',
    'beaded bracelet',
    'hair pin',
    'brooch',
  ),
);

write(
  'expression.txt',
  lines(
    '__expression-face__',
    '__expression-face__, __expression-attitude__',
    '__expression-eyes__, __expression-face__',
  ),
);

write(
  'expression-face.txt',
  lines(
    'smiling',
    'gentle smile',
    'soft smile',
    'laughing',
    'serious expression',
    'thoughtful expression',
    'calm expression',
    'surprised look',
    'curious look',
    'confident expression',
    'warm expression',
    'neutral expression',
  ),
);

write(
  'expression-attitude.txt',
  lines(
    'friendly',
    'confident',
    'shy',
    'cheerful',
    'relaxed',
    'focused',
    'playful',
    'composed',
    'determined',
    'approachable',
  ),
);

write(
  'expression-eyes.txt',
  lines(
    'looking at viewer',
    'looking away',
    'looking to the side',
    'looking upward',
    'looking downward',
    'closed eyes',
    'half-lidded eyes',
    'bright eyes',
    'soft gaze',
  ),
);

// ---------------------------------------------------------------------------
// View / pose
// ---------------------------------------------------------------------------
write(
  'view.txt',
  lines(
    'close-up portrait',
    'extreme close-up',
    'head and shoulders shot',
    'bust shot',
    'medium shot',
    'waist-up shot',
    'three-quarter shot',
    'full body shot',
    'wide shot',
    'long shot',
    'eye-level camera angle',
    'low angle',
    'high angle',
    'top view',
    'bird\'s-eye view',
    'side view',
    'profile view',
    'front view',
    'rear view',
    'over-the-shoulder shot',
    'dutch angle',
    'from above',
    'from below',
    'from behind',
    'shallow depth of field',
    'rule of thirds composition',
  ),
);

write(
  'pose.txt',
  lines(
    'standing',
    'standing casually',
    'standing with arms crossed',
    'sitting',
    'sitting upright',
    'sitting on a {chair|stool|bench|box|steps|sofa}',
    'one foot resting on a {chair|stool|bench|box}',
    'leaning against a wall',
    'leaning on a railing',
    'walking',
    'walking toward the camera',
    'running',
    'crouching',
    'kneeling',
    'looking over the shoulder',
    'hands in pockets',
    'holding a book',
    'holding a cup',
    'waving',
    'stretching',
    'reading',
    'writing',
    'working at a desk',
    'posing for a portrait',
  ),
);

// ---------------------------------------------------------------------------
// Location tree
// ---------------------------------------------------------------------------
write(
  'location.txt',
  lines(
    '{__indoor__|__outdoor__}',
    'indoors, __indoor__',
    'outdoors, __outdoor__',
  ),
);

write(
  'indoor.txt',
  lines(
    '__indoor-home__',
    '__indoor-work__',
    '__indoor-public__',
    '__indoor-architecture__',
  ),
);

write(
  'indoor-home.txt',
  lines(
    'modern kitchen interior with cabinets and a stove',
    'cozy living room with a sofa and warm lamps',
    'sunroom filled with plants and soft daylight',
    'home office with a desk, monitor, and bookshelf',
    'library nook with tall bookshelves',
    'bedroom with neat bedding and soft curtains',
    'dining room with a wooden table set for a meal',
    'hallway with framed artwork',
    'attic studio with skylights',
    'basement workshop with tools neatly arranged',
    'gaming room with soft LED accent lighting',
    'laundry room with folded towels',
  ),
);

write(
  'indoor-work.txt',
  lines(
    'open-plan office with desks and monitors',
    'conference room with a long table',
    'design studio with drafting tables',
    'classroom with desks and a whiteboard',
    'hospital corridor with clean lighting',
    'laboratory with glassware and instruments',
    'factory floor with machinery',
    'warehouse aisle with stacked crates',
    'garage workshop',
    'recording studio with acoustic panels',
    'photography studio with softboxes',
    'bakery kitchen with ovens and trays',
  ),
);

write(
  'indoor-public.txt',
  lines(
    'museum gallery with framed paintings',
    'art gallery opening',
    'public library reading room',
    'cafe interior with wooden tables',
    'bookstore aisle',
    'train station concourse',
    'airport terminal',
    'hotel lobby with a reception desk',
    'hotel room with a neat bed and city view',
    'theater lobby',
    'concert hall seats',
    'shopping mall atrium',
    'gym interior',
    'indoor swimming pool',
    'bowling alley',
    'karaoke room',
    'restaurant dining room',
    'bakery shop interior',
    'pharmacy aisle',
    'post office counter',
    'bank lobby',
    'medical clinic waiting room',
    'bus interior with passengers',
    'train carriage',
    'airplane cabin',
    'classroom with desks and a blackboard',
    'university lecture hall',
    'church interior with pews',
    'community center hall',
    'amusement arcade',
  ),
);

write(
  'indoor-architecture.txt',
  lines(
    '{modern|historic|minimalist} interior with __architecture-walls__ and __architecture-floors__',
    'grand hall with __architecture-ceilings__',
    'corridor featuring __architecture-details__',
  ),
);

write(
  'architecture-walls.txt',
  lines(
    'white plaster walls',
    'exposed brick walls',
    'wood-paneled walls',
    'concrete walls',
    'wallpapered walls',
    'stone walls',
    'painted murals',
  ),
);

write(
  'architecture-floors.txt',
  lines(
    'hardwood floors',
    'polished concrete floors',
    'marble floors',
    'tile floors',
    'carpeted floors',
    'stone floors',
  ),
);

write(
  'architecture-ceilings.txt',
  lines(
    'high vaulted ceilings',
    'wooden beam ceilings',
    'coffered ceilings',
    'skylight ceilings',
    'industrial metal ceilings',
  ),
);

write(
  'architecture-details.txt',
  lines(
    'arched windows',
    'stained glass windows',
    'ornate columns',
    'spiral staircase',
    'balcony railing',
    'large glass doors',
    'fireplace mantel',
    'built-in bookshelves',
  ),
);

write(
  'outdoor.txt',
  lines(
    '__outdoor-city__',
    '__outdoor-nature__',
    '__outdoor-water__',
    '__outdoor-rural__',
  ),
);

write(
  'outdoor-city.txt',
  lines(
    'city street',
    'busy downtown sidewalk',
    'quiet residential street',
    'rooftop terrace overlooking the city',
    'park bench in a city park',
    'plaza with a fountain',
    'bridge over a river',
    'market street with stalls',
    'courtyard garden',
    'university campus walkway',
    'train platform outdoors',
    'neon-lit night street',
    'pedestrian crossing',
    'outdoor cafe seating',
    'city park pathway',
    'festival street with food stalls',
    'amusement park promenade',
    'stadium entrance',
    'harbor promenade',
    'subway entrance stairs',
  ),
);

write(
  'outdoor-nature.txt',
  lines(
    'forest path',
    'pine forest clearing',
    'mountain trail',
    'alpine meadow',
    'desert canyon',
    'rocky hillside',
    'flower field',
    'autumn forest',
    'snowy landscape',
    'misty valley',
    'cliff overlook',
    'bamboo grove',
  ),
);

write(
  'outdoor-water.txt',
  lines(
    'sandy beach',
    'rocky shoreline',
    'lakeside dock',
    'riverbank',
    'waterfall viewpoint',
    'harbor waterfront',
    'boardwalk by the sea',
    'calm pond with reflections',
    'tropical lagoon',
    'pier at sunset',
  ),
);

write(
  'outdoor-rural.txt',
  lines(
    'farmyard',
    'wheat field',
    'orchard',
    'vineyard rows',
    'countryside dirt road',
    'barn exterior',
    'camping site among trees',
    'cottage garden',
    'windmill field',
    'rolling green hills',
  ),
);

// ---------------------------------------------------------------------------
// Lighting / style
// ---------------------------------------------------------------------------
write(
  'lighting.txt',
  lines(
    '__lighting-quality__',
    '__lighting-time__',
    '__lighting-source__',
    '__lighting-quality__, __lighting-source__',
    '__lighting-time__, __lighting-quality__',
  ),
);

write(
  'lighting-quality.txt',
  lines(
    'soft lighting',
    'hard lighting',
    'diffused lighting',
    'high-key lighting',
    'low-key lighting',
    'dramatic lighting',
    'even lighting',
    'rim lighting',
    'backlighting',
    'silhouette lighting',
    'volumetric lighting',
    'cinematic lighting',
    'studio lighting',
    'bokeh background lights',
    'overexposed highlights',
    'underexposed mood lighting',
    'high dynamic range look',
  ),
);

write(
  'lighting-time.txt',
  lines(
    'daytime',
    'bright midday sun',
    'golden hour',
    'blue hour',
    'sunrise light',
    'sunset light',
    'overcast daylight',
    'nighttime',
    'moonlit night',
    'twilight',
  ),
);

write(
  'lighting-source.txt',
  lines(
    'natural light',
    'window light',
    'skylight illumination',
    'sunbeams',
    'candlelight',
    'lantern light',
    'street lamp light',
    'neon lights',
    'fluorescent lights',
    'LED panel light',
    'spotlight',
    'practical lamps',
    'fireplace glow',
    'screen glow',
    'flash photography lighting',
  ),
);

write(
  'style.txt',
  lines(
    '{__style-quality__}, {__style-medium__}',
    '{__style-quality__} {__style-medium__}',
    '__style-medium__',
    '__style-quality__',
  ),
);

write(
  'style-quality.txt',
  lines(
    'professional',
    'cinematic',
    'amateur snapshot',
    'documentary',
    'editorial',
    'fashion photography',
    'vintage',
    'retro',
    'modern',
    'minimalist',
    'dramatic',
    'moody',
    'bright and airy',
    'film still',
    'Polaroid-style',
  ),
);

write(
  'style-medium.txt',
  lines(
    'photorealistic',
    'realistic',
    'hyperrealistic',
    'anime',
    'manga style',
    'cartoon',
    'comic book style',
    'watercolor painting',
    'oil painting',
    'acrylic painting',
    'pencil drawing',
    'charcoal sketch',
    'ink illustration',
    'digital painting',
    '3d render',
    'claymation style',
    'pixel art',
    'stained glass style',
  ),
);

// ---------------------------------------------------------------------------
// Bonus demo branches — show more app features (globs, forwarders, depth)
// ---------------------------------------------------------------------------
write(
  'props.txt',
  lines(
    'holding a book',
    'holding a camera',
    'holding a coffee cup',
    'carrying a backpack',
    'holding an umbrella',
    'holding flowers',
    'using a laptop',
    'reading a newspaper',
  ),
);

write(
  'weather.txt',
  lines(
    'clear sky',
    'partly cloudy',
    'overcast',
    'light rain',
    'heavy rain',
    'snowfall',
    'fog',
    'mist',
    'windy',
    'after the rain',
  ),
);

// Optional enrichment used by deeper compositions / demos
write(
  'scene-extras.txt',
  lines(
    '{|, __weather__}',
    '{|, __props__}',
    '{|, __architecture-details__}',
  ),
);

// A clean forwarder example for consolidate demos
write('wc-people.txt', '__people-count__');

// Glob demo folder
write('artists/ink.txt', lines('ink illustration style', 'fine line ink drawing'));
write('artists/paint.txt', lines('impressionist painting style', 'bold brushstroke painting'));
write('artists/photo.txt', lines('editorial photography style', 'natural light photography'));

write(
  'demo-glob.txt',
  lines(
    '# Demonstrates glob references for the graph viewer.',
    'in the style of __artists/*__',
  ),
);

// Shoes / accessories depth
write(
  'shoes-female.txt',
  lines(
    'sneakers',
    'running shoes',
    'ankle boots',
    'knee-high boots',
    'loafers',
    'ballet flats',
    'heels',
    'sandals',
    'rain boots',
    'hiking boots',
  ),
);

write(
  'shoes-male.txt',
  lines(
    'sneakers',
    'leather shoes',
    'loafers',
    'oxford shoes',
    'boots',
    'hiking boots',
    'sandals',
    'dress shoes',
  ),
);

write(
  'glasses.txt',
  lines(
    'eyeglasses',
    'round glasses',
    'rectangular glasses',
    'sunglasses',
    'aviator sunglasses',
    'clear frame glasses',
  ),
);

write(
  'accessories.txt',
  lines(
    '{|__glasses__}',
    '{|__jewelry__}',
    'scarf',
    'belt',
    'watch',
    'backpack',
    'handbag',
    'tote bag',
    'hat',
    'beanie',
    'cap',
  ),
);

// Enrich clothes branches with shoes/accessories optionally
write(
  'clothes-female.txt',
  lines(
    '{|__color__,} {|__print-patterns__,} {|,__time-period__} __clothes-female-type__',
    '{|__color__,} {|__fabric__,} __clothes-female-type__',
    '{|__color__,} __clothes-female-type__ with __clothes-female-layer__',
    '__clothes-female-outfit__',
    '{|__color__,} {|__print-patterns__,} __clothes-female-type__, __shoes-female__ {|, __accessories__}',
  ),
);

write(
  'clothes-male.txt',
  lines(
    '{|__color__,} {|__fabric__,} {|,__time-period__} __clothes-male-type__',
    '{|__color__,} __clothes-male-type__ with __clothes-male-layer__',
    '__clothes-male-outfit__',
    '{|__color__,} __clothes-male-type__, __shoes-male__ {|, __accessories__}',
  ),
);

// Makeup / grooming — kept fully SFW and optional
write(
  'makeup.txt',
  lines(
    'natural makeup',
    'light makeup',
    'soft glam makeup',
    'no makeup look',
    'subtle eyeliner',
    'tinted lip balm',
    'clear lip gloss',
  ),
);

write(
  'gender-female.txt',
  lines(
    'woman',
    'female',
    'lady',
    'girl',
    'young woman',
    'woman {|, with __makeup__}',
  ),
);

// Emotion / activity extras for graph depth
write(
  'activity.txt',
  lines(
    'reading a book',
    'writing in a notebook',
    'painting on a canvas',
    'playing a musical instrument',
    'cooking',
    'gardening',
    'taking a photograph',
    'riding a bicycle',
    'jogging',
    'stretching before exercise',
    'shopping',
    'waiting for a train',
    'having a conversation',
    'studying',
  ),
);

write(
  'mood.txt',
  lines(
    'peaceful mood',
    'joyful mood',
    'contemplative mood',
    'energetic mood',
    'nostalgic mood',
    'hopeful mood',
    'serene atmosphere',
    'lively atmosphere',
  ),
);

write(
  'scene-extras.txt',
  lines(
    '{|, __weather__}',
    '{|, __props__}',
    '{|, __architecture-details__}',
    '{|, __activity__}',
    '{|, __mood__}',
  ),
);

// A second master-style entry without "!" for comparison demos
write(
  'portrait-focus.txt',
  lines(
    '# Portrait-focused sample root.',
    'one person, __age__, __race__, {__gender-male__, __hairstyle-male__ | __gender-female__, __hairstyle-female__ {|, __makeup__}}, __expression__, __view__, {|, __lighting__}, {|, __style__}',
  ),
);

write(
  'environment-focus.txt',
  lines(
    '# Environment-focused sample root.',
    '__location__, __lighting__, __weather__, __style__',
  ),
);

write(
  'clothes-female-details.txt',
  lines(
    '__clothes-female__, {|with __clothes-female-details-trim__}',
  ),
);

write(
  'clothes-female-details-trim.txt',
  lines(
    'lace trim',
    'embroidery',
    'pearl buttons',
    'ribbon accents',
    'contrast stitching',
    'subtle pleats',
    'belted waist',
  ),
);

write(
  'scene-full.txt',
  lines(
    '# Richer composition demo using optional extras.',
    '__people-count__, __age__, __race__, {__gender-male__, __clothes-male__, __hairstyle-male__ | __gender-female__, __clothes-female__, __hairstyle-female__ {|, __jewelry__}} {|, __expression__} {|, __view__} {|, __pose__} {|, __location__} {|, __lighting__} {|, __style__} __scene-extras__',
  ),
);

// Count files written
function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(abs);
    else if (entry.isFile() && /\.(txt|ya?ml|json)$/i.test(entry.name)) n += 1;
  }
  return n;
}

const total = countFiles(outDir);
console.log(`Wrote ${total} wildcard files to ${outDir}`);
