/* Handled demo-site remodel preview. Loaded only when the section scrolls near.
   Free and keyless: the visitor's browser calls public Hugging Face Spaces directly,
   so each visitor uses their own free quota (about 2 previews per connection). */
(function(){
  var ENGINES = [
    {base:"https://black-forest-labs-flux-1-kontext-dev.hf.space", fn:2, data:function(f,p){return [f,p,0,true,2.5,28];}},
    {base:"https://qwen-qwen-image-edit.hf.space", fn:2, data:function(f,p){return [f,p,0,true,4,30,false];}}
  ];
  var root = document.querySelector(".rp"); if (!root || root.dataset.ready) return; root.dataset.ready = "1";
  var cfg = JSON.parse(root.getAttribute("data-rp"));
  var q = function(s){return root.querySelector(s);};
  var photo = null, beforeURL = null, timer = null, scene = cfg.scenes[0];

  function chips(box, items, onPick){
    box.innerHTML = "";
    items.forEach(function(it, i){
      var b = document.createElement("button"); b.type = "button"; b.className = "rp-chip"; b.textContent = it.label;
      b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.addEventListener("click", function(){
        box.querySelectorAll(".rp-chip").forEach(function(c){c.setAttribute("aria-pressed", c === b ? "true" : "false");});
        if (onPick) onPick(it);
      });
      box.appendChild(b);
    });
  }
  function picked(box){ var i = [].indexOf.call(box.children, box.querySelector('[aria-pressed="true"]')); return i < 0 ? 0 : i; }
  function showScene(s){
    scene = s; chips(q(".rp-looks"), s.looks);
    var sb = q(".rp-sample"); sb.hidden = !s.sample;
  }
  if (cfg.scenes.length > 1) chips(q(".rp-scenes"), cfg.scenes, showScene); else q(".rp-scenes-wrap").hidden = true;
  showScene(cfg.scenes[0]);

  function prep(blob){
    return new Promise(function(ok, bad){
      var img = new Image();
      img.onload = function(){
        var s = Math.min(1, 1024 / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function(b){ b ? ok({blob:b, w:c.width, h:c.height}) : bad(new Error("prep")); }, "image/jpeg", 0.9);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = function(){ bad(new Error("That file isn't a photo we can read. Try a JPG or PNG.")); };
      img.src = URL.createObjectURL(blob);
    });
  }
  function setPhoto(blob){
    msg("");
    return prep(blob).then(function(p){
      photo = p;
      if (beforeURL) URL.revokeObjectURL(beforeURL);
      beforeURL = URL.createObjectURL(p.blob);
      q(".rp-thumb").src = beforeURL; q(".rp-drop").classList.add("has");
    }).catch(function(e){ msg(e.message); });
  }
  var drop = q(".rp-drop");
  q(".rp-file").addEventListener("change", function(){ if (this.files[0]) setPhoto(this.files[0]); });
  ["dragenter","dragover"].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add("over");});});
  ["dragleave","drop"].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove("over");});});
  drop.addEventListener("drop", function(e){ var f = e.dataTransfer.files[0]; if (f) setPhoto(f); });
  q(".rp-sample").addEventListener("click", function(){
    fetch(cfg.img + scene.sample + ".jpg").then(function(r){return r.blob();}).then(setPhoto);
  });

  function msg(t){ var m = q(".rp-msg"); m.textContent = t; m.hidden = !t; }
  function busy(on, text){
    q(".rp-busy").hidden = !on;
    if (text) q(".rp-busytext").textContent = text;
    clearInterval(timer);
    if (on){
      var t0 = Date.now(), bar = q(".rp-bar i"); bar.style.width = "0";
      timer = setInterval(function(){ bar.style.width = Math.min(95, (Date.now()-t0)/400) + "%"; }, 500);
    }
  }
  function prompt(){
    var look = scene.looks[picked(q(".rp-looks"))];
    return "Edit this photo of a " + scene.noun + ": " + look.edit + ". Keep the exact same layout, " +
      (scene.outside ? "house, walls, fences" : "walls, windows, doorways") +
      ", camera angle and perspective, and change nothing else. Photorealistic photo, natural light.";
  }
  function quota(t){ return /quota|exceeded|ZeroGPU|GPU duration|rate limit|too many/i.test(t || ""); }

  // Gradio queue API: unlike /call, it reports the real error (e.g. the free quota).
  async function run(engine, p){
    var api = engine.base + "/gradio_api";
    var fd = new FormData(); fd.append("files", photo.blob, "photo.jpg");
    var up = await fetch(api + "/upload", {method:"POST", body:fd});
    if (!up.ok) throw new Error("upload " + up.status);
    var path = (await up.json())[0];
    var file = {path:path, meta:{_type:"gradio.FileData"}};
    var sh = Math.random().toString(36).slice(2);
    var join = await fetch(api + "/queue/join", {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({data:engine.data(file, p), fn_index:engine.fn, session_hash:sh, event_data:null, trigger_id:null})});
    if (!join.ok) throw new Error("join " + join.status);
    var text = await (await fetch(api + "/queue/data?session_hash=" + sh)).text();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++){
      if (lines[i].indexOf("data: ") !== 0) continue;
      var m; try { m = JSON.parse(lines[i].slice(6)); } catch (e) { continue; }
      if (m.msg !== "process_completed") continue;
      if (!m.success){ var err = new Error((m.output && m.output.error) || m.title || "failed"); err.quota = quota(err.message + " " + (m.title || "")); throw err; }
      var out = m.output.data[0];
      if (Array.isArray(out)) out = out[0];
      if (out && out.image) out = out.image;
      var url = out && (out.url || (out.path && api + "/file=" + out.path));
      if (url) return url;
    }
    throw new Error("no result");
  }

  q(".rp-go").addEventListener("click", async function(){
    msg("");
    if (!photo){ msg(scene.sample ? "Add a photo first, or try our sample." : "Add a photo first."); return; }
    var p = prompt(), go = this, url = null, sawQuota = false;
    go.disabled = true; q(".rp-empty").hidden = true; q(".rp-actions").hidden = true;
    busy(true, "Working on it… about 30 seconds");
    for (var i = 0; i < ENGINES.length && !url; i++){
      try { url = await run(ENGINES[i], p); }
      catch (e){
        if (e.quota){ sawQuota = true; break; }
        if (i + 1 < ENGINES.length) busy(true, "Busy right now, trying again… about a minute");
      }
    }
    busy(false); go.disabled = false;
    if (!url){
      if (!q(".rp-ba").classList.contains("on")) q(".rp-empty").hidden = false;
      msg(sawQuota
        ? "You've used the free previews on this connection for now. They refill over the day. Try again later, or just text us your photo."
        : "The preview service is busy right now. Give it a minute and try again, or just text us your photo.");
      return;
    }
    var blob = await (await fetch(url)).blob();
    var afterURL = URL.createObjectURL(blob);
    q(".rp-before").src = beforeURL; q(".rp-after").src = afterURL;
    q(".rp-stage").style.aspectRatio = photo.w + "/" + photo.h;
    var ba = q(".rp-ba"); ba.classList.add("on"); ba.style.setProperty("--x", "50%");
    q(".rp-dl").href = afterURL; q(".rp-actions").hidden = false;
    if (window.innerWidth < 900) q(".rp-stage").scrollIntoView({behavior:"smooth", block:"center"});
  });

  var ba = q(".rp-ba"), dragging = false;
  function slide(e){ var r = ba.getBoundingClientRect(); var x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); ba.style.setProperty("--x", (x*100) + "%"); }
  ba.addEventListener("pointerdown", function(e){ dragging = true; ba.setPointerCapture(e.pointerId); slide(e); });
  ba.addEventListener("pointermove", function(e){ if (dragging) slide(e); });
  ba.addEventListener("pointerup", function(){ dragging = false; });
})();
