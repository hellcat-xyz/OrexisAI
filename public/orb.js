'use strict';

(() => {
    const mount = document.getElementById('outcomeAgentOrb');
    if (!mount) return;

    const agentView = mount.closest('[data-view="agent"]');
    const shell = mount.closest('.agent-chat-shell');
    let cleanup = null;
    let mountQueued = false;

    const vertexShaderSource = `
        precision highp float;
        attribute vec2 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const fragmentShaderSource = `
        precision highp float;
        uniform float iTime;
        uniform vec3 iResolution;
        uniform float hue;
        uniform float hover;
        uniform float rot;
        uniform float hoverIntensity;
        uniform vec3 backgroundColor;
        varying vec2 vUv;

        vec3 rgb2yiq(vec3 c) {
            float y = dot(c, vec3(0.299, 0.587, 0.114));
            float i = dot(c, vec3(0.596, -0.274, -0.322));
            float q = dot(c, vec3(0.211, -0.523, 0.312));
            return vec3(y, i, q);
        }

        vec3 yiq2rgb(vec3 c) {
            float r = c.x + 0.956 * c.y + 0.621 * c.z;
            float g = c.x - 0.272 * c.y - 0.647 * c.z;
            float b = c.x - 1.106 * c.y + 1.703 * c.z;
            return vec3(r, g, b);
        }

        vec3 adjustHue(vec3 color, float hueDeg) {
            float hueRad = hueDeg * 3.14159265 / 180.0;
            vec3 yiq = rgb2yiq(color);
            float cosA = cos(hueRad);
            float sinA = sin(hueRad);
            float i = yiq.y * cosA - yiq.z * sinA;
            float q = yiq.y * sinA + yiq.z * cosA;
            yiq.y = i;
            yiq.z = q;
            return yiq2rgb(yiq);
        }

        vec3 hash33(vec3 p3) {
            p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
            p3 += dot(p3, p3.yxz + 19.19);
            return -1.0 + 2.0 * fract(vec3(
                p3.x + p3.y,
                p3.x + p3.z,
                p3.y + p3.z
            ) * p3.zyx);
        }

        float snoise3(vec3 p) {
            const float K1 = 0.333333333;
            const float K2 = 0.166666667;
            vec3 i = floor(p + (p.x + p.y + p.z) * K1);
            vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
            vec3 e = step(vec3(0.0), d0 - d0.yzx);
            vec3 i1 = e * (1.0 - e.zxy);
            vec3 i2 = 1.0 - e.zxy * (1.0 - e);
            vec3 d1 = d0 - (i1 - K2);
            vec3 d2 = d0 - (i2 - K1);
            vec3 d3 = d0 - 0.5;
            vec4 h = max(0.6 - vec4(
                dot(d0, d0),
                dot(d1, d1),
                dot(d2, d2),
                dot(d3, d3)
            ), 0.0);
            vec4 n = h * h * h * h * vec4(
                dot(d0, hash33(i)),
                dot(d1, hash33(i + i1)),
                dot(d2, hash33(i + i2)),
                dot(d3, hash33(i + 1.0))
            );
            return dot(vec4(31.316), n);
        }

        vec4 extractAlpha(vec3 colorIn) {
            float a = max(max(colorIn.r, colorIn.g), colorIn.b);
            return vec4(colorIn.rgb / (a + 1e-5), a);
        }

        const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
        const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
        const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
        const float innerRadius = 0.6;
        const float noiseScale = 0.65;

        float light1(float intensity, float attenuation, float dist) {
            return intensity / (1.0 + dist * attenuation);
        }

        float light2(float intensity, float attenuation, float dist) {
            return intensity / (1.0 + dist * dist * attenuation);
        }

        vec4 draw(vec2 uv) {
            vec3 color1 = adjustHue(baseColor1, hue);
            vec3 color2 = adjustHue(baseColor2, hue);
            vec3 color3 = adjustHue(baseColor3, hue);
            float ang = atan(uv.y, uv.x);
            float len = length(uv);
            float invLen = len > 0.0 ? 1.0 / len : 0.0;
            float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));
            float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
            float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
            float d0 = distance(uv, (r0 * invLen) * uv);
            float v0 = light1(1.0, 10.0, d0);
            v0 *= smoothstep(r0 * 1.05, r0, len);
            float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
            v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
            float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
            float a = iTime * -1.0;
            vec2 pos = vec2(cos(a), sin(a)) * r0;
            float d = distance(uv, pos);
            float v1 = light2(1.5, 5.0, d);
            v1 *= light1(1.0, 50.0, d0);
            float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
            float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
            vec3 colBase = mix(color1, color2, cl);
            float fadeAmount = mix(1.0, 0.1, bgLuminance);
            vec3 darkCol = mix(color3, colBase, v0);
            darkCol = (darkCol + v1) * v2 * v3;
            darkCol = clamp(darkCol, 0.0, 1.0);
            vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
            lightCol = mix(backgroundColor, lightCol, v0);
            lightCol = clamp(lightCol, 0.0, 1.0);
            vec3 finalCol = mix(darkCol, lightCol, bgLuminance);
            return extractAlpha(finalCol);
        }

        vec4 mainImage(vec2 fragCoord) {
            vec2 center = iResolution.xy * 0.5;
            float size = min(iResolution.x, iResolution.y);
            vec2 uv = (fragCoord - center) / size * 2.0;
            float angle = rot;
            float s = sin(angle);
            float c = cos(angle);
            uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
            uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
            uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
            return draw(uv);
        }

        void main() {
            vec2 fragCoord = vUv * iResolution.xy;
            vec4 col = mainImage(fragCoord);
            gl_FragColor = vec4(col.rgb * col.a, col.a);
        }
    `;

    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const details = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error';
            gl.deleteShader(shader);
            throw new Error(details);
        }
        return shader;
    }

    function createProgram(gl) {
        const program = gl.createProgram();
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const details = gl.getProgramInfoLog(program) || 'Unknown shader link error';
            gl.deleteProgram(program);
            throw new Error(details);
        }
        return program;
    }

    function initializeOrb() {
        if (cleanup || mount.clientWidth === 0 || mount.clientHeight === 0) return;

        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        const gl = canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: true,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            mount.dataset.orbError = 'webgl-unavailable';
            return;
        }

        let program;
        try {
            program = createProgram(gl);
        } catch (error) {
            console.error('OrexisAI Orb shader failed:', error);
            mount.dataset.orbError = 'shader-failed';
            return;
        }

        mount.classList.add('orb-container');
        mount.replaceChildren(canvas);
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(program);

        const vertices = new Float32Array([
            -1, -1, 0, 0,
             3, -1, 2, 0,
            -1,  3, 0, 2
        ]);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
        const positionLocation = gl.getAttribLocation(program, 'position');
        const uvLocation = gl.getAttribLocation(program, 'uv');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

        const uniforms = {
            iTime: gl.getUniformLocation(program, 'iTime'),
            iResolution: gl.getUniformLocation(program, 'iResolution'),
            hue: gl.getUniformLocation(program, 'hue'),
            hover: gl.getUniformLocation(program, 'hover'),
            rot: gl.getUniformLocation(program, 'rot'),
            hoverIntensity: gl.getUniformLocation(program, 'hoverIntensity'),
            backgroundColor: gl.getUniformLocation(program, 'backgroundColor')
        };

        // Official ReactBits Orb defaults.
        const hue = 0;
        const hoverIntensity = 0.2;
        const rotateOnHover = true;
        const forceHoverState = false;
        const backgroundColor = [0, 0, 0];
        const rotationSpeed = 0.3;
        let targetHover = 0;
        let currentHover = 0;
        let currentRotation = 0;
        let lastTime = 0;
        let animationFrame = 0;

        const resize = () => {
            const width = Math.max(1, mount.clientWidth);
            const height = Math.max(1, mount.clientHeight);
            const dpr = window.devicePixelRatio || 1;
            const pixelWidth = Math.max(1, Math.round(width * dpr));
            const pixelHeight = Math.max(1, Math.round(height * dpr));
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                canvas.width = pixelWidth;
                canvas.height = pixelHeight;
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
                gl.viewport(0, 0, pixelWidth, pixelHeight);
            }
        };

        const handlePointerMove = (event) => {
            const rect = mount.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const width = rect.width;
            const height = rect.height;
            const size = Math.min(width, height);
            const centerX = width / 2;
            const centerY = height / 2;
            const uvX = ((x - centerX) / size) * 2;
            const uvY = ((y - centerY) / size) * 2;
            targetHover = Math.sqrt(uvX * uvX + uvY * uvY) < 0.8 ? 1 : 0;
        };

        const handlePointerLeave = () => {
            targetHover = 0;
        };

        const render = (time) => {
            animationFrame = requestAnimationFrame(render);
            resize();
            const dt = (time - lastTime) * 0.001;
            lastTime = time;
            const effectiveHover = forceHoverState ? 1 : targetHover;
            currentHover += (effectiveHover - currentHover) * 0.1;
            if (rotateOnHover && effectiveHover > 0.5) currentRotation += dt * rotationSpeed;

            gl.useProgram(program);
            gl.uniform1f(uniforms.iTime, time * 0.001);
            gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, canvas.width / canvas.height);
            gl.uniform1f(uniforms.hue, hue);
            gl.uniform1f(uniforms.hover, currentHover);
            gl.uniform1f(uniforms.rot, currentRotation);
            gl.uniform1f(uniforms.hoverIntensity, hoverIntensity);
            gl.uniform3f(uniforms.backgroundColor, ...backgroundColor);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };

        const pointerTarget = shell || mount;
        pointerTarget.addEventListener('pointermove', handlePointerMove);
        pointerTarget.addEventListener('pointerleave', handlePointerLeave);
        window.addEventListener('resize', resize);
        resize();
        mount.dataset.orbReady = 'true';
        animationFrame = requestAnimationFrame(render);

        cleanup = () => {
            cancelAnimationFrame(animationFrame);
            pointerTarget.removeEventListener('pointermove', handlePointerMove);
            pointerTarget.removeEventListener('pointerleave', handlePointerLeave);
            window.removeEventListener('resize', resize);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            canvas.remove();
            cleanup = null;
        };
    }

    function queueMount() {
        if (mountQueued) return;
        mountQueued = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                mountQueued = false;
                if (!agentView || !agentView.hidden) initializeOrb();
            });
        });
    }

    if (agentView) {
        new MutationObserver(queueMount).observe(agentView, {
            attributes: true,
            attributeFilter: ['hidden', 'class']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', queueMount, { once: true });
    } else {
        queueMount();
    }
})();
