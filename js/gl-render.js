var settings = {
    WIDTH: size,
    HEIGHT: size,
    KERNEL_RADIUS: radius * 1.1,
    INNER_RADIUS: radius / neighbourhood,
    OUTER_RADIUS: radius,
    BIRTH_LO: birthStart,
    BIRTH_HI: birthEnd,
    DEATH_LO: deathStart,
    DEATH_HI: deathEnd,
    ALPHA_N: transitionFuzz,
    ALPHA_M: existenceFuzz
  },
passThruVS = `
  attribute vec3 vertices;
  attribute vec2 uvs;
  varying   vec2 uv;

  void main(void) {
    uv = uvs;
    gl_Position = vec4( vertices.x, vertices.y, 1.0, 1.0 );
  }`,
commonFS = `
  #ifdef GL_ES
    precision highp float;
  #endif
  #define PI 3.14159265358979323846264
  ${(function() {
    var result = "";
    for (k in settings) result += "#define " + k + " " + settings[k] + "\n";
    return result
  })()}

  uniform sampler2D state;
  varying vec2      uv;
  float f(vec2 p) {
    return texture2D(state, uv + (p / vec2(WIDTH, HEIGHT))).r;
  }`,
updateStateFS = commonFS + `
  float sigma1(float x, float a, float alpha) {
    return 1.0 / (1.0 + exp(-4.0 * (x - a) / alpha));
  }
  float sigma_n(float x, float a, float b) {
    return sigma1(x, a, ALPHA_N) * (1.0 - sigma1(x, b, ALPHA_N));
  }
  float sigma_m(float x, float y, float m) {
    float w = sigma1(m, 0.5, ALPHA_M);
    return x * (1.0 - w) + y * w;
  }
  float S(float n, float m) {
    return sigma_n(n,
      sigma_m(BIRTH_LO, DEATH_LO, m),
      sigma_m(BIRTH_HI, DEATH_HI, m));
  }

  float weight(float r, float cutoff) {
    return 1.0 - sigma1(r, cutoff, 0.5);
  }

  void main( void ) {
    const float RI = float(INNER_RADIUS);
    const float RO = float(OUTER_RADIUS);

    float r1 = 0.0, r2 = 0.0, w1 = 0.0, w2 = 0.0;
    for (int i =- KERNEL_RADIUS; i <= KERNEL_RADIUS; ++i)
    for (int j =- KERNEL_RADIUS; j <= KERNEL_RADIUS; ++j) {
      float s = f(vec2(i, j));
      float r = sqrt(float(i * i + j * j));
      float wi = weight(r, RI);
      r1 += s * wi;
      w1 += wi;
      float wo = weight(r, RO);
      r2 += s * wo;
      w2 += wo;
    }

    float m = r1 / w1;
    float n = (r2 - r1) / (w2 - w1);

    gl_FragColor = vec4(S(n, m), m, n, 0);
  }`,
renderStateFS = commonFS + `
  void main(void) {
    vec4 cell_state = texture2D(state, uv);
    gl_FragColor = vec4(cell_state.yyy, 1);
  }`;

//Make sure we have floating point textures
if(!context.enableExtension("OES_texture_float")) {
  throw "No support for float textures!"
}

//Allocate ping pong buffers
var buffer_dims = [ settings.WIDTH, settings.HEIGHT ];
var buffers = new Array(2);
var current_buffer = 0;
(function() {
  var effective_dims = [Math.ceil(buffer_dims[0]/settings.INNER_RADIUS),
                        Math.ceil(buffer_dims[1]/settings.INNER_RADIUS)];
  var lores = new Array(effective_dims[0] * effective_dims[1]);
  for(var i = 0; i < lores.length; ++i) {
    lores[i] = (Math.random() < 0.5) ? 0 : 1;
  }

  //Create initial conditions
  var initial_state = new Float32Array(buffer_dims[0] * buffer_dims[1] * 4);
  var ptr = 0;
  for(var j = 0; j < buffer_dims[1]; ++j) {
    for(var i = 0; i < buffer_dims[0]; ++i) {
      var x = Math.floor(i / settings.INNER_RADIUS);
      var y = Math.floor(j / settings.INNER_RADIUS);

      //initial_state[ptr]   = (100 < i && i < 114 && 100 < j && j < 114) ? 1 : 0;
      initial_state[ptr]   = lores[x + y * effective_dims[0]];
      initial_state[ptr + 1] = 0;
      initial_state[ptr + 2] = 0;
      initial_state[ptr + 3] = 0;
      ptr += 4;
    }
  }

  //Initialize buffers
  for (var i = 0; i < 2; i++) {
    buffers[i] = {
      width:     buffer_dims[0],
      height:    buffer_dims[1],
      magFilter: context.NEAREST,
      minFilter: context.NEAREST,
      type:      context.FLOAT,
      wrapS:     context.REPEAT,
      wrapT:     context.REPEAT,
      depth:     false,
      stencil:   false,
      data:      initial_state
    };
  }
})();

function makeShader (frag_src, buf_num) {
  function shader (type, source) {
    var shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    var success = context.getShaderParameter(shader, context.COMPILE_STATUS);
    if (success) return shader;
    else {
      console.log(context.getShaderInfoLog(shader));
      context.deleteShader(shader);
      return false
    }
  }

  var vertexShader = shader(gl.VERTEX_SHADER, passThruVS),
      fragmentShader = shader(gl.FRAGMENT_SHADER, frag_src);
  if (!vertexShader || !fragmentShader) return false;

  function createProgram (vertexShader, fragmentShader) {
    var program = context.createProgram();
    context.attachShader(program, vertexShader);
    context.attachShader(program, fragmentShader);
    context.linkProgram(program);
    var success = context.getProgramParameter(program, context.LINK_STATUS);
    if (success) return program;
    else {
      console.log(context.getProgramInfoLog(program));
      context.deleteProgram(program);
      return false
    }
  }

  var program = createProgram(vertexShader, fragmentShader);
  return program
}

//Create processes
var updatePass = new Array(2);
var renderPass = new Array(2);

//This is stupid, but I can't figure out how to get GLOW to swap a buffer -Mik
(function () {
  function bufbind () {
    var positionAttributeLocation = context.getAttribLocation(program, "a_position");
    var positionBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    var positions = [0,0];
    context.bufferData(context.ARRAY_BUFFER, new Float32Array(positions), context.STATIC_DRAW);
  }
  for (var i = 0; i < 2; i++) {
    updatePass[i] = makeShader(updateStateFS, 1 - i);
    renderPass[i] = makeShader(renderStateFS, i);
    bufbind(updatePass[i]);
    bufbind(renderPass[i])
  }
})();

//Render a frame
function renderWebGL() {
  //Initialize context
  function bufbind () {}
  function bufunbind () {}

  for(var i = 0; i < (settings.STEPS_PER_FRAME = 1); i++) {
    //Increment buffer number
    current_buffer = 1 - current_buffer;

    //Compute next state
    //bufbind(buffers[current_buffer]);
    updatePass[current_buffer].draw();
    //bufunbind(buffers[current_buffer]);
  }

  //Render state of system to canvas
  renderPass[current_buffer].draw();

  requestAnimationFrame(render);
}
