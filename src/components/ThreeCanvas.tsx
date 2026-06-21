import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

interface ThreeCanvasProps {
  scrollOffset: number; // in pixels
  theme: 'dark' | 'light';
}

// GLSL Shaders for Background Particles
const vertexShader = `
  attribute vec3 aPositionHelix;
  attribute vec3 aPositionGrid;
  attribute vec3 aPositionWave;
  attribute vec3 aPositionVortex;

  uniform float w0;
  uniform float w1;
  uniform float w2;
  uniform float w3;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uMouseStrength;
  uniform float uDPR;
  uniform float uAmbientIntensity;

  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    vec3 blendedPos = aPositionHelix * w0 + 
                      aPositionGrid * w1 + 
                      aPositionWave * w2 + 
                      aPositionVortex * w3;

    if (w2 > 0.001) {
      float waveOffset = sin(blendedPos.x * 0.01 + uTime * 1.5) * 
                         cos(blendedPos.z * 0.01 + uTime * 1.5) * 25.0;
      blendedPos.y += waveOffset * w2;
    }

    if (w3 > 0.001) {
      float distFromCenter = length(blendedPos.xz);
      float angle = uTime * 0.8 * (1.0 - clamp(distFromCenter / 300.0, 0.0, 0.9));
      float cosA = cos(angle);
      float sinA = sin(angle);
      vec2 rotatedXZ = mat2(cosA, -sinA, sinA, cosA) * blendedPos.xz;
      blendedPos.xz = mix(blendedPos.xz, rotatedXZ, w3);
    }

    vec2 mouseDiff = blendedPos.xy - uMouse;
    float dist = length(mouseDiff);
    if (dist < 180.0) {
      float force = (1.0 - dist / 180.0) * 45.0;
      vec2 dir = normalize(mouseDiff);
      blendedPos.xy += dir * force * uMouseStrength;
    }

    vec4 mvPosition = modelViewMatrix * vec4(blendedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = (11.0 * uDPR * uAmbientIntensity) / -mvPosition.z;

    vPosition = blendedPos;
    vDepth = -mvPosition.z;
  }
`;

const fragmentShader = `
  uniform float uThemeProgress;
  uniform vec3 uColorDarkA;
  uniform vec3 uColorDarkB;
  uniform vec3 uColorLightA;
  uniform vec3 uColorLightB;
  uniform float uAmbientIntensity;

  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) {
      discard;
    }

    float alphaMax = mix(0.85, 1.35, uThemeProgress);
    float alpha = smoothstep(0.5, 0.15, dist) * alphaMax * uAmbientIntensity;

    float depthFade = clamp(1.0 - (vDepth - 200.0) / 700.0, 0.2, 1.0);
    alpha = clamp(alpha * depthFade, 0.0, 1.0);

    float posFactor = clamp((vPosition.y + 200.0) / 400.0, 0.0, 1.0);

    vec3 colorDark = mix(uColorDarkA, uColorDarkB, posFactor);
    vec3 colorLight = mix(uColorLightA, uColorLightB, posFactor);

    vec3 finalColor = mix(colorDark, colorLight, uThemeProgress);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// GLSL Card Hover Distortion Shaders
const cardVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const cardFragmentShader = `
  uniform sampler2D uImage;
  uniform vec2 uMouse;        // local card UV coordinates
  uniform float uDistortion;  // 0 -> 1 GSAP tweened
  uniform float uOpacity;     // 0 -> 1 plane cross-fade
  varying vec2 vUv;

  void main() {
    vec2 toMouse = vUv - uMouse;
    float dist = length(toMouse);
    float falloff = smoothstep(0.4, 0.0, dist);

    // Apply distortion wave centered at mouse
    vec2 displaced = vUv + toMouse * falloff * uDistortion * 0.08;

    // Chromatic Aberration channel split
    float split = uDistortion * 0.006;
    float r = texture2D(uImage, displaced + vec2(split, 0.0)).r;
    float g = texture2D(uImage, displaced).g;
    float b = texture2D(uImage, displaced - vec2(split, 0.0)).b;
    float a = texture2D(uImage, displaced).a;

    gl_FragColor = vec4(r, g, b, a * uOpacity);
  }
`;

// GLSL Post-Processing Pass (Film Grain + Chromatic Aberration + Vignette Compositor)
const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    tOriginal: { value: null },
    uTime: { value: 0 },
    uGrainStrength: { value: 0.035 },
    uVignetteStrength: { value: 0.35 },
    uChromaticAberration: { value: 0.003 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;  
    uniform sampler2D tOriginal; 
    uniform float uTime;
    uniform float uGrainStrength;
    uniform float uVignetteStrength;
    uniform float uChromaticAberration;

    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float distToCenter = length(centered);

      vec2 shift = centered * uChromaticAberration;
      float r = texture2D(tOriginal, vUv - shift).r;
      float g = texture2D(tOriginal, vUv).g;
      float b = texture2D(tOriginal, vUv + shift).b;
      float a = texture2D(tOriginal, vUv).a;

      vec4 originalColor = vec4(r, g, b, a);
      vec4 bloomColor = texture2D(tDiffuse, vUv);

      vec3 finalRGB = originalColor.rgb + bloomColor.rgb * 0.45;
      float finalAlpha = max(originalColor.a, length(bloomColor.rgb) * 0.3);

      vec4 color = vec4(finalRGB, finalAlpha);

      float grain = (rand(vUv * (uTime + 1.0)) - 0.5) * uGrainStrength;
      color.rgb += grain;

      float vig = 1.0 - dot(centered, centered) * uVignetteStrength;
      color.rgb *= vig;

      gl_FragColor = color;
    }
  `
};

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && 
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

// Helper to convert SVG Element to Data URL for texture usage
const serializeSVG = (svgElement: SVGElement): Promise<string> => {
  return new Promise((resolve) => {
    // Clone node to safely modify sizes for high-fidelity WebGL texture maps
    const cloned = svgElement.cloneNode(true) as SVGElement;
    cloned.setAttribute('width', '500');
    cloned.setAttribute('height', '280');
    cloned.style.opacity = '1';
    cloned.style.display = 'block';
    
    // Inline styling definitions
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--bg-color').trim() || '#03050c';
    const bgCard = styles.getPropertyValue('--bg-card').trim() || 'rgba(10, 15, 30, 0.45)';
    const textPrimary = styles.getPropertyValue('--text-primary').trim() || '#f8fafc';
    const textSecondary = styles.getPropertyValue('--text-secondary').trim() || '#94a3b8';
    const textMuted = styles.getPropertyValue('--text-muted').trim() || '#64748b';
    const borderColor = styles.getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.05)';
    const accentCyan = styles.getPropertyValue('--accent-cyan').trim() || '#00f2fe';
    const accentBlue = styles.getPropertyValue('--accent-blue').trim() || '#4facfe';
    const accentTeal = styles.getPropertyValue('--accent-teal').trim() || '#64ffda';
    
    // Inject styles directly so serializing parses computed colors correctly inside isolated SVG context
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      :root {
        --bg-color: ${bgColor};
        --bg-card: ${bgCard};
        --text-primary: ${textPrimary};
        --text-secondary: ${textSecondary};
        --text-muted: ${textMuted};
        --border-color: ${borderColor};
        --accent-cyan: ${accentCyan};
        --accent-blue: ${accentBlue};
        --accent-teal: ${accentTeal};
      }
      svg { background: ${bgColor}; }
    `;
    cloned.insertBefore(styleElement, cloned.firstChild);

    let svgString = new XMLSerializer().serializeToString(cloned);
    
    // Replace all var(--...) calls inside the SVG source with resolved values
    // to bypass browser constraints prohibiting var() parsing in dynamic SVG texture maps
    const varMap: { [key: string]: string } = {
      'var(--bg-color)': bgColor,
      'var(--bg-card)': bgCard,
      'var(--text-primary)': textPrimary,
      'var(--text-secondary)': textSecondary,
      'var(--text-muted)': textMuted,
      'var(--border-color)': borderColor,
      'var(--accent-cyan)': accentCyan,
      'var(--accent-blue)': accentBlue,
      'var(--accent-teal)': accentTeal,
    };
    for (const [variable, value] of Object.entries(varMap)) {
      svgString = svgString.replaceAll(variable, value);
    }

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(svgBlob);
  });
};

export default function ThreeCanvas({ scrollOffset, theme }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [webglSupported] = useState(() => isWebGLAvailable());
  const [webglActive, setWebglActive] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const scrollPercentRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const themeRef = useRef(theme);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseActiveRef = useRef(false);
  const touchActiveRef = useRef(false);

  useEffect(() => {
    scrollOffsetRef.current = scrollOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    scrollPercentRef.current = docHeight > 0 ? (scrollOffset / docHeight) * 100 : 0;
  }, [scrollOffset]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!webglSupported || !webglActive) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // --- Performance Profiling and Device Tiers ---
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const prefersReduced = prefersReducedMotion;

    const PARTICLE_COUNT = prefersReduced ? 1000 : (isTouch ? 1500 : 5000);
    const MAX_DPR = prefersReduced ? 1.0 : (isTouch ? 1.5 : 2.0);

    let animationFrameId: number;
    let width = container.clientWidth;
    let height = container.clientHeight;

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 1000);
    camera.position.z = 400;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, 
      alpha: true,
      powerPreference: 'high-performance',
    });

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);

    // --- Post-Processing Setup ---
    const sceneRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    const composerRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    const composer = new EffectComposer(renderer, composerRenderTarget);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomResX = prefersReduced ? width : (isTouch ? width * 0.5 : width);
    const bloomResY = prefersReduced ? height : (isTouch ? height * 0.5 : height);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(bloomResX, bloomResY),
      0.45, 
      0.35, 
      0.65  
    );
    composer.addPass(bloomPass);

    const grainVignettePass = new ShaderPass(GrainVignetteShader);
    grainVignettePass.uniforms.uGrainStrength.value = prefersReduced ? 0.0 : (isTouch ? 0.018 : 0.035);
    grainVignettePass.uniforms.uVignetteStrength.value = 0.35;
    grainVignettePass.uniforms.uChromaticAberration.value = isTouch ? 0.0015 : 0.003;
    composer.addPass(grainVignettePass);

    // --- Math formulas for Morph Targets ---
    const positionsHelix = new Float32Array(PARTICLE_COUNT * 3);
    const positionsGrid = new Float32Array(PARTICLE_COUNT * 3);
    const positionsWave = new Float32Array(PARTICLE_COUNT * 3);
    const positionsVortex = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;

      // Helix
      const isStrandA = i % 2 === 0;
      const tHelix = (i / PARTICLE_COUNT) * Math.PI * 8;
      const rHelix = 85;
      const yHelix = ((i / PARTICLE_COUNT) - 0.5) * 350;
      const offset = isStrandA ? 0 : Math.PI;

      positionsHelix[idx] = rHelix * Math.cos(tHelix + offset);
      positionsHelix[idx + 1] = yHelix;
      positionsHelix[idx + 2] = rHelix * Math.sin(tHelix + offset);

      // Grid
      const gridSideX = isTouch ? 10 : 20;
      const gridSideY = isTouch ? 10 : 20;
      const gridSideZ = Math.ceil(PARTICLE_COUNT / (gridSideX * gridSideY));

      const ix = i % gridSideX;
      const iy = Math.floor(i / gridSideX) % gridSideY;
      const iz = Math.floor(i / (gridSideX * gridSideY));

      const step = isTouch ? 30 : 20;
      positionsGrid[idx] = (ix - gridSideX / 2) * step;
      positionsGrid[idx + 1] = (iy - gridSideY / 2) * step;
      positionsGrid[idx + 2] = (iz - gridSideZ / 2) * step;

      // Wave
      const waveCols = Math.ceil(Math.sqrt(PARTICLE_COUNT));
      const col = i % waveCols;
      const row = Math.floor(i / waveCols);
      const waveSpacing = isTouch ? 16 : 10;

      positionsWave[idx] = (col - waveCols / 2) * waveSpacing;
      positionsWave[idx + 1] = 0; 
      positionsWave[idx + 2] = (row - waveCols / 2) * waveSpacing;

      // Vortex
      const rVortex = Math.pow(i / PARTICLE_COUNT, 0.6) * 260;
      const tVortex = (i / PARTICLE_COUNT) * Math.PI * 26;
      const thickness = (Math.random() - 0.5) * 18 * (1.0 - (i / PARTICLE_COUNT));

      positionsVortex[idx] = rVortex * Math.cos(tVortex);
      positionsVortex[idx + 1] = thickness;
      positionsVortex[idx + 2] = rVortex * Math.sin(tVortex);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positionsHelix), 3));
    geometry.setAttribute('aPositionHelix', new THREE.BufferAttribute(positionsHelix, 3));
    geometry.setAttribute('aPositionGrid', new THREE.BufferAttribute(positionsGrid, 3));
    geometry.setAttribute('aPositionWave', new THREE.BufferAttribute(positionsWave, 3));
    geometry.setAttribute('aPositionVortex', new THREE.BufferAttribute(positionsVortex, 3));

    const uniforms = {
      w0: { value: 1.0 },
      w1: { value: 0.0 },
      w2: { value: 0.0 },
      w3: { value: 0.0 },
      uTime: { value: 0.0 },
      uMouse: { value: new THREE.Vector2(9999, 9999) },
      uMouseStrength: { value: 0.0 },
      uDPR: { value: dpr },
      uAmbientIntensity: { value: 1.0 },
      uThemeProgress: { value: themeRef.current === 'light' ? 1.0 : 0.0 },
      uColorDarkA: { value: new THREE.Color(0.18, 0.35, 0.39) },   
      uColorDarkB: { value: new THREE.Color(0.85, 0.49, 0.43) },   
      uColorLightA: { value: new THREE.Color(0.10, 0.24, 0.33) },  // Premium Deep Slate Blue
      uColorLightB: { value: new THREE.Color(0.31, 0.13, 0.49) },  // Premium Deep Purple/Violet  
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const particles = new THREE.Points(geometry, material);
    particles.layers.enable(1); // Enable layer 1 so it's captured by composer's RenderPass
    scene.add(particles);

    // --- Dynamic SVG Hover-Distortion Card Planes Setup ---
    interface WebGLCard {
      element: HTMLElement;
      mesh: THREE.Mesh;
      mat: THREE.ShaderMaterial;
      docX: number;
      docY: number;
      width: number;
      height: number;
      observer?: IntersectionObserver;
      distortionVal: { value: number };
      opacityVal: { value: number };
    }

    const cards: WebGLCard[] = [];
    const cardCleanups: (() => void)[] = [];
    const loader = new THREE.TextureLoader();

    const getUnitsPerPixel = () => {
      const vHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const vWidth = vHeight * camera.aspect;
      return {
        x: vWidth / width,
        y: vHeight / height
      };
    };

    const setupWebGLCards = () => {
      // Find both project cards by selector
      const elements = document.querySelectorAll('.work-diagram-container');
      elements.forEach((el) => {
        const htmlElement = el as HTMLElement;
        const svg = htmlElement.querySelector('svg');
        if (!svg) return;

        // 1. Setup transparent card ShaderMaterial
        const cardMat = new THREE.ShaderMaterial({
          vertexShader: cardVertexShader,
          fragmentShader: cardFragmentShader,
          uniforms: {
            uImage: { value: new THREE.Texture() },
            uMouse: { value: new THREE.Vector2(0.5, 0.5) },
            uDistortion: { value: 0.0 },
            uOpacity: { value: 0.0 } // Initially 0, fades in once texture loads
          },
          transparent: true,
          depthWrite: false,
        });

        // Placeholder geometry (will be resized dynamically)
        const cardGeo = new THREE.PlaneGeometry(1, 1);
        const cardMesh = new THREE.Mesh(cardGeo, cardMat);
        scene.add(cardMesh);

        // Precalculate static document coordinates to prevent layout thrashing
        const rect = htmlElement.getBoundingClientRect();
        const initialScroll = window.scrollY || document.documentElement.scrollTop;
        
        const docX = rect.left + rect.width / 2;
        const docY = rect.top + initialScroll + rect.height / 2;

        const cardRef: WebGLCard = {
          element: htmlElement,
          mesh: cardMesh,
          mat: cardMat,
          docX,
          docY,
          width: rect.width,
          height: rect.height,
          distortionVal: { value: 0.0 },
          opacityVal: { value: 0.0 }
        };

        cards.push(cardRef);

        // 2. Serialize SVG dynamically on load
        serializeSVG(svg).then((dataUrl) => {
          loader.load(dataUrl, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            cardMat.uniforms.uImage.value = tex;
            
            // Fade-in WebGL mesh and fade-out DOM SVG once confirmed rendering
            gsap.to(cardRef.opacityVal, {
              value: 1.0,
              duration: 0.4,
              onUpdate: () => {
                cardMat.uniforms.uOpacity.value = cardRef.opacityVal.value;
                svg.style.opacity = (1.0 - cardRef.opacityVal.value).toString();
                if (cardRef.opacityVal.value > 0.95) {
                  htmlElement.classList.add('webgl-active');
                  ScrollTrigger.refresh();
                }
              }
            });
          });
        });

        // 3. Hover Trigger Event listeners on DOM
        const handleMouseEnter = () => {
          if (prefersReduced) return;
          gsap.to(cardRef.distortionVal, {
            value: 1.0,
            duration: 0.6,
            ease: 'power2.out',
            onUpdate: () => {
              cardMat.uniforms.uDistortion.value = cardRef.distortionVal.value;
            }
          });
        };

        const handleMouseLeave = () => {
          gsap.to(cardRef.distortionVal, {
            value: 0.0,
            duration: 0.6,
            ease: 'power2.out',
            onUpdate: () => {
              cardMat.uniforms.uDistortion.value = cardRef.distortionVal.value;
            }
          });
          cardMat.uniforms.uMouse.value.set(0.5, 0.5);
        };

        const handleMouseMove = (e: MouseEvent) => {
          if (prefersReduced) return;
          const rect = htmlElement.getBoundingClientRect();
          const uvX = (e.clientX - rect.left) / rect.width;
          const uvY = 1.0 - (e.clientY - rect.top) / rect.height;
          cardMat.uniforms.uMouse.value.set(uvX, uvY);
        };

        htmlElement.addEventListener('mouseenter', handleMouseEnter, { passive: true });
        htmlElement.addEventListener('mouseleave', handleMouseLeave, { passive: true });
        htmlElement.addEventListener('mousemove', handleMouseMove, { passive: true });

        // 4. IntersectionObserver: toggle mesh rendering based on viewport visibility
        if ('IntersectionObserver' in window) {
          const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              cardMesh.visible = entry.isIntersecting;
            });
          }, { threshold: 0.05 });
          obs.observe(htmlElement);
          cardRef.observer = obs;
        }

        // Store event cleanup in local list
        cardCleanups.push(() => {
          htmlElement.removeEventListener('mouseenter', handleMouseEnter);
          htmlElement.removeEventListener('mouseleave', handleMouseLeave);
          htmlElement.removeEventListener('mousemove', handleMouseMove);
        });
      });
    };

    // Delay initialization slightly to let DOM styles settle
    setTimeout(setupWebGLCards, 250);

    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();
    const mouse3D = new THREE.Vector3();
    const mouseNDC = new THREE.Vector2();

    const updateMouseCoords = (clientX: number, clientY: number) => {
      mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouseNDC, camera);
      raycaster.ray.intersectPlane(plane, mouse3D);

      mousePosRef.current.x = mouse3D.x;
      mousePosRef.current.y = mouse3D.y;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseActiveRef.current = true;
      updateMouseCoords(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchActiveRef.current = true;
        updateMouseCoords(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchActiveRef.current = true;
        updateMouseCoords(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleTouchEnd = () => {
      touchActiveRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    let currentScroll = 0;
    let currentThemeProgress = themeRef.current === 'light' ? 1.0 : 0.0;
    let currentMouseStrength = 0.0;
    let currentAmbientIntensity = 1.0;
    const startTime = performance.now();

    const resize = () => {
      if (!container || !canvas || !renderer) return;
      width = container.clientWidth;
      height = container.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
      composer.setSize(width, height);
      sceneRenderTarget.setSize(width, height);

      const brX = prefersReduced ? width : (isTouch ? width * 0.5 : width);
      const brY = prefersReduced ? height : (isTouch ? height * 0.5 : height);
      bloomPass.resolution.set(brX, brY);

      // Re-align cards on resize
      const upp = getUnitsPerPixel();
      cards.forEach(card => {
        const rect = card.element.getBoundingClientRect();
        card.width = rect.width;
        card.height = rect.height;

        const initialScroll = window.scrollY || document.documentElement.scrollTop;
        card.docX = rect.left + rect.width / 2;
        card.docY = rect.top + initialScroll + rect.height / 2;

        card.mesh.geometry.dispose();
        card.mesh.geometry = new THREE.PlaneGeometry(card.width * upp.x, card.height * upp.y);
      });
    };

    const renderFrame = () => {
      const time = (performance.now() - startTime) * 0.001;

      // 1. Scroll interpolation
      const targetScroll = (scrollPercentRef.current / 100) * 3.0;
      currentScroll += (targetScroll - currentScroll) * 0.08;

      // 2. Compute weights
      const w0 = 1.0 - THREE.MathUtils.smoothstep(currentScroll, 0.0, 0.8);
      const w1 = THREE.MathUtils.smoothstep(currentScroll, 0.0, 0.8) * 
                 (1.0 - THREE.MathUtils.smoothstep(currentScroll, 1.0, 1.8));
      const w2 = THREE.MathUtils.smoothstep(currentScroll, 1.0, 1.8) * 
                 (1.0 - THREE.MathUtils.smoothstep(currentScroll, 2.0, 2.8));
      const w3 = THREE.MathUtils.smoothstep(currentScroll, 2.0, 2.8);

      const totalWeight = w0 + w1 + w2 + w3;
      uniforms.w0.value = w0 / totalWeight;
      uniforms.w1.value = w1 / totalWeight;
      uniforms.w2.value = w2 / totalWeight;
      uniforms.w3.value = w3 / totalWeight;

      // 3. Theme color interpolation
      const targetTheme = themeRef.current === 'light' ? 1.0 : 0.0;
      currentThemeProgress += (targetTheme - currentThemeProgress) * 0.08;
      uniforms.uThemeProgress.value = currentThemeProgress;

      // 4. Background Ambient Intensity Dip
      let targetAmbientIntensity = 1.0;
      if (scrollPercentRef.current > 35 && scrollPercentRef.current < 85) {
        const distToCenter = Math.abs(scrollPercentRef.current - 60) / 25;
        targetAmbientIntensity = THREE.MathUtils.lerp(0.25, 1.0, Math.min(distToCenter, 1.0));
      }
      currentAmbientIntensity += (targetAmbientIntensity - currentAmbientIntensity) * 0.08;
      uniforms.uAmbientIntensity.value = currentAmbientIntensity;

      // 5. Mouse strength and coordination
      const isInteractionActive = isTouch ? touchActiveRef.current : mouseActiveRef.current;
      const targetStrength = isInteractionActive ? 1.0 : 0.0;
      
      currentMouseStrength += (targetStrength - currentMouseStrength) * 0.05;
      uniforms.uMouseStrength.value = currentMouseStrength;

      if (isInteractionActive) {
        uniforms.uMouse.value.set(mousePosRef.current.x, mousePosRef.current.y);
      }

      // 6. Update WebGL Card Positions (Zero DOM reads on scroll)
      const currentScrollPixels = scrollOffsetRef.current;
      const upp = getUnitsPerPixel();
      cards.forEach(card => {
        const relativeY = card.docY - currentScrollPixels;

        // Align coordinates (Three.js center-screen origin, Y-up)
        const x3d = (card.docX - width / 2) * upp.x;
        const y3d = -(relativeY - height / 2) * upp.y;

        card.mesh.position.set(x3d, y3d, 0);

        // Apply updated geometries if size changes
        const currentGeom = card.mesh.geometry as THREE.PlaneGeometry;
        const targetW = card.width * upp.x;
        const targetH = card.height * upp.y;
        if (Math.abs(currentGeom.parameters.width - targetW) > 0.01) {
          card.mesh.geometry.dispose();
          card.mesh.geometry = new THREE.PlaneGeometry(targetW, targetH);
        }
      });

      // --- Post-Processing Composite Pipeline execution ---
      // 1. Render full scene (particles + cards) with camera on Layer 0 (everything)
      camera.layers.set(0);
      renderer.setRenderTarget(sceneRenderTarget);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      // 2. Set camera to Layer 1 (particles only) so RenderPass/bloom only captures particles
      camera.layers.set(1);

      grainVignettePass.uniforms.tOriginal.value = sceneRenderTarget.texture;
      grainVignettePass.uniforms.uTime.value = time;

      // 3. Render composer (UnrealBloomPass downsamples/blurs ONLY particles)
      composer.render();

      // 4. Restore camera to Layer 0
      camera.layers.set(0);
    };

    const renderLoop = () => {
      renderFrame();
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    if (prefersReduced) {
      renderFrame();
      window.addEventListener('resize', () => {
        resize();
        renderFrame();
      });
    } else {
      window.addEventListener('resize', resize, { passive: true });
      renderLoop();
    }

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(animationFrameId);
      setWebglActive(false);
    };

    const handleContextRestored = () => {
      setWebglActive(true);
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    return () => {
      cancelAnimationFrame(animationFrameId);
      
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);

      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      // Clean up cards event listeners
      cardCleanups.forEach(cb => cb());

      cards.forEach(card => {
        if (card.observer) {
          card.observer.disconnect();
        }
        scene.remove(card.mesh);
        card.mesh.geometry.dispose();
        card.mat.dispose();

        // Restore DOM SVG visibility and remove webgl-active class
        const svg = card.element.querySelector('svg');
        if (svg) {
          svg.style.opacity = '1';
        }
        card.element.classList.remove('webgl-active');
      });

      scene.remove(particles);
      geometry.dispose();
      material.dispose();
      sceneRenderTarget.dispose();
      composerRenderTarget.dispose();
      renderer.dispose();
    };
  }, [webglSupported, webglActive, prefersReducedMotion, theme]);

  if (!webglSupported || !webglActive) {
    return (
      <div 
        className="fallback-3d-bg" 
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(var(--border-color) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.25,
          zIndex: -1,
        }}
      />
    );
  }

  return (
    <div 
      ref={containerRef} 
      className="three-canvas-container"
    >
      <canvas 
        ref={canvasRef} 
        className="three-canvas" 
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
}
