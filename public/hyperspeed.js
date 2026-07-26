'use strict';

(() => {
    const PRESET_THREE = Object.freeze({
        particleCount: 96,
        speed: 0.52,
        vanishingX: 0.69,
        vanishingY: 0.47,
        colors: ['#ff3d81', '#8b5cf6', '#4f8cff', '#f97316', '#f8fafc']
    });

    document.addEventListener('DOMContentLoaded', () => {
        const host = document.getElementById('outcomeHyperspeed');
        const canvas = host?.querySelector('canvas');
        if (!host || !(canvas instanceof HTMLCanvasElement)) return;
        const interactionSurface = host.closest('.outcome-hero') || host;

        const context = canvas.getContext('2d', { alpha: true });
        if (!context) return;

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const particles = [];
        const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
        let width = 1;
        let height = 1;
        let dpr = 1;
        let frameId = 0;
        let previousTime = performance.now();
        let isVisible = true;
        let isDestroyed = false;

        const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

        function createParticle(index, resetDepth = false) {
            const spread = index % 5 === 0 ? 1.22 : 0.94;
            const angle = randomBetween(0, Math.PI * 2);
            const radius = Math.pow(Math.random(), 0.58) * spread;
            const particle = particles[index] || {};

            particle.x = Math.cos(angle) * radius;
            particle.y = Math.sin(angle) * radius * 0.62;
            particle.z = resetDepth ? randomBetween(0.22, 1) : 1;
            particle.previousZ = particle.z + randomBetween(0.035, 0.15);
            particle.size = randomBetween(0.55, 1.75);
            particle.brightness = randomBetween(0.45, 1);
            particle.color = PRESET_THREE.colors[Math.floor(Math.random() * PRESET_THREE.colors.length)];
            particles[index] = particle;
        }

        function seedParticles() {
            particles.length = PRESET_THREE.particleCount;
            for (let index = 0; index < particles.length; index += 1) {
                createParticle(index, true);
            }
        }

        function resize() {
            const bounds = interactionSurface.getBoundingClientRect();
            width = Math.max(1, Math.round(bounds.width));
            height = Math.max(1, Math.round(bounds.height));
            dpr = Math.min(window.devicePixelRatio || 1, 1.7);
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawFrame(0, true);
        }

        function project(particle, z, vanishingPoint) {
            const perspective = 0.16 / Math.max(0.045, z);
            return {
                x: vanishingPoint.x + particle.x * width * perspective,
                y: vanishingPoint.y + particle.y * height * perspective
            };
        }

        function drawRoad(vanishingPoint, time) {
            context.save();
            context.globalCompositeOperation = 'lighter';

            const horizonGlow = context.createRadialGradient(
                vanishingPoint.x,
                vanishingPoint.y,
                0,
                vanishingPoint.x,
                vanishingPoint.y,
                Math.max(width, height) * 0.55
            );
            horizonGlow.addColorStop(0, 'rgba(124, 58, 237, 0.24)');
            horizonGlow.addColorStop(0.28, 'rgba(59, 130, 246, 0.075)');
            horizonGlow.addColorStop(1, 'rgba(2, 3, 8, 0)');
            context.fillStyle = horizonGlow;
            context.fillRect(0, 0, width, height);

            const roadBottom = height * 1.08;
            const laneOffsets = [-0.72, -0.44, -0.18, 0.18, 0.44, 0.72];
            laneOffsets.forEach((offset, index) => {
                context.beginPath();
                context.moveTo(vanishingPoint.x, vanishingPoint.y);
                context.lineTo(vanishingPoint.x + offset * width * 0.7, roadBottom);
                context.strokeStyle = index < 3
                    ? 'rgba(255, 61, 129, 0.12)'
                    : 'rgba(79, 140, 255, 0.12)';
                context.lineWidth = 1;
                context.stroke();
            });

            const segmentOffset = (time * 0.00022) % 1;
            for (let index = 0; index < 15; index += 1) {
                const depth = ((index / 15) + segmentOffset) % 1;
                const eased = depth * depth;
                const y = vanishingPoint.y + eased * (roadBottom - vanishingPoint.y);
                const halfWidth = eased * width * 0.42;
                const alpha = eased * 0.18;
                context.beginPath();
                context.moveTo(vanishingPoint.x - halfWidth, y);
                context.lineTo(vanishingPoint.x + halfWidth, y);
                context.strokeStyle = `rgba(129, 92, 246, ${alpha})`;
                context.lineWidth = Math.max(0.5, eased * 1.8);
                context.stroke();
            }

            context.restore();
        }

        function drawParticles(vanishingPoint, deltaSeconds, staticFrame) {
            context.save();
            context.globalCompositeOperation = 'lighter';

            particles.forEach((particle, index) => {
                if (!staticFrame) {
                    particle.previousZ = particle.z + Math.max(0.018, deltaSeconds * PRESET_THREE.speed * 0.72);
                    particle.z -= deltaSeconds * PRESET_THREE.speed * (0.55 + particle.size * 0.24);
                    if (particle.z <= 0.035) createParticle(index, false);
                }

                const current = project(particle, particle.z, vanishingPoint);
                const previous = project(particle, particle.previousZ, vanishingPoint);
                const distanceFromCenter = Math.hypot(current.x - vanishingPoint.x, current.y - vanishingPoint.y);
                const fade = Math.min(1, distanceFromCenter / Math.max(60, width * 0.22));
                const alpha = particle.brightness * fade * 0.78;

                context.beginPath();
                context.moveTo(previous.x, previous.y);
                context.lineTo(current.x, current.y);
                context.strokeStyle = hexToRgba(particle.color, alpha);
                context.lineWidth = Math.min(5.5, particle.size / Math.max(0.18, particle.z));
                context.shadowColor = particle.color;
                context.shadowBlur = Math.min(14, 4 + particle.size * 4);
                context.stroke();

                if (particle.z < 0.22) {
                    context.beginPath();
                    context.arc(current.x, current.y, Math.min(3.8, particle.size / particle.z * 0.2), 0, Math.PI * 2);
                    context.fillStyle = hexToRgba(particle.color, alpha * 0.7);
                    context.fill();
                }
            });

            context.restore();
        }

        function drawFrame(deltaSeconds = 0, staticFrame = false, time = performance.now()) {
            context.clearRect(0, 0, width, height);
            context.fillStyle = 'rgba(4, 5, 12, 0.58)';
            context.fillRect(0, 0, width, height);

            pointer.x += (pointer.targetX - pointer.x) * 0.045;
            pointer.y += (pointer.targetY - pointer.y) * 0.045;

            const vanishingPoint = {
                x: width * (PRESET_THREE.vanishingX + pointer.x * 0.025),
                y: height * (PRESET_THREE.vanishingY + pointer.y * 0.018)
            };

            drawRoad(vanishingPoint, time);
            drawParticles(vanishingPoint, deltaSeconds, staticFrame);

            const edgeShade = context.createLinearGradient(0, 0, width, 0);
            edgeShade.addColorStop(0, 'rgba(3, 4, 10, 0.72)');
            edgeShade.addColorStop(0.38, 'rgba(3, 4, 10, 0.28)');
            edgeShade.addColorStop(0.72, 'rgba(3, 4, 10, 0.02)');
            edgeShade.addColorStop(1, 'rgba(3, 4, 10, 0.22)');
            context.fillStyle = edgeShade;
            context.fillRect(0, 0, width, height);
        }

        function animate(now) {
            if (isDestroyed || !isVisible || document.hidden || reducedMotion.matches) {
                frameId = 0;
                return;
            }

            const deltaSeconds = Math.min(0.04, Math.max(0, (now - previousTime) / 1000));
            previousTime = now;
            drawFrame(deltaSeconds, false, now);
            frameId = window.requestAnimationFrame(animate);
        }

        function startAnimation() {
            if (frameId || isDestroyed || !isVisible || document.hidden || reducedMotion.matches) return;
            previousTime = performance.now();
            frameId = window.requestAnimationFrame(animate);
        }

        function stopAnimation() {
            if (!frameId) return;
            window.cancelAnimationFrame(frameId);
            frameId = 0;
        }

        function handlePointerMove(event) {
            const bounds = interactionSurface.getBoundingClientRect();
            pointer.targetX = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2;
            pointer.targetY = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * 2;
        }

        function handlePointerLeave() {
            pointer.targetX = 0;
            pointer.targetY = 0;
        }

        function handleMotionPreference() {
            stopAnimation();
            if (reducedMotion.matches) {
                drawFrame(0, true);
                return;
            }
            startAnimation();
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                stopAnimation();
                return;
            }
            startAnimation();
        }

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(resize)
            : null;
        const intersectionObserver = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver((entries) => {
                isVisible = entries.some((entry) => entry.isIntersecting);
                if (isVisible) startAnimation();
                else stopAnimation();
            }, { threshold: 0.05 })
            : null;

        seedParticles();
        resize();
        resizeObserver?.observe(host);
        intersectionObserver?.observe(host);
        interactionSurface.addEventListener('pointermove', handlePointerMove, { passive: true });
        interactionSurface.addEventListener('pointerleave', handlePointerLeave, { passive: true });
        document.addEventListener('visibilitychange', handleVisibilityChange);
        reducedMotion.addEventListener?.('change', handleMotionPreference);
        if (reducedMotion.matches) drawFrame(0, true);
        else startAnimation();

        window.addEventListener('pagehide', () => {
            isDestroyed = true;
            window.cancelAnimationFrame(frameId);
            resizeObserver?.disconnect();
            intersectionObserver?.disconnect();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            reducedMotion.removeEventListener?.('change', handleMotionPreference);
        }, { once: true });
    });

    function hexToRgba(hex, alpha) {
        const normalized = hex.replace('#', '');
        const value = Number.parseInt(normalized.length === 3
            ? normalized.split('').map((character) => character + character).join('')
            : normalized, 16);
        const red = (value >> 16) & 255;
        const green = (value >> 8) & 255;
        const blue = value & 255;
        return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
    }
})();
