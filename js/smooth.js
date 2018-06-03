function $ (sel, node) { return Array.prototype.slice.call( (node || document).querySelectorAll(sel) ) }
$.addEvents = function (obj, node) {
  for (var q in obj) for (var e in obj[q])
    for (var ns = q ? $(q, node) : [window, document], es = e.split(" "), i = 0; i < es.length; i++)
      typeof ns === "undefined" || ns.forEach(n => n.addEventListener(es[i], obj[q][e].bind(n))) };
$.Local = (function () {
  function Local (ns) { this._ns = ns }
  Local.prototype = {
    getItem: function (k) { return JSON.parse(localStorage.getItem(this._ns) || "{}")[k] },
    setItem: function (k, v) { return localStorage.setItem(this._ns, JSON.stringify(Object.assign(JSON.parse(localStorage.getItem(this._ns) || "{}"), {[k]: v}))), v },
    constructor: Local
  };
  return Local
})();
var local = new $.Local("smooth");

function zeroArray (s) { return new Float32Array(s*s).fill(0) }
function resetLoop () {
  loop = () => false;
  requestAnimationFrame(() => (loop = loopInit())())
}
function cancelEdit () {
  this.value = this.previousSibling.innerText;
  this.parentNode.classList.remove("edit")
}
function setDefault (k, v) {
  var t = local.getItem(k);
  return typeof t == "undefined" ? v : t
}

var magnification = local.setItem("magnification", setDefault("magnification", 1)),
    radius = local.setItem("radius", setDefault("radius", 8)),
    neighbourhood = local.setItem("neighbourhood", setDefault("neighbourhood", 3)),
    birthStart = local.setItem("birthStart", setDefault("birthStart", .269)),
    birthEnd = local.setItem("birthEnd", setDefault("birthEnd", .289)),
    deathStart = local.setItem("deathStart", setDefault("deathStart", .228)),
    deathEnd = local.setItem("deathEnd", setDefault("deathEnd", .406)),
    transitionFuzz = local.setItem("transitionFuzz", setDefault("transitionFuzz", .028)),
    existenceFuzz = local.setItem("existenceFuzz", setDefault("existenceFuzz", .147)),
    spray = local.setItem("spray", setDefault("spray", .4)),
    speed = local.setItem("speed", setDefault("speed", .2)),
    fps = local.setItem("fps", setDefault("fps", 30)),

    canvas = $("canvas")[0], context = canvas.getContext("2d"), recording = false, video,
    loop, pause = true, size, fields, current_field, M_re, M_im, N_re, N_im;

function refreshCanvas (update) {
  var vw = document.body.clientWidth, vh = document.body.clientHeight, prev = size;
  canvas.width = canvas.height = size = Math.pow(2, Math.floor(Math.log2(vw > vh ? vh : vw)) - magnification);
  if (size != prev || update) {
    function BesselJ (radius) {
      var field = zeroArray(size);
      var weight = 0;
      for (var i = 0; i < size; i++) for (var j = 0; j < size; j++) {
        var ii = ((i + size / 2) % size) - size / 2;
        var jj = ((j + size / 2) % size) - size / 2;

        var r = Math.sqrt(ii * ii + jj * jj) - radius;
        var v = 1 / (1 + Math.exp(Math.log2(size) * r));

        weight += v;
        field[i*size + j] = v
      }

      var imag_field = zeroArray(size);
      fft2(1, field, imag_field);
      return { re: field, im: imag_field, w: weight };
    }

    return fft_init(size).then(x => {
      var innerBessel = BesselJ(radius);
      var outerBessel = BesselJ(radius * neighbourhood);

      var innerWeight = 1 / innerBessel.w;
      var outerWeight = 1 / (outerBessel.w - innerBessel.w);

      M_re = innerBessel.re;
      M_im = innerBessel.im;
      N_re = outerBessel.re;
      N_im = outerBessel.im;

      for (var i = 0; i < size; i++) for (var j = 0; j < size; j++) {
        N_re[i*size + j] = outerWeight * (N_re[i*size + j] - M_re[i*size + j]);
        N_im[i*size + j] = outerWeight * (N_im[i*size + j] - M_im[i*size + j]);
        M_re[i*size + j] *= innerWeight;
        M_im[i*size + j] *= innerWeight
      }
    })
  } else return Promise.resolve()
}

//FFT
var fft_instance, memory, bit_reversed, trig_tables, mem_re, mem_im, bpe = 4;
function fft_init (n) {
  return new Promise(resolve => {
    let wasmAwait = resolve;
    if ("WebAssembly" in window) {
      if (!fft_instance) {
        wasmAwait = () => {};
        memory = new WebAssembly.Memory({initial: 1});
        //WebAssembly.instantiateStreaming(fetch('wasm/fft.wasm'), importObj).then(results => { //application/wasm
        fetch('wasm/fft.wasm', {mode: "no-cors"})
          .then(response => response.arrayBuffer())
          .then(bytes => WebAssembly.instantiate(bytes, {js: {memory}}))
          .then(results => resolve(fft_instance = results.instance.exports.fft));
      } else new Uint32Array(memory.buffer).fill(0)
    } else memory = new ArrayBuffer(4 * n * bpe);
    let mb = memory.buffer || memory, levels = 0;
    bit_reversed = new Uint32Array(mb, 0, n);
    for (let m = n; m > 1; m >>= 1) levels++;
    for (let i = 0; i < n; i++)
      for (let x = i, j = 0; j < levels; j++, x >>= 1) bit_reversed[i] = (bit_reversed[i] << 1) | (x & 1);
    trig_tables = new Float32Array(mb, n * bpe, n);
    for (let i = 0; i < n; i++) trig_tables[i] = i % 2 ?
      Math.sin(Math.PI * (i - 1) / n):
      Math.cos(Math.PI * i / n);
    mem_re = new Float32Array(mb, 2 * n * bpe, n);
    mem_im = new Float32Array(mb, 3 * n * bpe, n);
    wasmAwait()
  })
}

function fft (dir, re, im) {
  var n = re.length;
  if (n < 4 || n > Number.MAX_SAFE_INTEGER || n & (n-1) != 0) return null;
  if ("WebAssembly" in window) {
    mem_re.set(re, 0);
    mem_im.set(im, 0);
    fft_instance(n, dir);
    re.set(mem_re, 0);
    im.set(mem_im, 0)
  } else {
    var levels, i, j, tmp, tmp2, s, step, k, l;
    // Bit-reversed addressing permutation
    for (i = 1; i < n - 1; i++) {
      j = bit_reversed[i];
      if (j > i) {
        tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    // Cooley-Tukey decimation-in-time radix-2 FFT
    for (s = 1; s < n; s <<= 1) {
      step = n / s;
      for (i = 0; i < n; i += s << 1) {
        for (j = i, k = 0; j < i + s; j++, k += step) {
          l = j + s;
          tmp = re[l] * trig_tables[k] + dir * im[l] * trig_tables[k + 1];
          tmp2 = im[l] * trig_tables[k] - dir * re[l] * trig_tables[k + 1];
          re[l] = re[j] - tmp; im[l] = im[j] - tmp2;
          re[j] += tmp; im[j] += tmp2;
        }
      }
    }
    // Scaling for forward transform
    if (dir == -1) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
  }
}

function fft2 (dir, x, y) {
  for (var i = 0; i < size; i++) fft(dir, x.subarray(i*size, (i + 1)*size), y.subarray(i*size, (i + 1)*size));
  for (var i = 0, j, tmp; i < size; i++) for (j = 0; j < i; j++) {
    tmp = x[i*size + j]; x[i*size + j] = x[j*size + i]; x[j*size + i] = tmp;
    tmp = y[i*size + j]; y[i*size + j] = y[j*size + i]; y[j*size + i] = tmp
  }
  for (i = 0; i < size; i++) fft(dir, x.subarray(i*size, (i + 1)*size), y.subarray(i*size, (i + 1)*size));
}

function doSpray () {
  for (var i = 0, cur_field = fields[0]; i < size * size * spray / radius / radius; i++) {
    var u = Math.floor(Math.random() * size),
        v = Math.floor(Math.random() * size), x, y;
    for (x = 0; x < radius; x++) for (y = 0; y < radius; y++) {
      cur_field[((u + x) % size)*size + (v + y) % size] = 1
    }
  }
}

function loopInit () {
  video = new Whammy.Video(fps, .99);
  fields = [zeroArray(size), zeroArray(size)];
  current_field = 0;
  var imaginary_field = zeroArray(size);
  var M_re_buffer = zeroArray(size);
  var M_im_buffer = zeroArray(size);
  var N_re_buffer = zeroArray(size);
  var N_im_buffer = zeroArray(size);

  function lerp (a, b, t) { return (1 - t) * a + t * b }

  function field_multiply (a_r, a_i, b_r, b_i, c_r, c_i) {
    var a, b, c, d, t, i, j;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
      a = a_r[i*size + j]; b = a_i[i*size + j];
      c = b_r[i*size + j]; d = b_i[i*size + j];
      t = a * (c + d);
      c_r[i*size + j] = t - d * (a + b);
      c_i[i*size + j] = t + c * (b - a);
    }
  }

  function S (n, m) {
    function sigmoid (x, a, alpha) { return 1 / (1 + Math.exp(-4 / alpha * (x - a))) }
    function sigmoid2 (x, a, b) { return sigmoid(x, a, transitionFuzz) * (1 - sigmoid(x, b, transitionFuzz)) }
    var alive = sigmoid(m, 0.5, existenceFuzz);
    return sigmoid2(n, lerp(birthStart, deathStart, alive), lerp(birthEnd, deathEnd, alive));
  }

  doSpray();

  return function () {
    //Read in fields
    cur_field = fields[current_field];
    if (cur_field.length != size*size) return false;
    var next_field = fields[current_field = 1 - current_field], i, j, k, s,
        keep = cur_field.slice();
    imaginary_field = zeroArray(size);
    //Compute m,n fields
    fft2(1, cur_field, imaginary_field);
    field_multiply(cur_field, imaginary_field, M_re, M_im, M_re_buffer, M_im_buffer);
    fft2(-1, M_re_buffer, M_im_buffer);
    field_multiply(cur_field, imaginary_field, N_re, N_im, N_re_buffer, N_im_buffer);
    fft2(-1, N_re_buffer, N_im_buffer);

    //Step s
    for (i = 0; i < size; i++) for (j = 0; j < size; j++)
      next_field[i*size + j] = lerp(keep[i*size + j], S(N_re_buffer[i*size + j], M_re_buffer[i*size + j]), speed);

    //Extract image data
    var imageData = context.createImageData(size, size), buf = new ArrayBuffer(imageData.data.length),
        buf8 = new Uint8ClampedArray(buf), data = new Uint32Array(buf),
        ptr = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++)
      data[ptr++] = Math.max(0, Math.min(255, Math.floor(256 * next_field[i*size + j]))) * 65793 - 16777216;
    imageData.data.set(buf8);
    context.putImageData(imageData, 0, 0);
    if (recording) {
      video.add(canvas);
      let f = video.frames.length, x = Math.floor(f/fps) + ":" + f % fps;
      $("#view")[0].innerText = $("#view")[0].innerText.replace(/(^\S+\s\S+).*/, "$1 (" + x + ")")
    }

    pause || requestAnimationFrame(loop)
  }
}

$.addEvents({
  "": {
    load: function () {
      refreshCanvas().then(() => (loop = loopInit())());
      ["birthStart", "birthEnd", "deathStart", "deathEnd", "transitionFuzz", "existenceFuzz"]
        .forEach(t => $("#" + t + " + label")[0].innerText = window[t]);
      $("#slider > input")[0].value = window[$("#lifeSettings > input:checked")[0].id];
      $("#radius-val")[0].innerText = $("#radius-input")[0].value = radius;
      $("#spray-val")[0].innerText = $("#spray-input")[0].value = spray;
      $("#neighbourhood-val")[0].innerText = $("#neighbourhood-input")[0].value = neighbourhood;
      $("#speed-val")[0].innerText = $("#speed-input")[0].value = speed;
      $("#fps-val")[0].innerText = $("#fps-input")[0].value = fps;
      if (document.createElement("canvas").toDataURL("image/webp").slice(11, 15) != "webp") $("#video")[0].classList.add("disable");
    },
    resize: function (e) {
      e.stopPropagation();
      if (!pause) {
        refreshCanvas();
        resetLoop()
      }
    },
    click: function (e) { if (["BODY", "CANVAS"].indexOf(e.target.nodeName) != -1) $("#ui")[0].classList.remove("active") }
  },
  "#settings": { click: function () { $("#ui")[0].classList.add("active") } },
  "#slider > input": {
    "input change": function (e) {
      e.stopPropagation();
      var timeout;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        let checked = $("#lifeSettings > input:checked")[0];
        checked.nextSibling.innerText = window[checked.id] = local.setItem(checked.id, parseFloat(e.target.value));
        resetLoop()
      }, 100)
    }
  },
  "#lifeSettings > label": { click: function () { $("#slider > input")[0].focus() } },
  "#lifeSettings > input": {
    change: function () {
      $("#slider > input")[0].value = window[this.id]
    }
  },
  "#spray > :first-child": { click: doSpray },
  "#radius-val, #neighbourhood-val, #spray-val, #speed-val, #fps-val": {
    click: function () {
      this.parentNode.classList.add("edit");
      $("input", this.parentNode)[0].focus()
    }
  },
  "#radius-input, #neighbourhood-input, #spray-input, #speed-input, #fps-input": {
    keypress: function (e) {
      var which = this.id.split("-")[0], v = {radius: parseInt, neighbourhood: parseFloat, spray: parseFloat, speed: parseFloat, fps: parseInt}[which](this.value);
      if (e.key == "Enter" && !isNaN(v) && v > 0) {
        this.value = this.previousSibling.innerText = window[which] = local.setItem(which, v);
        this.parentNode.classList.remove("edit");
        refreshCanvas(true);
        resetLoop()
      } else if (e.key == "Escape") cancelEdit.bind(this)()
    },
    blur: function () { cancelEdit.bind(this)() }
  },
  "#pause": {
    click: function () {
      if (pause = !pause) this.innerText = "Resume"
      else {
        this.innerText = "Pause";
        requestAnimationFrame(loop)
      }
    }
  },
  "#mag-plus, #mag-minus": {
    click: function () {
      switch (this.id.split("-")[1]) {
        case "plus": if (size > 4) magnification = local.setItem("magnification", ++magnification); else return;
        break;
        case "minus": if (magnification >= 0) magnification = local.setItem("magnification", --magnification); else return;
      }
      refreshCanvas();
      resetLoop()
    }
  },
  "[id$=recording]": {
    click: function () {
      switch (this.id.split("-")[0]) {
        case "start": this.parentNode.classList.add("record");
        video = new Whammy.Video(fps, .99);
        video.add(canvas);
        recording = true
        break;
        case "stop": this.parentNode.classList.remove("record");
        recording = false
      }
    }
  },
  "#view": {
    click: function () {
      switch (this.innerText.match(/\S+\s\S+/)[0]) {
        case "View video":
        this.innerText = "View canvas";
        $("#content")[0].classList.add("video");
        let progress = $("progress")[0];
        progress.max = video.frames.length;
        video.compile(false, frame => progress.value = frame, output => {
          $("#content")[0].classList.add("loaded");
          $("video")[0].src = URL.createObjectURL(output)
        })
        break;
        case "View canvas":
        this.innerText = "View video";
        $("#content")[0].classList.remove("video", "loaded");
        video = new Whammy.Video(fps, .99);
      }
    }
  }
})
