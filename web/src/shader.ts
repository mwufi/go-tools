// "Route map" shader: slow topographic contours in ink on paper, with one
// contour picked out in signal colour, the way a route is drawn on a map.
// `focus` > 0 pulls the contours toward the centre (used while thinking).

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 res; uniform float t; uniform float focus; uniform float density;
uniform vec3 paper; uniform vec3 ink; uniform vec3 sig;
out vec4 o;

vec2 hash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash(i), f), dot(hash(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y);
  float r = length(uv);
  vec2 q = uv * 1.35 + vec2(t * 0.018, -t * 0.011);
  vec2 warp = vec2(fbm(q + t * 0.02), fbm(q + 5.2 - t * 0.015));
  float h = fbm(q + 1.6 * warp);
  // While thinking, the terrain becomes a basin that draws everything to the centre.
  h = mix(h, h * 0.45 - r * 0.9 + t * 0.05, focus);
  float k = h * density;
  float w = fwidth(k);
  float dist = 0.5 - abs(fract(k) - 0.5);            // distance to the nearest contour
  float line = 1.0 - smoothstep(0.0, w * 1.2, dist);
  float dist5 = (0.5 - abs(fract(k / 5.0) - 0.5)) * 5.0; // every fifth contour is heavier
  float major = 1.0 - smoothstep(0.0, w * 1.8, dist5);
  float route = 1.0 - smoothstep(0.0, w * 2.2, abs(k - 2.2)); // the one contour drawn as a route
  float clean = 1.0 - smoothstep(0.18, 0.45, w);           // drop lines where they bunch into moire
  line *= clean; major *= clean; route *= clean;
  vec3 col = mix(paper, ink, line * 0.13 + major * 0.11);
  col = mix(col, sig, route * (0.82 + 0.18 * sin(t * 1.3)));
  o = vec4(col, 1.0);
}`;

function cssColor(name: string): [number, number, number] {
  const probe = document.createElement("i");
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const m = c.match(/[\d.]+/g) ?? ["0", "0", "0"];
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

export type ShaderHandle = { setFocus(f: number): void; destroy(): void };

export function startShader(
  canvas: HTMLCanvasElement,
  opts: { focus?: number; density?: number; speed?: number } = {},
): ShaderHandle | null {
  const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram()!;
  try {
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  } catch (e) {
    console.warn(e);
    return null;
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u("res"), t: u("t"), focus: u("focus"), density: u("density"), paper: u("paper"), ink: u("ink"), sig: u("sig") };

  let colors = { paper: cssColor("--paper"), ink: cssColor("--ink"), sig: cssColor("--signal") };
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => (colors = { paper: cssColor("--paper"), ink: cssColor("--ink"), sig: cssColor("--signal") });
  mq.addEventListener("change", onScheme);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let focus = opts.focus ?? 0;
  let focusTarget = focus;
  const speed = opts.speed ?? 1;
  let raf = 0;
  let t = 7.0;
  let last = performance.now();
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      t += dt * speed;
      focus += (focusTarget - focus) * Math.min(1, dt * 2.5);
      resize();
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.t, t);
      gl.uniform1f(U.focus, focus);
      gl.uniform1f(U.density, opts.density ?? 14);
      gl.uniform3fv(U.paper, colors.paper);
      gl.uniform3fv(U.ink, colors.ink);
      gl.uniform3fv(U.sig, colors.sig);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!reduced) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    setFocus(f) {
      focusTarget = f;
      if (reduced) requestAnimationFrame(frame);
    },
    destroy() {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onScheme);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
