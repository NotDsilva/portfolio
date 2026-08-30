// High-Performance Smooth Scroll-Driven Frame Animation Engine (WebP Accelerated)
(function () {
  'use strict';

  const TOTAL_FRAMES = 240;
  const FRAME_PATH = (index) => `frames_webp/frame_${String(index + 1).padStart(4, '0')}.webp`;
  const FALLBACK_PATH = (index) => `frames/frame_${String(index + 1).padStart(4, '0')}.png`;

  const canvas = document.getElementById('animation-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const loader = document.getElementById('loader');
  const loaderProgress = document.getElementById('loader-progress');
  const loaderText = document.getElementById('loader-text');

  const images = new Array(TOTAL_FRAMES);
  const isLoaded = new Uint8Array(TOTAL_FRAMES);
  let loadedCount = 0;
  let targetFrame = 0;
  let currentFrame = 0;
  let renderedFrame = -1;
  let needsResize = true;
  let isInitialFrameDrawn = false;
  let cachedMaxScroll = 1;

  // Inertia smoothing factor (0.12 provides silky Apple-like momentum)
  const EASING = 0.12;

  // Cached canvas dimensions & layout
  let canvasW = 0;
  let canvasH = 0;

  // Recalculate metrics on resize only (prevents layout thrashing on scroll)
  function updateMetrics() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvasW = targetW;
      canvasH = targetH;
      needsResize = true;
    }

    const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
    cachedMaxScroll = Math.max(1, scrollHeight - h);
  }

  // Fast O(1) nearest-neighbor fallback for 100% flicker-free scrubbing
  function getNearestLoadedImage(targetIdx) {
    targetIdx = Math.max(0, Math.min(TOTAL_FRAMES - 1, targetIdx));

    if (isLoaded[targetIdx]) {
      return images[targetIdx];
    }

    // Bidirectional search outward for the closest loaded frame
    let offset = 1;
    while (targetIdx - offset >= 0 || targetIdx + offset < TOTAL_FRAMES) {
      const prev = targetIdx - offset;
      if (prev >= 0 && isLoaded[prev]) {
        return images[prev];
      }
      const next = targetIdx + offset;
      if (next < TOTAL_FRAMES && isLoaded[next]) {
        return images[next];
      }
      offset++;
    }

    return null;
  }

  // Direct hardware-accelerated canvas render with cover scaling
  function drawFrame(frameIndex) {
    const img = getNearestLoadedImage(frameIndex);
    if (!img) return;

    const cw = canvasW || canvas.width;
    const ch = canvasH || canvas.height;
    const iw = img.naturalWidth || 1920;
    const ih = img.naturalHeight || 1080;

    const canvasRatio = cw / ch;
    const imgRatio = iw / ih;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (canvasRatio > imgRatio) {
      drawWidth = cw;
      drawHeight = cw / imgRatio;
      offsetX = 0;
      offsetY = (ch - drawHeight) / 2;
    } else {
      drawWidth = ch * imgRatio;
      drawHeight = ch;
      offsetX = (cw - drawWidth) / 2;
      offsetY = 0;
    }

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    renderedFrame = frameIndex;
  }

  // Pure O(1) scroll handler — strictly NO DOM queries or reflows
  function onScroll() {
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const progress = Math.min(Math.max(scrollTop / cachedMaxScroll, 0), 1);
    targetFrame = progress * (TOTAL_FRAMES - 1);
  }

  // Buttery 60fps / 120fps physics render loop
  function renderLoop() {
    const delta = targetFrame - currentFrame;
    if (Math.abs(delta) > 0.0005) {
      currentFrame += delta * EASING;
    } else {
      currentFrame = targetFrame;
    }

    const frameToDraw = Math.round(currentFrame);

    if (frameToDraw !== renderedFrame || needsResize) {
      drawFrame(frameToDraw);
      needsResize = false;
    }

    requestAnimationFrame(renderLoop);
  }

  // Track frame load progress
  function onFrameLoaded(index) {
    isLoaded[index] = 1;
    loadedCount++;

    const percent = Math.min(100, Math.round((loadedCount / TOTAL_FRAMES) * 100));
    if (loaderProgress) {
      loaderProgress.style.width = `${percent}%`;
    }
    if (loaderText) {
      loaderText.textContent = `Loading ${percent}%`;
    }

    // Instant first frame render
    if (index === 0 && !isInitialFrameDrawn) {
      isInitialFrameDrawn = true;
      drawFrame(0);
    }

    // Smoothly dissolve loader once frames are ready
    if (loadedCount >= TOTAL_FRAMES) {
      setTimeout(() => {
        if (loader) {
          loader.classList.add('loaded');
        }
      }, 250);
    }
  }

  // Preload frames with controlled concurrency pool (prevents network and CPU bottlenecks)
  function preloadFrames() {
    // 1. Prioritize frame 0 immediately
    const firstImg = new Image();
    firstImg.src = FRAME_PATH(0);
    images[0] = firstImg;
    firstImg.onload = () => onFrameLoaded(0);
    firstImg.onerror = () => {
      // Fallback to PNG if WebP fails
      firstImg.src = FALLBACK_PATH(0);
      firstImg.onload = () => onFrameLoaded(0);
    };

    // 2. Concurrency pool for the remaining frames
    const CONCURRENCY = 6;
    let nextIndex = 1;

    function loadNext() {
      if (nextIndex >= TOTAL_FRAMES) return;

      const idx = nextIndex++;
      const img = new Image();
      images[idx] = img;

      img.onload = () => {
        onFrameLoaded(idx);
        loadNext();
      };
      img.onerror = () => {
        img.src = FALLBACK_PATH(idx);
        img.onload = () => onFrameLoaded(idx);
        img.onerror = () => onFrameLoaded(idx);
        loadNext();
      };
      img.src = FRAME_PATH(idx);
    }

    // Start initial pool workers
    for (let i = 0; i < CONCURRENCY; i++) {
      loadNext();
    }
  }

  // High-performance IntersectionObserver for nav active state (0ms scroll cost)
  function setupNavObserver() {
    const sections = document.querySelectorAll('section[id], footer[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            navLinks.forEach((link) => {
              const href = link.getAttribute('href');
              if (href === `#${id}`) {
                link.classList.add('active');
              } else {
                link.classList.remove('active');
              }
            });
          }
        });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );

    sections.forEach((sec) => observer.observe(sec));
  }

  // Smooth click scroll
  function setupNavLinks() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href').slice(1);
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  // Mobile Navigation Drawer Toggle
  function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-nav-toggle');
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!toggleBtn || !drawer) return;

    function toggleMenu(open) {
      const isOpen = open !== undefined ? open : !drawer.classList.contains('active');
      drawer.classList.toggle('active', isOpen);
      toggleBtn.classList.toggle('active', isOpen);
      toggleBtn.setAttribute('aria-expanded', isOpen);
      drawer.setAttribute('aria-hidden', !isOpen);
    }

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Close when clicking any link inside drawer
    drawer.querySelectorAll('.mobile-nav-link, a').forEach((link) => {
      link.addEventListener('click', () => toggleMenu(false));
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (drawer.classList.contains('active') && !drawer.contains(e.target) && !toggleBtn.contains(e.target)) {
        toggleMenu(false);
      }
    });
  }

  // Initialize engine
  function init() {
    updateMetrics();
    onScroll();
    preloadFrames();
    setupNavObserver();
    setupNavLinks();
    setupMobileMenu();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => {
      updateMetrics();
      needsResize = true;
    }, { passive: true });

    // Start 60fps render loop
    requestAnimationFrame(renderLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
