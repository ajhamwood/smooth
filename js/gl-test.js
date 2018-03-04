function glInit () {
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
    }`

  //Allocate ping pong buffers
  var buffer_dims = [settings.WIDTH, settings.HEIGHT];
  var buffers = new Array(2);
  var current_buffer = 0;

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
      initial_state[ptr++] = lores[x + y * effective_dims[0]];
      initial_state[ptr++] = 0;
      initial_state[ptr++] = 0;
      initial_state[ptr++] = 0;
    }
  }

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
}
