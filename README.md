# Kash Moulik — Portfolio Site (v2.0 "Director's Cut")

A premium, production-grade 3D portfolio showcasing enterprise AI engineering, Multi-Agent systems, and custom Model Context Protocol (MCP) integrations. 

Built using a hybrid WebGL-DOM rendering model, this site blends a custom Three.js post-processing pipeline with clean, accessible DOM layouts and animations.

🌐 **Live Site:** [https://blazeaxel99.github.io/kashmoulik.io-v2/](https://blazeaxel99.github.io/kashmoulik.io-v2/)

---

## ✨ Features & Architecture

### 1. WebGL Morphing Particles ([ThreeCanvas.tsx](src/components/ThreeCanvas.tsx))
- **5,000 Particle Engine**: Custom WebGL canvas rendering interactive particle structures.
- **GLSL Shaders**:
  - **Vertex Shader**: Computes real-time scroll-driven morphing between 4 distinct mathematical states: **Strand Helix** (Hero), **Structured Grid** (Bento Stats), **Sine Wave Landscape** (Work/Timeline), and **Spiral Vortex** (Contact). Handles pointer displacement fields to push particles away.
  - **Fragment Shader**: Computes antialiased circular points and blends position-based height gradients.
- **Layers-Isolated Bloom**: Uses **Three.js Layers** (`Layer 1` for particles, `Layer 0` for all meshes) to run the `UnrealBloomPass` exclusively on the background particles. This keeps the project architecture cards crisp and readable in light mode, avoiding any wash-out or bloom-bleeding effects.

### 2. Device Profiling & Performance Tiers
The experience automatically scales its rendering settings based on hardware capabilities and accessibility settings:
- **High-End Desktop**: 5,000 particles, full-resolution bloom pass, animated film grain, radial vignette, and custom cursor.
- **Mobile / Touch Devices**: Automatically limits to 1,500 particles, halves bloom resolution, lowers grain, and disables the desktop-specific custom cursor to conserve battery and GPU lifespans.
- **Reduced Motion**: Respects `prefers-reduced-motion` settings. It halts particle morphs, displays a static composition, and **entirely cancels the requestAnimationFrame loop** to save 100% of CPU/GPU resources.
- **WebGL Context Handling**: Instantly falls back to a clean CSS radial dot grid if the WebGL context is lost (e.g., when the browser tab is backgrounded) and automatically recovers.

### 3. Premium Magnetic Cursor ([CustomCursor.tsx](src/components/CustomCursor.tsx))
- **Damped Trailing Ring**: A dual-element cursor (active center dot + trailing outer ring) with custom damping parameters (`0.12`).
- **HUD Lock & Snap**: Snaps the outer ring directly to the center of active buttons (magnetic locking) and displays scale expansions over bento cards and timeline elements. Disables automatically on touch devices.

### 4. Smooth Inertial Scroll & GSAP Choreography
- **Lenis Scroll**: Implements inertial scrolling to smooth viewport movement.
- **ScrollTrigger Sync**: Links absolute scroll pixel coordinates directly to the WebGL shader uniforms and GSAP animation timelines, ensuring zero latency or alignment drift.
- **CSS Glow HUD Polish**: Interactive `.glass-panel` cards feature gradient-masked borders that trace a flowing glow path (`borderGlowFlow` keyframes) on hover.

---

## 🛠️ Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **3D Engine**: Three.js (WebGL)
- **Animation**: GreenSock (GSAP) + ScrollTrigger, Framer Motion
- **Scrolling**: Lenis (Inertial Scroll)
- **Icons**: Lucide React
- **Styling**: Premium CSS variables with dynamic dark/light theme switching

---

## 📂 File Structure

```
kashmoulik.io/
├── .github/workflows/    # GitHub Actions CI/CD deployment
│   └── deploy.yml        # Autodetect pushes to master and deploy to gh-pages
├── src/
│   ├── components/
│   │   ├── ThreeCanvas.tsx           # Primary WebGL context, shaders, & render loop
│   │   ├── CustomCursor.tsx          # Dual-element magnetic cursor
│   │   ├── ArchitectureDiagram.tsx   # Inline self-contained SVG project diagrams
│   │   └── CustomCursor.css          # Cursor styling and hide-native rules
│   ├── App.tsx                       # Layout, Lenis scroll, and GSAP timeline triggers
│   ├── App.css                       # Layout component styles
│   ├── index.css                     # Design tokens, variables, themes, & global styles
│   └── main.tsx                      # App entry point
├── public/                           # Static assets (PDFs, icons)
├── vite.config.ts                    # Vite build configuration (base path set to v2)
└── package.json                      # Build & scripts manager
```

---

## 🚀 Local Development

### 1. Prerequisites
Ensure you have **Node.js (v20+)** installed.

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:5173/kashmoulik.io-v2/](http://localhost:5173/kashmoulik.io-v2/) in your browser.

### 4. Build for Production
Verify that compilation succeeds and builds static assets inside `dist/`:
```bash
npm run build
```

---

## 📄 CI/CD Deployment

The repository includes a GitHub Action in `.github/workflows/deploy.yml` that:
1. Runs on every `push` to the `master` branch.
2. Performs a production build.
3. Deploys the static assets directly to the `gh-pages` branch.
4. Serves it live via GitHub Pages.
