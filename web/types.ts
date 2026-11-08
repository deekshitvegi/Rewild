import React from 'react';

export type CelestialType = 'sun' | 'planet' | 'moon';

export interface RingData {
  innerRadius: number;
  outerRadius: number;
  color: string;
  opacity: number;
  texture?: 'saturn';
  rotation?: [number, number, number];
}

export interface CelestialBodyData {
  id: string;
  type: CelestialType;
  name: string;
  portfolioLabel?: string;
  description: string;
  about?: string; // Biography / Long description
  color: string;
  texture?: string;
  surfaceStyle?: 'rocky' | 'gas' | 'ocean' | 'ice' | 'uranus' | 'lava' | 'toxic' | 'random';
  surfaceSeed?: number;
  modelPath?: string; // Path to .gltf or .glb file in public/models/
  size: number;
  orbitRadius: number; // Distance from parent
  orbitSpeed: number; // Speed of rotation around parent
  rotationSpeed?: number; // Self rotation
  inclination?: number; // Tilt of the orbit in radians
  axialTilt?: number; // Visual/body rotation-axis tilt in radians
  details?: string[]; // Bullet points for the resume content
  date?: string;
  location?: string;
  link?: string;
  linkLabel?: string;
  starType?: 'single' | 'binary' | 'trinary';
  starNames?: string[];
  moons?: CelestialBodyData[];
  rings?: RingData[]; // Saturn-like rings
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

// Define Three.js elements for JSX
export interface ThreeElements {
  primitive: any;
  group: any;
  mesh: any;
  sphereGeometry: any;
  meshBasicMaterial: any;
  meshStandardMaterial: any;
  meshPhysicalMaterial: any;
  pointLight: any;
  ambientLight: any;
  spotLight: any;
  shaderMaterial: any;
  sprite: any;
  spriteMaterial: any;
  ringGeometry: any;
  instancedMesh: any;
  dodecahedronGeometry: any;
  boxGeometry: any;
  fog: any;
  bufferGeometry: any;
  bufferAttribute: any;
  color: any;
  points: any;
}

// Fix: Augment global JSX namespace to include Three.js elements using interface merging.
declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

// Also augment React.JSX namespace which is used by some React/TS configurations
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
