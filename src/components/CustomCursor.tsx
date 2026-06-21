import { useEffect, useRef, useState } from 'react';

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  // States to track cursor active configuration
  const [isActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !isTouch && !prefersReduced;
  });
  const [isHovered, setIsHovered] = useState(false);
  const [magneticLock, setMagneticLock] = useState(false);

  const mouseRef = useRef({ x: -100, y: -100 });
  const ringPosRef = useRef({ x: -100, y: -100 });
  const hoveredElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    document.body.classList.add('custom-cursor-active');

    // --- Cursor Tracking & Smoothing Loop ---
    let animationFrameId: number;

    const updateCursorPositions = () => {
      if (dotRef.current && ringRef.current) {
        // Dot follows raw mouse position instantly
        dotRef.current.style.transform = `translate3d(${mouseRef.current.x - 2}px, ${mouseRef.current.y - 2}px, 0)`;

        if (magneticLock && hoveredElementRef.current) {
          // Magnetic Snap: outer ring snaps to the center of the hovered element
          const rect = hoveredElementRef.current.getBoundingClientRect();
          const targetX = rect.left + rect.width / 2;
          const targetY = rect.top + rect.height / 2;

          // Gentle lerp toward the lock center (Damping: 0.15)
          ringPosRef.current.x += (targetX - ringPosRef.current.x) * 0.15;
          ringPosRef.current.y += (targetY - ringPosRef.current.y) * 0.15;
        } else {
          // Standard Follow: outer ring trails the mouse position (Damping: 0.12)
          ringPosRef.current.x += (mouseRef.current.x - ringPosRef.current.x) * 0.12;
          ringPosRef.current.y += (mouseRef.current.y - ringPosRef.current.y) * 0.12;
        }

        // Apply ring position
        const ringOffset = isHovered ? 20 : 10; // offset based on width/2 (40px vs 20px)
        ringRef.current.style.transform = `translate3d(${ringPosRef.current.x - ringOffset}px, ${ringPosRef.current.y - ringOffset}px, 0)`;
      }

      animationFrameId = requestAnimationFrame(updateCursorPositions);
    };

    animationFrameId = requestAnimationFrame(updateCursorPositions);

    // --- Event Listeners ---
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;

      // Event delegation for magnetic triggers (excluding inline text links)
      const target = e.target as HTMLElement;
      const interactiveEl = target.closest<HTMLElement>(
        '.primary-btn, .secondary-btn, .escape-hatch-btn, .theme-toggle-nav, nav a, .social-circle-btn, .bento-card, .work-diagram-container, .timeline-card'
      );

      if (interactiveEl) {
        hoveredElementRef.current = interactiveEl;
        setIsHovered(true);

        // Snap fully onto button elements; scale-only on cards
        const isCard = interactiveEl.classList.contains('bento-card') || 
                      interactiveEl.classList.contains('work-diagram-container') || 
                      interactiveEl.classList.contains('timeline-card');
        setMagneticLock(!isCard);
      } else {
        hoveredElementRef.current = null;
        setIsHovered(false);
        setMagneticLock(false);
      }
    };

    const handleMouseLeaveWindow = () => {
      // Hide cursor offscreen when leaving browser frame
      mouseRef.current.x = -100;
      mouseRef.current.y = -100;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeaveWindow, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.body.classList.remove('custom-cursor-active');
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeaveWindow);
    };
  }, [magneticLock, isHovered, isActive]);

  if (!isActive) return null;

  return (
    <>
      <div 
        ref={dotRef} 
        className="custom-cursor-dot"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '4px',
          height: '4px',
          backgroundColor: 'var(--accent-cyan)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 99999,
          transform: 'translate3d(-10px, -10px, 0)',
        }}
      />
      <div 
        ref={ringRef} 
        className={`custom-cursor-ring ${isHovered ? 'hovered' : ''} ${magneticLock ? 'magnetic' : ''}`}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: isHovered ? '40px' : '20px',
          height: isHovered ? '40px' : '20px',
          border: '1.2px solid var(--accent-cyan)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 99998,
          transform: 'translate3d(-20px, -20px, 0)',
          backgroundColor: isHovered ? 'rgba(0, 242, 254, 0.04)' : 'transparent',
          borderColor: isHovered ? 'var(--accent-teal)' : 'var(--accent-cyan)',
          transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1), height 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s, background-color 0.25s',
        }}
      />
    </>
  );
}
