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

function zeroArray (s) { return new Array(s).fill(0).map(() => new Array(s).fill(0)) }
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
    renderer = local.setItem("renderer", setDefault("renderer", "Canvas"));
var canvas = $("canvas")[0], context = canvas.getContext(renderer == "Canvas" ? "2d" : "webgl"),
    recording = false, video, loop, pause = true, size, logRes,
    fields, current_field, M_re, M_im, N_re, N_im;

function refreshCanvas (update) {
  var vw = document.body.clientWidth, vh = document.body.clientHeight, prev = size;
  canvas.width = canvas.height = size = Math.pow(2, Math.floor(Math.log2(vw > vh ? vh : vw)) - magnification);
  if (renderer == "WebGL") return false;
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
        field[i][j] = v
      }

      var imag_field = zeroArray(size);
      fft2(1, field, imag_field);
      return { re: field, im: imag_field, w: weight };
    }

    logRes = Math.log2(size);

    var innerBessel = BesselJ(radius);
    var outerBessel = BesselJ(radius * neighbourhood);

    var innerWeight = 1 / innerBessel.w;
    var outerWeight = 1 / (outerBessel.w - innerBessel.w);

    M_re = innerBessel.re;
    M_im = innerBessel.im;
    N_re = outerBessel.re;
    N_im = outerBessel.im;

    for (var i = 0; i < size; i++) for (var j = 0; j < size; j++) {
      N_re[i][j] = outerWeight * (N_re[i][j] - M_re[i][j]);
      N_im[i][j] = outerWeight * (N_im[i][j] - M_im[i][j]);
      M_re[i][j] *= innerWeight;
      M_im[i][j] *= innerWeight
    }
  }
}

//FFT
function fft (dir, x, y) {
  var nn, i, i1, j, k, i2, l, l1, l2,
      c1, c2, u1, u2, tmp, tmp2;

  // Calculate the number of points
  nn = x.length;

  // Do the bit reversal
  i2 = nn >> 1;
  j = 0;
  for (i = 0; i < nn - 1; i++) {
    if (i < j) {
      tmp = x[i]; x[i] = x[j]; x[j] = tmp;
      tmp = y[i]; y[i] = y[j]; y[j] = tmp;
    }
    k = i2;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Compute the FFT
  c1 = -1; c2 = 0; l2 = 1;
  for (l = 0; l < logRes; l++) {
    l1 = l2; l2 <<= 1; u1 = 1; u2 = 0;
    for (j = 0; j < l1; j++) {
      for (i = j; i < nn; i += l2) {
        i1 = i + l1;
        tmp = u1 * x[i1] - u2 * y[i1];
        tmp2 = u1 * y[i1] + u2 * x[i1];
        x[i1] = x[i] - tmp;
        y[i1] = y[i] - tmp2;
        x[i] += tmp;
        y[i] += tmp2;
      }
      tmp = u1 * c1 - u2 * c2;
      u2 = u1 * c2 + u2 * c1;
      u1 = tmp
    }
    c2 = Math.sqrt((1 - c1) / 2);
    if (dir == 1) c2 = -c2;
    c1 = Math.sqrt((1 + c1) / 2)
  }

  // Scaling for forward transform
  if (dir == -1) {
    var scale_f = 1 / nn;
    for (i = 0; i < nn; i++) {
      x[i] *= scale_f;
      y[i] *= scale_f
    }
  }
}

function fft2 (dir, x, y) {
  for (var i = 0, j, tmp; i < size; i++) fft(dir, x[i], y[i]);
  for (i = 0; i < size; i++) for (j = 0; j < i; j++) {
    tmp = x[i][j]; x[i][j] = x[j][i]; x[j][i] = tmp;
    tmp = y[i][j]; y[i][j] = y[j][i]; y[j][i] = tmp
  }
  for (i = 0; i < size; i++) fft(dir, x[i], y[i])
}

function doSpray () {
  for (var i = 0, cur_field = fields[0]; i < size * size * spray / radius / radius; i++) {
    var u = Math.floor(Math.random() * size),
        v = Math.floor(Math.random() * size), x, y;
    for (x = 0; x < radius; x++) for (y = 0; y < radius; y++) {
      cur_field[(u + x) % size][(v + y) % size] = 1
    }
  }
}

function loopInit () {
  video = new Whammy.Video(fps, .99);
  if (renderer == "WebGL") return () => {};
  fields = [zeroArray(size), zeroArray(size)];
  current_field = 0;
  var imaginary_field = zeroArray(size);
  var M_re_buffer = zeroArray(size);
  var M_im_buffer = zeroArray(size);
  var N_re_buffer = zeroArray(size);
  var N_im_buffer = zeroArray(size);

  function lerp (a, b, t) { return (1 - t) * a + t * b }

  function field_multiply (a_r, a_i, b_r, b_i, c_r, c_i) {
    var Ar, Ai, Br, Bi, Cr, Ci, a, b, c, d, t, i, j;
    for (i = 0; i < size; i++) {
      Ar = a_r[i]; Ai = a_i[i];
      Br = b_r[i]; Bi = b_i[i];
      Cr = c_r[i]; Ci = c_i[i];
      for (j = 0; j < size; j++) {
        a = Ar[j]; b = Ai[j];
        c = Br[j]; d = Bi[j];
        t = a * (c + d);
        Cr[j] = t - d * (a + b);
        Ci[j] = t + c * (b - a);
      }
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
    if (cur_field.length != size) return false;
    var next_field = fields[current_field = 1 - current_field], i, j, k, s,
        keep = cur_field.map(i => i.slice());
    imaginary_field = zeroArray(size);
    //imaginary_field.forEach(i => i.fill(0));
    //Compute m,n fields
    fft2(1, cur_field, imaginary_field);
    field_multiply(cur_field, imaginary_field, M_re, M_im, M_re_buffer, M_im_buffer);
    fft2(-1, M_re_buffer, M_im_buffer);
    field_multiply(cur_field, imaginary_field, N_re, N_im, N_re_buffer, N_im_buffer);
    fft2(-1, N_re_buffer, N_im_buffer);

    //Step s
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) next_field[i][j] = lerp(keep[i][j], S(N_re_buffer[i][j], M_re_buffer[i][j]), speed);

    //Extract image data
    var imageData = context.createImageData(size, size), buf = new ArrayBuffer(imageData.data.length),
        buf8 = new Uint8ClampedArray(buf), data = new Uint32Array(buf), ptr = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
      data[ptr++] = Math.max(0, Math.min(255, Math.floor(256 * next_field[i][j]))) * 65793 - 16777216
    }
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
      refreshCanvas();
      ["birthStart", "birthEnd", "deathStart", "deathEnd", "transitionFuzz", "existenceFuzz"]
        .forEach(t => $("#" + t + " + label")[0].innerText = window[t]);
      $("#slider > input")[0].value = window[$("#lifeSettings > input:checked")[0].id];
      $("#radius-val")[0].innerText  = $("#radius-input")[0].value = radius;
      $("#spray-val")[0].innerText = $("#spray-input")[0].value = spray;
      $("#neighbourhood-val")[0].innerText = $("#neighbourhood-input")[0].value = neighbourhood;
      $("#speed-val")[0].innerText = $("#speed-input")[0].value = speed;
      $("#fps-val")[0].innerText = $("#fps-input")[0].value = fps;
      if (document.createElement("canvas").toDataURL("image/webp").slice(11, 15) != "webp") $("#video")[0].classList.add("disable");
      $("#renderer")[0].innerText = renderer == "Canvas" ? "Canvas rendering" : "WebGL rendering";
      glInit();
      (loop = loopInit())()
    },
    resize: function (e) {
      e.stopPropagation();
      if (!pause) {
        if (renderer == "WebGL") return false;
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
        if (renderer == "Canvas") requestAnimationFrame(loop)
      }
    }
  },
  "#mag-plus, #mag-minus": {
    click: function () {
      switch (this.id.split("-")[1]) {
        case "plus": if (logRes > 2) magnification = local.setItem("magnification", ++magnification); else return;
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
  },
  "#renderer": {
    click: function () {
      switch (r = this.innerText.match(/^\S+/)[0]) {
        case "Canvas":
        renderer = local.setItem("renderer", "WebGL");
        this.innerText = "WebGL rendering";
        $("#content")[0].replaceChild(document.createElement("canvas"), canvas);
        (canvas = $("canvas")[0]).height = canvas.width = size;
        context = canvas.getContext("webgl");
        break;

        case "WebGL":
        renderer = local.setItem("renderer", "Canvas");
        this.innerText = "Canvas rendering";
        $("#content")[0].replaceChild(document.createElement("canvas"), canvas);
        (canvas = $("canvas")[0]).height = canvas.width = size;
        context = canvas.getContext("2d");
        refreshCanvas(true);
        (loop = loopInit())()
      }
    }
  }
})
