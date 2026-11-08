
import { CelestialBodyData } from './types';
import { getWallClockGalacticYears } from './utils/galacticTime';

/**
 * The author's age in whole years. It reads the same local-time clock as
 * Galactic Years, so the two always tick over together at local midnight on
 * 15 September (the birthday, 2000-09-15).
 */
export const getAuthorAge = (nowMs = Date.now()) => Math.floor(getWallClockGalacticYears(nowMs));

// Age when the page loaded. Anything that stays on screen across a birthday
// should call getAuthorAge() again instead.
export const AUTHOR_AGE = getAuthorAge();

const seededRandom = (seed: number) => {
    const x = Math.sin(seed + 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

export type StarSystemType = 'single' | 'binary' | 'trinary';

// Slot 1 is always the neutron star, which never gains a companion.
const NEUTRON_STAR_SLOT = 1;

/**
 * The distant star systems, one entry per system slot, for a given age.
 *
 * The galaxy is replayed one birthday at a time and every birthday adds exactly
 * one star, so the number of stars always equals the age:
 * - most birthdays ignite a new single star in the next slot;
 * - every eighth birthday the new star becomes the companion of an existing
 *   single star instead, turning that system into a binary;
 * - when that system is fated to be a trinary, the following birthday's star
 *   joins it as the third member.
 * So there is one binary or trinary for every eight years, and a birthday never
 * moves or re-types any system except the one that gains a companion.
 */
export const getStarSystemTypes = (age = getAuthorAge()): StarSystemType[] => {
    const types: StarSystemType[] = [];
    let trinaryToComplete = -1;

    for (let year = 1; year <= age; year++) {
        if (trinaryToComplete >= 0) {
            types[trinaryToComplete] = 'trinary';
            trinaryToComplete = -1;
            continue;
        }

        if (year % 8 === 0) {
            const singles = types.flatMap((type, slot) =>
                type === 'single' && slot !== NEUTRON_STAR_SLOT ? [slot] : []);
            if (singles.length > 0) {
                const host = singles[Math.floor(seededRandom(year * 7919) * singles.length)];
                types[host] = 'binary';
                const specialIndex = year / 8 - 1;
                if (seededRandom(specialIndex) <= 0.5) trinaryToComplete = host;
                continue;
            }
        }

        types.push('single');
    }

    return types;
};

// The systems as they were when the page loaded.
export const STAR_SYSTEM_TYPES: StarSystemType[] = getStarSystemTypes(AUTHOR_AGE);

// Every slot keeps one orbit forever, whatever the number of systems, so a new
// system never pushes the others around. Radii are spread with the golden
// ratio across the ring between the black hole's inner zone and the galaxy's
// edge, skipping the band the Solar System itself orbits in.
const SLOT_RADIUS_MIN = 1500000;
const SLOT_RADIUS_SPAN = 6700000;
const SOLAR_BAND_START = 3500000;
const SOLAR_BAND_WIDTH = 1300000;
const GOLDEN_RATIO_FRACTION = 0.6180339887498949;

export const getRogueSystemData = (index: number, types: StarSystemType[] = getStarSystemTypes()) => {
    const starType = types[index] || 'single';

    const rand = seededRandom(index + 500); 
    const prefix = ['Kepler', 'Gliese', 'Trappist', 'Proxima', 'Cygnus', 'Vela', 'Orion'];
    const suffix = Math.floor(seededRandom(index + 1000) * 9000) + 1000;
    const name = `${prefix[Math.floor(rand * prefix.length)]}-${suffix}`;
    
    let starNames: string[] = [];
    if (starType === 'binary') {
        const i1 = Math.floor(seededRandom(index + 2000) * 4);
        const i2 = Math.floor(seededRandom(index + 3000) * 4);
        starNames = [`${['Apollo', 'Ares', 'Hermes', 'Chronos'][i1]}-${suffix}A`, `${['Artemis', 'Athena', 'Hera', 'Demeter'][i2]}-${suffix}B`];
    } else if (starType === 'trinary') {
        const i1 = Math.floor(seededRandom(index + 4000) * 4);
        const i2 = Math.floor(seededRandom(index + 5000) * 4);
        const i3 = Math.floor(seededRandom(index + 6000) * 4);
        const names = [
            ['Apollo', 'Ares', 'Hermes', 'Chronos'],
            ['Artemis', 'Athena', 'Hera', 'Demeter'],
            ['Hades', 'Poseidon', 'Zeus', 'Hestia']
        ];
        starNames = [
            `${names[0][i1]}-${suffix}A`,
            `${names[1][i2]}-${suffix}B`,
            `${names[2][i3]}-${suffix}C`
        ];
    }

    const slotFraction = (0.5 + index * GOLDEN_RATIO_FRACTION) % 1;
    let distanceValue = SLOT_RADIUS_MIN + slotFraction * SLOT_RADIUS_SPAN;
    if (distanceValue > SOLAR_BAND_START) {
        distanceValue += SOLAR_BAND_WIDTH;
    }

    const distanceLightYears = (distanceValue / 1000).toFixed(2); // converting visual units to a plausible LY representation

    const distRatio = Math.min(1.0, distanceValue / 10000000);
    const baseScale = 2.0 + (distRatio * seededRandom(index + 9000) * 5.0);

    const hue = seededRandom(index + 10000);
    const starClass = ['M', 'K', 'G', 'F', 'A', 'B', 'O'][Math.floor(seededRandom(index + 11000) * 7)];

    const isPulsar = false;
    const isNeutronStar = index === NEUTRON_STAR_SLOT;

    // Where the system starts on its orbit and how it moves, fixed per slot.
    const orbitPhase = seededRandom(index + 13000) * Math.PI * 2;
    const orbitSpeedFactor = 0.0002 + seededRandom(index + 14000) * 0.0002;
    const orbitInclination = (seededRandom(index + 15000) - 0.5) * 0.1;
    const orbitHeight = seededRandom(index + 16000) - 0.5;

    return {
        name: isPulsar ? "Pulsar CP1919" : (isNeutronStar ? "Neutron Star J1748" : name), 
        starNames, 
        starType, 
        prefix: prefix[Math.floor(rand * prefix.length)], 
        suffix,
        distanceValue,
        distanceLightYears,
        baseScale: (isPulsar || isNeutronStar) ? 0.3 : baseScale,
        hue,
        starClass: (isPulsar || isNeutronStar) ? 'X' : starClass,
        planetCount: (isPulsar || isNeutronStar) ? 0 : Math.floor(seededRandom(index + 12000) * 5) + 1,
        isPulsar,
        isNeutronStar,
        orbitPhase,
        orbitSpeedFactor,
        orbitInclination,
        orbitHeight
    };
}

export const SOLAR_SYSTEM_DATA: CelestialBodyData = {
  id: 'sun',
  type: 'sun',
  name: 'Deekshitth Vegi',
  description: 'AI Engineer | M.S. Artificial Intelligence | Researcher',
  about: "I am an AI Engineer and M.S. Artificial Intelligence graduate who designs, builds, and ships AI-powered applications and LLM features end to end. My work spans RAG, prompt engineering, function calling, AI agents, full-stack delivery, and research into reliable LLM evaluation.",
  color: '#FDB813', 
  size: 8000, 
  orbitRadius: 0,
  orbitSpeed: 0,
  inclination: 0,
  details: [
    'Thesis: Automated Methods to Evaluate the Quality of Distractors in College-Level MCQs using LLMs',
    'Email: deekshitvegibunny@gmail.com',
    'Phone: +1 940 843 6087',
    'Current role: Artificial Intelligence Engineer at HCLTech',
    'Location: Dallas, TX · Open to relocation',
    'HuggingFace: huggingface.co/Wendgan',
    'LinkedIn: linkedin.com/in/deekshitthvegi',
    'Github: github.com/deekshitvegi'
  ],
  moons: [
    {
      id: 'education',
      type: 'planet',
      name: 'Mercury',
      portfolioLabel: 'Education',
      description: 'Education · Academic Background',
      about: 'My academic journey has been driven by a passion for artificial intelligence, machine learning, and computational modeling.',
      color: '#aaa39b', 
      surfaceStyle: 'rocky',
      surfaceSeed: 101,
      size: 720, 
      orbitRadius: 20000, 
      orbitSpeed: 0.05, 
      rotationSpeed: 0.005,
      inclination: 0.2,
      moons: [
        {
          id: 'unt',
          type: 'moon',
          name: 'Univ. of North Texas',
          description: 'M.S. in Artificial Intelligence',
          about: 'Focusing on cutting-edge AI evaluation and Natural Language Processing. My thesis explores automated methods to evaluate the quality of distractors in college-level MCQs using models like GPT-4, Claude, and Gemini.',
          date: 'Aug 2023 – Jul 2025',
          location: 'Denton, TX',
          color: '#0ea5e9', 
          size: 150, 
          orbitRadius: 1600,
          orbitSpeed: 0.2,
          inclination: -0.5,
          details: [
            'GPA: 3.33/4.0',
            'Relevant Coursework: Deep Learning, NLP, Computer Vision, Perceptron Models, AI',
            'Thesis on LLM Distractor Quality Evaluation'
          ]
        },
        {
          id: 'iiitdm',
          type: 'moon',
          name: 'IIITDM Kurnool',
          description: 'B.Tech. in Mechanical Engineering',
          about: 'Built a strong foundation in computational methods, CAD, and simulation techniques, which bridged into my later research in computational modeling and AI.',
          date: 'Aug 2019 – May 2023',
          location: 'Kurnool, India',
          color: '#0ea5e9',
          size: 130, 
          orbitRadius: 2200, 
          orbitSpeed: 0.15,
          inclination: 0.3,
          details: [
            'Relevant Coursework: CAD, Solid Modeling, 3D Printing, Simulation'
          ]
        }
      ]
    },
    {
      id: 'experience',
      type: 'planet',
      name: 'Venus',
      portfolioLabel: 'Experience',
      description: 'Experience · Professional History',
      about: 'My professional experience spans production AI engineering, data science, and full-stack software delivery across the United States and India.',
      color: '#e8b16e', 
      texture: 'textures/nasa/venus.jpg',
      size: 950, 
      orbitRadius: 32000, 
      orbitSpeed: 0.02, 
      rotationSpeed: 0.004,
      inclination: -0.15,
      moons: [
        {
          id: 'hcltech',
          type: 'moon',
          name: 'AI Engineer',
          description: 'HCLTech',
          about: 'Designing and shipping production-oriented AI/ML use cases, GenAI workflows, agent automation, and cloud-ready integrations for business users.',
          date: 'Jun 2025 – Present',
          location: 'Dallas, TX',
          color: '#f87171',
          size: 160,
          orbitRadius: 1800,
          orbitSpeed: 0.3,
          inclination: 0.4,
          details: [
            'Shipped 3 AI/ML use cases across classification, retrieval, summarization, and workflow automation.',
            'Improved information-retrieval relevance by approximately 15%.',
            'Built LangChain and LangGraph agent workflows with function calling and tool orchestration.',
            'Reduced manual review and analysis effort by approximately 18–20%.'
          ]
        },
        {
          id: 'innomatics',
          type: 'moon',
          name: 'Data Scientist Trainee',
          description: 'Innomatics Research Labs',
          about: 'Built and evaluated classical machine-learning, NLP, recommendation, and customer-churn workflows with reusable analysis notebooks and stakeholder-ready visualizations.',
          date: 'Oct 2022 – Jul 2023',
          color: '#f87171',
          size: 140,
          orbitRadius: 2400,
          orbitSpeed: 0.25,
          inclination: -0.2,
          details: [
            'Best churn model reached approximately 0.84 ROC-AUC on held-out data.',
            'Built a recommendation system and supervised NLP text-classification pipeline.',
            'Evaluated models with precision, recall, F1-score, ROC-AUC, and confusion matrices.'
          ]
        },
        {
          id: 'josh',
          type: 'moon',
          name: 'Software Dev Intern',
          description: 'Josh Innovations',
          about: 'Built MERN-stack features, REST APIs, and reusable UI components with frontend-to-backend integration for product-lifecycle workflows.',
          date: 'Jun 2021 – Oct 2021',
          color: '#f87171',
          size: 130,
          orbitRadius: 3000,
          orbitSpeed: 0.2,
          inclination: 0.1,
          details: [
            'Developed full-stack applications using ReactJS and Node.js.',
            'Built RESTful APIs for data synchronization and designed reusable UI components.'
          ]
        }
      ]
    },
    {
      id: 'projects',
      type: 'planet',
      name: 'Earth',
      portfolioLabel: 'Projects',
      description: 'Projects · Key Technical Work',
      about: 'I actively build out novel AI and Web projects to push my limits and explore new architectures.',
      color: '#4ba9d8', 
      texture: 'textures/nasa/earth.jpg',
      size: 900, 
      orbitRadius: 48000, 
      orbitSpeed: 0.01, 
      rotationSpeed: 0.006,
      inclination: 0.25,
      moons: [
        {
          id: 'galactic',
          type: 'moon',
          name: 'Galactic Portfolio',
          description: 'Gemini API Competition',
          about: 'An ambitious 3D interactive resume that maps professional experience to a navigable solar system, pushing the boundaries of WebGL and interactive storytelling.',
          color: '#34d399',
          size: 165,
          orbitRadius: 3800,
          orbitSpeed: 0.28,
          inclination: 0.1,
          details: [
            'Built 3D interactive resume as a navigable solar system using React Three Fiber.',
            'Integrated Gemini Function Calling for natural language navigation.',
            'Implemented procedural starfields, asteroid belts, Orbit and Spaceship view modes.'
          ]
        },
        {
          id: 'exoplanet_tool',
          type: 'moon',
          name: 'Exoplanet Detector',
          description: 'Interactive Transit Classifier',
          about: 'A deep learning project focused on detecting exoplanetary transits from stellar light curve data, complete with synthetic data generation and 3D visualization.',
          color: '#34d399',
          size: 160,
          orbitRadius: 4500, 
          orbitSpeed: 0.25,
          inclination: 0.5,
          details: [
            'Interactive Tool Available',
            'Generated dataset of 150,000 synthetic light curves.',
            'Built LSTM/Transformer pipeline for transit classification.',
            'Integrated 3D orbit simulation.'
          ]
        },
        {
          id: 'pose',
          type: 'moon',
          name: '2D to 3D Pose',
          description: 'Computer Vision',
          about: 'A computer vision pipeline that reconstructs 3D human pose kinematics using only 2D RGB video inputs, leveraging advanced regression models and temporal filtering.',
          color: '#34d399',
          size: 150,
          orbitRadius: 5200,
          orbitSpeed: 0.2,
          inclination: -0.4,
          details: [
            'Extracted 2D keypoints from RGB video using MediaPipe.',
            'Reconstructed 3D poses with temporal filtering and regression.'
          ]
        },
        {
          id: 'wiki',
          type: 'moon',
          name: 'Wiki Image Captioning',
          description: 'Multimodal AI',
          about: 'A multimodal application designed to automatically generate high-quality captions for images on Wikipedia using advanced encoder-decoder architectures.',
          color: '#34d399',
          size: 150,
          orbitRadius: 5900, 
          orbitSpeed: 0.15,
          inclination: 0.2,
          details: [
            'Compared BLIP/CLIP embeddings with custom LSTM decoder.',
            'Evaluated with BLEU/CIDEr scores.',
            'Deployed on Hugging Face Spaces.'
          ]
        },
        {
          id: 'scanner',
          type: 'moon',
          name: 'Product Scanner',
          description: 'Health Analyzer',
          about: 'An AI-powered tool that analyzes ingredient lists from product scans to provide real-time health insights and risk-factor flagging.',
          color: '#34d399',
          size: 140,
          orbitRadius: 6600,
          orbitSpeed: 0.12,
          inclination: -0.1,
          details: [
            'Barcode scanning with Flask+SQLAlchemy.',
            'AI health scoring and recommendations via REST APIs.'
          ]
        }
      ]
    },
    {
      id: 'skills',
      type: 'planet',
      name: 'Mars',
      portfolioLabel: 'Skills',
      description: 'Skills · Technical Proficiency',
      about: 'A comprehensive breakdown of my engineering capabilities, covering the languages, frameworks, databases, and ML methodologies I deploy daily.',
      color: '#c8613c', 
      texture: 'textures/nasa/mars.jpg',
      size: 760, 
      orbitRadius: 64000, 
      orbitSpeed: 0.003, 
      rotationSpeed: 0.008,
      inclination: -0.1,
      moons: [
        {
          id: 'lang',
          type: 'moon',
          name: 'Programming',
          description: 'Core Languages',
          color: '#a78bfa',
          size: 130,
          orbitRadius: 1300,
          orbitSpeed: 0.3,
          inclination: 0.3,
          details: ['Python', 'SQL', 'JavaScript', 'C#']
        },
        {
          id: 'web',
          type: 'moon',
          name: 'Web Dev',
          description: 'Frontend/Backend',
          color: '#a78bfa',
          size: 130,
          orbitRadius: 1800,
          orbitSpeed: 0.25,
          inclination: -0.2,
          details: ['HTML', 'CSS', 'Bootstrap', 'ReactJS', 'Node.js']
        },
        {
          id: 'ai',
          type: 'moon',
          name: 'AI / ML',
          description: 'Frameworks & Models',
          color: '#a78bfa',
          size: 130,
          orbitRadius: 2300,
          orbitSpeed: 0.2,
          inclination: 0.4,
          details: ['PyTorch', 'TensorFlow', 'Hugging Face', 'scikit-learn', 'CLIP', 'LSTM', 'Transformers', 'GPT', 'MediaPipe', 'OpenCV']
        },
        {
          id: 'tools',
          type: 'moon',
          name: 'Tools & Viz',
          description: 'Utilities',
          color: '#a78bfa',
          size: 130,
          orbitRadius: 2800,
          orbitSpeed: 0.15,
          inclination: -0.3,
          details: ['AWS (S3)', 'FastAPI', 'MongoDB', 'MySQL', 'REST APIs', 'Git', 'Matplotlib', 'Plotly', 'Tableau', 'Gradio']
        }
      ]
    },
    {
      id: 'research',
      type: 'planet',
      name: 'Jupiter',
      portfolioLabel: 'Research',
      description: 'Research · Thesis & Applied Research',
      about: 'Research spanning LLM evaluation, educational AI, human-alignment analysis, experimental data workflows, and simulation validation.',
      color: '#d8b486',
      texture: 'textures/nasa/jupiter.jpg',
      size: 1950,
      orbitRadius: 76000,
      orbitSpeed: 0.0022,
      rotationSpeed: 0.012,
      inclination: 0.18,
      moons: [
        {
          id: 'thesis-research',
          type: 'moon',
          name: 'LLM Evaluation Thesis',
          description: 'University of North Texas',
          about: 'Investigated automated distractor-quality evaluation for college-level MCQs using LLM-as-Judge and LLM-as-Examinee paradigms.',
          date: 'Aug 2024 – Jul 2025',
          location: 'Denton, TX',
          color: '#f4d2a8',
          size: 155,
          orbitRadius: 2600,
          orbitSpeed: 0.18,
          inclination: 0.28,
          details: [
            '581 questions across ARC, MMLU, and an 18-field subject-diverse dataset.',
            '28,531 predictions across ChatGPT, Claude, Gemini, and open-source model families.',
            'Best direct-ranking Spearman rho: 0.379; best Exact Match @1: 61.62%.',
            'Shipped a Hugging Face Spaces / Gradio research prototype.'
          ]
        },
        {
          id: 'drdo-research',
          type: 'moon',
          name: 'DRDO Research',
          description: 'Ministry of Defence, Government of India',
          about: 'Built repeatable Python workflows for experimental-data preprocessing, feature extraction, stress–strain analysis, and simulation validation.',
          date: 'May 2022 – Oct 2022',
          location: 'Hyderabad, India',
          color: '#e8c393',
          size: 140,
          orbitRadius: 3400,
          orbitSpeed: 0.14,
          inclination: -0.2,
          details: [
            'Validated simulation outputs against physical experiments.',
            'Achieved approximately 95% correlation.',
            'Reduced the analysis cycle by approximately 60% with reusable scripts.'
          ]
        }
      ]
    },
    {
      id: 'beyond',
      type: 'planet',
      name: 'Saturn',
      portfolioLabel: 'Beyond the Code',
      description: 'Personal Universe · Music, Anime, Film & Socials',
      about: 'Outside AI and engineering, I am usually listening to Don Toliver or The Weeknd, watching anime, keeping up with films, or exploring games and online communities. One Piece and Naruto are my undisputed all-time favorites.',
      color: '#d7bd8a',
      texture: 'textures/nasa/saturn.jpg',
      size: 1620,
      orbitRadius: 88000,
      orbitSpeed: 0.00165,
      rotationSpeed: 0.014,
      inclination: -0.22,
      axialTilt: -26.7 * Math.PI / 180,
      rings: [
        // Saturn's bright ring system spans roughly 1.1-2.3 planetary radii.
        // RingGeometry starts in XY, so -PI/2 aligns it with the planet's
        // equator; CelestialBody applies the shared signed axial tilt to both
        // Saturn and its rings while the planet spins inside that tilted frame.
        { innerRadius: 1800, outerRadius: 3780, color: '#ffffff', opacity: 0.94, texture: 'saturn', rotation: [-Math.PI / 2, 0, 0] }
      ],
      details: [
        'Favorite artists: Don Toliver and The Weeknd',
        'Undisputed anime favorites: One Piece and Naruto',
        'Favorite film: Interstellar',
        'Letterboxd: letterboxd.com/wendgan'
      ],
      moons: [
        {
          id: 'personal-music',
          type: 'moon',
          name: 'Music',
          description: 'Don Toliver · The Weeknd',
          about: 'Don Toliver and The Weeknd are the artists I return to the most. Music is a constant part of how I work, relax, and find creative inspiration.',
          color: '#c084fc',
          size: 126,
          orbitRadius: 4700,
          orbitSpeed: 0.18,
          inclination: 0.28,
          details: [
            'Favorite artists: Don Toliver and The Weeknd',
            'Spotify: deekshitbunny'
          ]
        },
        {
          id: 'personal-anime',
          type: 'moon',
          name: 'Anime & Animation',
          description: 'One Piece and Naruto lead the list',
          about: 'One Piece and Naruto are my undisputed favorites: the two stories that have stayed with me above everything else.',
          color: '#fb923c',
          size: 148,
          orbitRadius: 5600,
          orbitSpeed: 0.155,
          inclination: -0.2,
          details: [
            'Undisputed favorites: One Piece and Naruto',
            'My Hero Academia · Black Clover · Dragon Ball · One Punch Man',
            'Tokyo Ghoul · Fairy Tail · Assassination Classroom · Death Note',
            'Dr. Stone · Boruto · Attack on Titan · Avatar: The Last Airbender',
            'Jujutsu Kaisen · Demon Slayer · Bleach · Hunter × Hunter',
            'Mob Psycho 100 · Erased · Solo Leveling · Chainsaw Man',
            'Tokyo Revengers · Kaiju No. 8 · Mashle'
          ]
        },
        {
          id: 'personal-film',
          type: 'moon',
          name: 'Film',
          description: 'Science fiction · Animation · Drama',
          about: 'I love ambitious science fiction, emotionally grounded storytelling, and unforgettable animation.',
          color: '#60a5fa',
          size: 132,
          orbitRadius: 6500,
          orbitSpeed: 0.135,
          inclination: 0.38,
          link: 'https://letterboxd.com/wendgan/',
          linkLabel: 'Open Letterboxd',
          details: [
            'Interstellar',
            'Chainsaw Man – The Movie: Reze Arc',
            'Jersey (2019, Telugu)',
            'Chhichhore (2019)',
            'Letterboxd: @wendgan'
          ]
        },
        {
          id: 'personal-socials',
          type: 'moon',
          name: 'Socials & Gaming',
          description: 'Profiles · Communities · Player IDs',
          about: 'The social, media, and gaming profiles where I share, watch, listen, and play.',
          color: '#22d3ee',
          size: 138,
          orbitRadius: 7400,
          orbitSpeed: 0.12,
          inclination: -0.34,
          link: 'https://x.com/deekshitvegi',
          linkLabel: 'Open X Profile',
          details: [
            'X: @deekshitvegi · Reddit: u/Wendgan',
            'Twitch: @deekshitbunny · YouTube: Wendgan',
            'Letterboxd: @wendgan · Spotify: deekshitbunny',
            'Crunchyroll: Wendgan · Epic Games: Wendgan',
            'Riot Games: Wendgan#Luffy · Steam: Wendgan',
            'Xbox: TropicMicrobe98'
          ]
        }
      ]
    },
    {
      id: 'freelance',
      type: 'planet',
      name: 'Uranus',
      portfolioLabel: 'Freelance Work',
      description: 'Client Websites · Design & Development',
      about: 'A collection of client websites I designed and developed across music, celebrations, communication technology, wellness, and classical arts—each shaped around a different audience, identity, and business goal.',
      color: '#8bd9da',
      surfaceStyle: 'uranus',
      surfaceSeed: 707,
      size: 1180,
      orbitRadius: 100000,
      orbitSpeed: 0.00125,
      rotationSpeed: 0.01,
      inclination: 0.12,
      details: [
        'Five client websites across music, events, communications, wellness, and classical arts',
        'Responsive interfaces, interactive storytelling, and business-focused conversion paths',
        'Two live experiences and three private or pre-launch builds'
      ],
      moons: [
        {
          id: 'freelance-eman',
          type: 'moon',
          name: 'Eman the Producer',
          description: 'Music Portfolio · Live',
          about: 'A premium music-industry portfolio for Latin Grammy-winning and Grammy-nominated producer Emmanuel Anene Jr. It brings together his story, production services, discography, featured tracks, gallery, affiliates, contact flow, and an interactive site assistant.',
          color: '#f59e0b',
          size: 138,
          orbitRadius: 3400,
          orbitSpeed: 0.18,
          inclination: 0.3,
          link: 'https://emantheproducer.com/',
          linkLabel: 'Visit Live Website',
          details: [
            'Artist and producer brand experience',
            'Discography and featured-track presentation',
            'Services, gallery, affiliates, and contact journey',
            'Responsive design and interactive assistant'
          ]
        },
        {
          id: 'freelance-madi',
          type: 'moon',
          name: 'Celebrate With Madi',
          description: 'Interactive Wedding Experience · Live',
          about: 'An immersive wedding website for Divya and Manas, built around a scratch-to-reveal invitation, live countdown, six-event schedule, personal story moments, RSVP flow, music, and an event assistant.',
          color: '#f472b6',
          size: 140,
          orbitRadius: 4300,
          orbitSpeed: 0.158,
          inclination: -0.24,
          link: 'https://celebratewithmadi.com/',
          linkLabel: 'Visit Live Website',
          details: [
            'Scratch-to-reveal invitation and live countdown',
            'Six-event schedule with Google Calendar and Maps',
            'Personal story moments and multi-event RSVP flow',
            'Music, family details, and event assistant'
          ]
        },
        {
          id: 'freelance-vkt',
          type: 'moon',
          name: 'VKT Services',
          description: 'Corporate Communications Website · Pre-launch',
          about: 'A corporate website for a professional communication and security-solutions company, presenting DMR and TETRA radio systems, body-worn cameras, Push-to-Talk over Cellular solutions, Hytera products, installation, and maintenance services.',
          color: '#38bdf8',
          size: 132,
          orbitRadius: 5200,
          orbitSpeed: 0.14,
          inclination: 0.36,
          details: [
            'Product and solution discovery',
            'Mission-critical communication systems',
            'Corporate story and service presentation',
            'Enquiry and contact experience'
          ]
        },
        {
          id: 'freelance-paripurni',
          type: 'moon',
          name: 'Paripurni',
          description: 'Wellness E-commerce · Pre-launch',
          about: 'A brand and e-commerce website for a Hyderabad-based cold-pressed oils business, communicating purity, traditional extraction, nutrition, sustainability, and a product catalog spanning cooking oils, specialty oils, and seeds.',
          color: '#84cc16',
          size: 134,
          orbitRadius: 6100,
          orbitSpeed: 0.123,
          inclination: -0.32,
          details: [
            'Product catalog and category discovery',
            'Wellness-focused brand storytelling',
            'Traditional extraction and sustainability messaging',
            'Shopping, enquiries, and customer contact'
          ]
        },
        {
          id: 'freelance-sri-vari',
          type: 'moon',
          name: 'Sri Vari Padalu Academy',
          description: 'Classical Arts Website · Pre-launch',
          about: 'A performance-led academy website for classical dance and music education in Secunderabad, presenting Bharatanatyam, Kuchipudi, and Sangeetham through programs, faculty, class timings, events, galleries, testimonials, admissions, and contact.',
          color: '#a78bfa',
          size: 142,
          orbitRadius: 7000,
          orbitSpeed: 0.108,
          inclination: 0.18,
          details: [
            'Bharatanatyam, Kuchipudi, and Carnatic music',
            'Faculty and program presentation',
            'Performance gallery and event archive',
            'Class timings, admissions, testimonials, and enquiries'
          ]
        }
      ]
    },
    {
      id: 'certifications',
      type: 'planet',
      name: 'Neptune',
      portfolioLabel: 'Certifications',
      description: 'Verified Credentials · AI & Generative AI',
      about: 'Verified Anthropic and Google credentials covering AI fluency, Claude, Claude Code, and generative-AI foundations.',
      color: '#5f8ee8',
      texture: 'textures/nasa/neptune.jpg',
      size: 1120,
      orbitRadius: 112000,
      orbitSpeed: 0.00095,
      rotationSpeed: 0.011,
      inclination: -0.08,
      moons: [
        {
          id: 'anthropic-ai-fluency',
          type: 'moon',
          name: 'AI Fluency: Framework & Foundations',
          description: 'Anthropic Education · Certificate of Completion',
          about: 'Verified completion of AI Fluency: Framework & Foundations.',
          date: 'Completed Jun 17, 2026',
          color: '#bae6fd',
          size: 112,
          orbitRadius: 3300,
          orbitSpeed: 0.18,
          inclination: 0.28,
          link: 'https://verify.skilljar.com/c/ufhzomy89ee3',
          linkLabel: 'Verify Credential',
          details: ['Issuer: Anthropic Education', 'Credential ID: ufhzomy89ee3']
        },
        {
          id: 'anthropic-claude-101',
          type: 'moon',
          name: 'Claude 101',
          description: 'Anthropic Education · Certificate of Completion',
          about: 'Certificate of completion: Claude 101.',
          date: 'Completed Jun 17, 2026',
          color: '#a5f3fc',
          size: 108,
          orbitRadius: 4200,
          orbitSpeed: 0.155,
          inclination: -0.2,
          link: 'https://verify.skilljar.com/c/wazrsa7yx42k',
          linkLabel: 'Verify Credential',
          details: ['Issuer: Anthropic Education', 'Credential ID: wazrsa7yx42k']
        },
        {
          id: 'anthropic-claude-code',
          type: 'moon',
          name: 'Claude Code in Action',
          description: 'Anthropic Education · Certificate of Completion',
          about: 'Verified completion of Claude Code in Action.',
          date: 'Completed Jun 16, 2026',
          color: '#93c5fd',
          size: 110,
          orbitRadius: 5100,
          orbitSpeed: 0.135,
          inclination: 0.38,
          link: 'https://verify.skilljar.com/c/wc5ygf8c4us6',
          linkLabel: 'Verify Credential',
          details: ['Issuer: Anthropic Education', 'Credential ID: wc5ygf8c4us6']
        },
        {
          id: 'google-gen-ai-chatbot',
          type: 'moon',
          name: 'Gen AI: Beyond the Chatbot',
          description: 'Google Cloud · Coursera Course Certificate',
          about: 'Verified Google Cloud course certificate covering generative-AI applications beyond conversational chatbots.',
          date: 'Completed Jan 3, 2026',
          color: '#67e8f9',
          size: 112,
          orbitRadius: 6000,
          orbitSpeed: 0.12,
          inclination: -0.34,
          link: 'https://www.coursera.org/account/accomplishments/verify/7Y1KP1MKY23W',
          linkLabel: 'Verify Credential',
          details: ['Issuer: Google Cloud', 'Credential ID: 7Y1KP1MKY23W']
        },
        {
          id: 'google-gen-ai-foundations',
          type: 'moon',
          name: 'Gen AI: Unlock Foundational Concepts',
          description: 'Google Cloud · Coursera Course Certificate',
          about: 'Verified Google Cloud course certificate in generative-AI foundational concepts.',
          date: 'Completed Jan 3, 2026',
          color: '#bfdbfe',
          size: 112,
          orbitRadius: 6900,
          orbitSpeed: 0.105,
          inclination: 0.16,
          link: 'https://www.coursera.org/account/accomplishments/verify/FW2VB15YCAKH',
          linkLabel: 'Verify Credential',
          details: ['Issuer: Google Cloud', 'Credential ID: FW2VB15YCAKH']
        }
      ]
    }
  ]
};
