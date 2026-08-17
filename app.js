// ============================================================
// Cadáver Exquisito — lógica de la app
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDcs-9-me-ajmL81LWoMCShPXbYevPzjtY",
  authDomain: "cadaverexquisito-6eab2.firebaseapp.com",
  projectId: "cadaverexquisito-6eab2",
  storageBucket: "cadaverexquisito-6eab2.firebasestorage.app",
  messagingSenderId: "781922012454",
  appId: "1:781922012454:web:fe14af77a8646e5bd585e7",
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, query, where, orderBy, limit,
  doc, onSnapshot, runTransaction, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const corpsesRef = collection(db, "corpses");
const emailsRef = collection(db, "emails"); // Nueva colección para emails

const TOTAL_SEGMENTS = 2;
const SEG_WIDTH = 700;
const SEG_HEIGHT = 350; 
const GUIDE_HEIGHT = 80;

// URL de implementación ("/exec") del Google Apps Script que manda el mail
// de "cadáver completado". Reemplazá esto por la tuya después de publicar
// el script (Implementar > Nueva implementación > Aplicación web).
const MAIL_ENDPOINT = "https://script.google.com/macros/s/AKfycbz-N3NGkyKHPvF4a476W4dAH6CFL442LRJHynUj8p-SmuTHdkNSQ9_ro0PsuqV7DYA3pA/exec";

async function sendCompletionEmail(to) {
  console.log("Intentando enviar correo a:", to);

  const res = await fetch(MAIL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      to: to,
      subject: "¡Tu cadáver exquisito se completó!",
      message:
        "El cadáver exquisito en el que participaste ya se ha completado. " +
        "¡Ya puedes pasar a verlo por la galería!"
    })
  });

  console.log("Respuesta HTTP de Apps Script:", res.status);

  const text = await res.text();

  console.log("Respuesta de Apps Script:", text);

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Apps Script no devolvió JSON válido. Respuesta: " + text
    );
  }

  if (!data.ok) {
    throw new Error(
      data.error || "Google Apps Script rechazó el envío."
    );
  }

  return true;
}

async function notifyParticipants(corpseId) {

  console.log(
    "📧 Buscando participantes del cadáver:",
    corpseId
  );

  try {

    const qEmails = query(
      emailsRef,
      where("corpseId", "==", corpseId)
    );

    const emailSnap = await getDocs(qEmails);

    console.log(
      "📧 Emails encontrados:",
      emailSnap.size
    );

    if (emailSnap.empty) {

      console.log(
        "No hay emails registrados para este cadáver."
      );

      return;
    }

    const results = await Promise.allSettled(

      emailSnap.docs.map(
        async (docEmail) => {

          const dataEmail =
            docEmail.data();

          console.log(
            "📨 Intentando enviar a:",
            dataEmail.email
          );

          await sendCompletionEmail(
            dataEmail.email
          );

          console.log(
            "✅ Enviado:",
            dataEmail.email
          );

        }
      )

    );

    results.forEach((result) => {

      if (result.status === "rejected") {

        console.error(
          "❌ Falló un correo:",
          result.reason
        );

      }

    });

  } catch (error) {

    console.error(
      "❌ Error buscando emails:",
      error
    );

  }

}
// ---------------- estado ----------------
let activeCorpseId = null;
let unsubscribe = null;
let strokes = [];
let isDrawing = false;
let lastPoint = null;
let smoothPoint = null;
let currentTurnIdx = 0;

// ---------------- elementos de UI ----------------
const ui = {
    stateDrawing: document.getElementById("state-drawing"),
    stateEmail: document.getElementById("state-email"),
    stateParticipated: document.getElementById("state-participated"),
    emailInput: document.getElementById("user-email"),
    submitEmailBtn: document.getElementById("submit-email-btn"),
    skipEmailBtn: document.getElementById("skip-email-btn")
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  progressCount: document.getElementById("progress-count"),
  progressFill: document.getElementById("progress-fill"),
  canvasWrap: document.getElementById("canvas-wrap"),
  guideCanvas: document.getElementById("guide-canvas"),
  drawCanvas: document.getElementById("draw-canvas"),
  dashedLine: document.querySelector(".paper-dashed-line"),
  colorPicker: document.getElementById("color-picker"),
  brushSize: document.getElementById("brush-size"),
  undoBtn: document.getElementById("undo-btn"),
  clearBtn: document.getElementById("clear-btn"),
  submitBtn: document.getElementById("submit-btn"),
  statusMessage: document.getElementById("status-message"),
  galleryGrid: document.getElementById("gallery-grid"),
  modal: document.getElementById("reveal-modal"),
  modalImage: document.getElementById("modal-image"),
  modalCaption: document.getElementById("modal-caption"),
  modalClose: document.getElementById("modal-close"),
};

const guideCtx = els.guideCanvas.getContext("2d");
const drawCtx = els.drawCanvas.getContext("2d");
drawCtx.lineCap = "round";
drawCtx.lineJoin = "round";

const intro = {
  experience: document.querySelector(".experience"),
  paper: document.getElementById("paper"),
};

// ---------------- navegación de vistas ----------------
els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));

function switchView(view) {
  els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  els.views.forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  if (view === "gallery") loadGallery();
}

els.modalClose.addEventListener("click", () => els.modal.classList.add("hidden"));
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) els.modal.classList.add("hidden"); });

// ---------------- Gestión de participación ----------------
function getContributed() {
  try { return JSON.parse(localStorage.getItem("cadaver_contribuciones") || "[]"); }
  catch { return []; }
}
function markContributed(id) {
  const list = getContributed();
  list.push(id);
  localStorage.setItem("cadaver_contribuciones", JSON.stringify(list.slice(-50)));
}
function hasContributed(id) {
  return getContributed().includes(id);
}

// Cambiar entre los estados centrales
function showState(stateName) {
    ui.stateDrawing.classList.add("hidden-element");
    ui.stateEmail.classList.add("hidden-element");
    ui.stateParticipated.classList.add("hidden-element");

    if (stateName === "drawing") ui.stateDrawing.classList.remove("hidden-element");
    if (stateName === "email") ui.stateEmail.classList.remove("hidden-element");
    if (stateName === "participated") ui.stateParticipated.classList.remove("hidden-element");
}

// ---------------- arranque ----------------
init();

async function init() {
  els.drawCanvas.width = SEG_WIDTH;
  els.drawCanvas.height = SEG_HEIGHT;
  els.guideCanvas.width = SEG_WIDTH;
  els.guideCanvas.height = GUIDE_HEIGHT;

  try {
    await connectToActiveCorpse();
  } catch (err) {
    console.error(err);
    showStatus("No se pudo conectar con la base de datos.", "error");
  }
}

async function connectToActiveCorpse() {
  const q = query(corpsesRef, where("status", "==", "in_progress"), orderBy("createdAt", "asc"), limit(1));
  const snap = await getDocs(q);

  let corpseId;
  if (snap.empty) {
    const newDoc = await addDoc(corpsesRef, {
      segments: Array(TOTAL_SEGMENTS).fill(null),
      segmentBottoms: Array(TOTAL_SEGMENTS).fill(null),
      count: 0,
      status: "in_progress",
      createdAt: serverTimestamp(),
    });
    corpseId = newDoc.id;
  } else {
    corpseId = snap.docs[0].id;
  }
  listenToCorpse(corpseId);
}

function listenToCorpse(corpseId) {
  activeCorpseId = corpseId;
  if (unsubscribe) unsubscribe();
  const ref = doc(db, "corpses", corpseId);

  unsubscribe = onSnapshot(ref, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();
    if(els.progressCount) els.progressCount.textContent = `${data.count}/${TOTAL_SEGMENTS}`;
    if(els.progressFill) els.progressFill.style.width = `${(data.count / TOTAL_SEGMENTS) * 100}%`;

    if (data.status === "completed") {
      setTimeout(() => connectToActiveCorpse(), 1000);
      return;
    }

    // SI YA PARTICIPÓ en este cadáver específico -> Muestra Estado 3
    if (hasContributed(corpseId)) {
      showState("participated");
      return;
    }

    // SI AÚN NO HA PARTICIPADO -> Muestra Impresora y Papel
    showState("drawing");
    // Evita re-dibujar (y borrar el trazo en curso) si Firestore vuelve a
    // emitir el mismo snapshot para el mismo turno del mismo cadáver.
    if (activeCorpseId !== lastSetupCorpseId || data.count !== lastSetupCount) {
      setupGuide(data);
      lastSetupCorpseId = activeCorpseId;
      lastSetupCount = data.count;
      setTimeout(startIntroAnimation, 100);
    }
  });
}

let lastSetupCorpseId = null;
let lastSetupCount = null;

function setupGuide(data) {
  const idx = data.count;
  currentTurnIdx = idx;

  if (idx === 0) {
    els.canvasWrap.classList.add("first-piece");
    if (els.dashedLine) els.dashedLine.style.display = "none";
  } else {
    els.canvasWrap.classList.remove("first-piece");
    if (els.dashedLine) els.dashedLine.style.display = "block";

    guideCtx.clearRect(0, 0, SEG_WIDTH, GUIDE_HEIGHT);
    const prevSrc = data.segments[idx - 1];
    if (!prevSrc) {
      console.warn("No hay imagen previa guardada para el segmento", idx - 1);
    } else {
      // Hasta dónde llegó realmente el trazo del dibujo anterior. Si el
      // documento es viejo y no tiene este dato guardado, asumimos que
      // llegó hasta el final de la hoja (comportamiento previo).
      const prevBottomRaw = data.segmentBottoms?.[idx - 1];
      const prevBottom = (typeof prevBottomRaw === "number" && prevBottomRaw > 0)
        ? prevBottomRaw
        : SEG_HEIGHT;
      const sy = Math.max(0, prevBottom - GUIDE_HEIGHT);

      const prevImg = new Image();
      prevImg.onload = () => {
        guideCtx.clearRect(0, 0, SEG_WIDTH, GUIDE_HEIGHT);
        guideCtx.drawImage(
          prevImg,
          0, sy, SEG_WIDTH, GUIDE_HEIGHT,
          0, 0, SEG_WIDTH, GUIDE_HEIGHT
        );
      };
      prevImg.onerror = (e) => {
        console.error("No se pudo cargar la imagen guía del segmento anterior.", e);
      };
      prevImg.src = prevSrc;
    }
  }

  clearDrawCanvas();
  enableCanvas();
}

function clearDrawCanvas() {
  drawCtx.clearRect(0, 0, SEG_WIDTH, SEG_HEIGHT);
  strokes = [drawCtx.getImageData(0, 0, SEG_WIDTH, SEG_HEIGHT)];
}

function enableCanvas() {
  els.drawCanvas.style.pointerEvents = "auto";
  els.submitBtn.disabled = false;
}
function disableCanvas() {
  els.drawCanvas.style.pointerEvents = "none";
  els.submitBtn.disabled = true;
}

// ---------------- Lógica de Dibujo ----------------
els.drawCanvas.addEventListener("pointerdown", (e) => {
  const pos = getPos(e);

  if (currentTurnIdx > 0 && pos.y <= GUIDE_HEIGHT) return;

  isDrawing = true;
  lastPoint = pos;
  smoothPoint = pos;

  const size = parseFloat(
    els.brushSize?.value || 4
  );

  drawCtx.fillStyle = els.colorPicker
    ? els.colorPicker.value
    : "#000000";

  // Punto inicial completamente circular
  drawCtx.beginPath();
  drawCtx.arc(
    pos.x,
    pos.y,
    size / 2,
    0,
    Math.PI * 2
  );
  drawCtx.fill();

  saveSnapshot();
});

els.drawCanvas.addEventListener("pointermove", (e) => {
  if (!isDrawing) return;

  const pos = getPos(e);

  if (currentTurnIdx > 0 && pos.y <= GUIDE_HEIGHT) {
    lastPoint = null;
    smoothPoint = null;
    return;
  }

  if (!lastPoint) {
    lastPoint = pos;
    smoothPoint = pos;
    return;
  }

  // Suavizado
  const smoothing = 0.35;

  smoothPoint.x += (pos.x - smoothPoint.x) * smoothing;
  smoothPoint.y += (pos.y - smoothPoint.y) * smoothing;

  const size = parseFloat(
    els.brushSize?.value || 4
  );

  const color = els.colorPicker
    ? els.colorPicker.value
    : "#000000";

  drawCtx.strokeStyle = color;
  drawCtx.fillStyle = color;

  drawCtx.lineWidth = size;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";

  /*
   * Trazo principal
   */
  drawCtx.beginPath();

  drawCtx.moveTo(
    lastPoint.x,
    lastPoint.y
  );

  const midX =
    (lastPoint.x + smoothPoint.x) / 2;

  const midY =
    (lastPoint.y + smoothPoint.y) / 2;

  drawCtx.quadraticCurveTo(
    lastPoint.x,
    lastPoint.y,
    midX,
    midY
  );

  drawCtx.stroke();

  /*
   * Punto circular en el extremo.
   * Esto garantiza que el pincel tenga
   * terminación completamente redonda.
   */
  drawCtx.beginPath();

  drawCtx.arc(
    smoothPoint.x,
    smoothPoint.y,
    size / 2,
    0,
    Math.PI * 2
  );

  drawCtx.fill();

  lastPoint = {
    x: smoothPoint.x,
    y: smoothPoint.y
  };
});
window.addEventListener("pointerup", () => {
  isDrawing = false;
  lastPoint = null;
  smoothPoint = null;
});

function getPos(e) {
  const rect = els.drawCanvas.getBoundingClientRect();
  const scaleX = els.drawCanvas.width / rect.width;
  const scaleY = els.drawCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function saveSnapshot() {
  strokes.push(drawCtx.getImageData(0, 0, SEG_WIDTH, SEG_HEIGHT));
  if (strokes.length > 30) strokes.shift();
}

// Recorre el canvas de abajo hacia arriba y devuelve la fila (y) más baja
// que tiene tinta. Así, si alguien no dibuja hasta el final de la hoja,
// la guía para la siguiente persona se recorta desde donde el dibujo
// realmente termina, en vez de mostrar una franja vacía.
function getContentBottom(ctx, width, height) {
  const ALPHA_THRESHOLD = 10; // ignora ruido de antialiasing casi invisible
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) {
        return Math.min(height, y + 1);
      }
    }
  }
  return GUIDE_HEIGHT; // no se detectó tinta (no debería pasar al enviar)
}

els.undoBtn.addEventListener("click", () => {
  if (strokes.length <= 1) return;
  strokes.pop();
  drawCtx.putImageData(strokes[strokes.length - 1], 0, 0);
});
els.clearBtn.addEventListener("click", clearDrawCanvas);

// ---------------- Envío del Segmento ----------------
els.submitBtn.addEventListener("click", submitSegment);

async function submitSegment() {

  if (!activeCorpseId) return;

  els.submitBtn.disabled = true;

  // Guardamos el ID ORIGINAL del cadáver.
  // Esto es importante porque activeCorpseId puede cambiar
  // cuando Firestore detecta que el cadáver se completó.
  const completedCorpseId = activeCorpseId;

  intro.experience.classList.remove("drawing-mode");
  intro.experience.classList.add("retracting-mode");

  intro.paper.classList.remove("ready");
  intro.paper.classList.remove("printing");
  intro.paper.classList.add("retracting");

  const contentBottom = getContentBottom(
    drawCtx,
    SEG_WIDTH,
    SEG_HEIGHT
  );

  const imageData = els.drawCanvas.toDataURL("image/png");

  const ref = doc(
    db,
    "corpses",
    completedCorpseId
  );

  try {

    const result = await runTransaction(db, async (tx) => {

      const snap = await tx.get(ref);

      const data = snap.data();

      const idx = data.count;

      if (
        idx >= TOTAL_SEGMENTS ||
        data.status === "completed"
      ) {
        return {
          conflict: true
        };
      }

      const segments = [...data.segments];

      segments[idx] = imageData;

      const segmentBottoms =
        Array.isArray(data.segmentBottoms)
          ? [...data.segmentBottoms]
          : Array(TOTAL_SEGMENTS).fill(null);

      segmentBottoms[idx] = contentBottom;

      const newCount = idx + 1;

      const isComplete =
        newCount === TOTAL_SEGMENTS;

      tx.update(ref, {

        segments,

        segmentBottoms,

        count: newCount,

        ...(isComplete
          ? {
              status: "completed",
              completedAt: serverTimestamp()
            }
          : {})

      });

      return {
        conflict: false,
        isComplete,
        segments,
        segmentBottoms
      };

    });

    // -----------------------------------------
    // CONFLICTO
    // -----------------------------------------

    if (result.conflict) {

      intro.paper.classList.remove("retracting");

      showStatus(
        "Justo se completó este cadáver. Preparando uno nuevo…",
        "info"
      );

      await connectToActiveCorpse();

      return;
    }

    // -----------------------------------------
    // MARCAR PARTICIPACIÓN
    // -----------------------------------------

    markContributed(completedCorpseId);

    // -----------------------------------------
    // SI EL CADÁVER SE COMPLETÓ
    // -----------------------------------------

    if (result.isComplete) {

      console.log(
        "🎉 CADÁVER COMPLETADO:",
        completedCorpseId
      );

      try {

        // Construimos la imagen final
        const compositeUrl =
          await buildComposite(
            result.segments,
            result.segmentBottoms
          );

        // Guardamos la imagen final
        await runTransaction(
          db,
          async (tx) => {

            tx.update(ref, {
              compositeImage: compositeUrl
            });

          }
        );

        console.log(
          "✅ Imagen final guardada"
        );

      } catch (imageError) {

        console.error(
          "Error construyendo la imagen final:",
          imageError
        );

      }

      // IMPORTANTE:
      // usamos completedCorpseId,
      // NO activeCorpseId

      await notifyParticipants(
        completedCorpseId
      );

    }

    // -----------------------------------------
    // ANIMACIÓN / UI
    // -----------------------------------------

    setTimeout(() => {

      intro.paper.classList.remove(
        "retracting"
      );

      showState("email");

    }, 1500);

  } catch (err) {

    console.error(err);

    showStatus(
      "No se pudo guardar el trazo. Probá de nuevo.",
      "error"
    );

    els.submitBtn.disabled = false;

    intro.experience.classList.remove(
      "retracting-mode"
    );

    intro.experience.classList.add(
      "drawing-mode"
    );

    intro.paper.classList.remove(
      "retracting"
    );

    intro.paper.classList.add(
      "ready"
    );

  }

}

// ---------------- Envío del Email ----------------
ui.submitEmailBtn.addEventListener("click", async () => {

    const email = ui.emailInput.value.trim();

    if (!email || !email.includes("@")) {
        showStatus(
            "Por favor ingresa un correo válido.",
            "error"
        );
        return;
    }

    ui.submitEmailBtn.disabled = true;

    try {

        // 1. Guardamos el email
        await addDoc(emailsRef, {
            corpseId: activeCorpseId,
            email: email,
            submittedAt: serverTimestamp()
        });

        console.log(
            "Email guardado para el cadáver:",
            activeCorpseId,
            email
        );

        // 2. Comprobamos el estado actual del cadáver
        const corpseRef = doc(
            db,
            "corpses",
            activeCorpseId
        );

        const corpseSnap = await getDocs(
            query(
                corpsesRef,
                where("__name__", "==", activeCorpseId)
            )
        );

        let corpseData = null;

        if (!corpseSnap.empty) {
            corpseData = corpseSnap.docs[0].data();
        }

        // 3. Si el cadáver YA estaba completo,
        // mandamos inmediatamente el correo a esta persona
        if (corpseData?.status === "completed") {

            console.log(
                "El cadáver ya estaba completo. Enviando email inmediatamente..."
            );

            try {

                await sendCompletionEmail(email);

                console.log(
                    "Notificación enviada a:",
                    email
                );

            } catch (mailError) {

                console.error(
                    "El email se guardó, pero no pudo enviarse:",
                    mailError
                );

                showStatus(
                    "Tu email se guardó, pero no pudimos enviar la notificación.",
                    "error"
                );
            }
        }

        showStatus(
            "¡Email guardado con éxito!",
            "success"
        );

        ui.emailInput.value = "";

        setTimeout(() => {
            showState("participated");
            showStatus("", "");
        }, 1500);

    } catch (err) {

        console.error(
            "Error guardando email:",
            err
        );

        const detail =
            err?.code === "permission-denied"
                ? "No tenés permiso para guardar el correo."
                : (
                    err?.message ||
                    "Error al guardar el correo."
                );

        showStatus(
            detail,
            "error"
        );

    } finally {

        ui.submitEmailBtn.disabled = false;

    }
});

if (ui.skipEmailBtn) {
    ui.skipEmailBtn.addEventListener("click", () => {
        showState("participated");
    });
}


function buildComposite(segments, bottoms) {
  return Promise.all(segments.map(loadImage)).then((images) => {
    // El offset de cada segmento se calcula según hasta dónde llegó
    // realmente el dibujo anterior (lo mismo que vio la persona como
    // guía), no un valor fijo — así no quedan saltos si alguien no
    // dibujó hasta el final de su hoja.
    const offsets = [0];
    for (let i = 1; i < images.length; i++) {
      const prevBottomRaw = bottoms?.[i - 1];
      const prevBottom = (typeof prevBottomRaw === "number" && prevBottomRaw > 0)
        ? prevBottomRaw
        : SEG_HEIGHT;
      const overlap = Math.max(0, prevBottom - GUIDE_HEIGHT);
      offsets.push(offsets[i - 1] + overlap);
    }
    const totalHeight = offsets[offsets.length - 1] + SEG_HEIGHT;

    const canvas = document.createElement("canvas");
    canvas.width = SEG_WIDTH;
    canvas.height = totalHeight;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f0ebd8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    images.forEach((img, i) => {
      ctx.drawImage(img, 0, offsets[i]);
    });

    return canvas.toDataURL("image/png");
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function showStatus(msg, type) {
  els.statusMessage.textContent = msg;
  els.statusMessage.className = `status-message ${type}`;
  if (msg) {
      setTimeout(() => { els.statusMessage.textContent = ""; }, 4000);
  }
}

// ---------------- Galería ----------------
async function loadGallery() {
  els.galleryGrid.innerHTML = "<p class='gallery-empty'>Cargando…</p>";
  try {
    const q = query(corpsesRef, where("status", "==", "completed"), orderBy("completedAt", "desc"), limit(50));
    const snap = await getDocs(q);

    if (snap.empty) {
      els.galleryGrid.innerHTML = "<p class='gallery-empty'>Todavía no hay cadáveres completos. ¡Sé parte del primero!</p>";
      return;
    }

    els.galleryGrid.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const date = data.completedAt?.toDate ? data.completedAt.toDate().toLocaleDateString("es-AR") : "";
      const card = document.createElement("button");
      card.className = "gallery-card";
      card.innerHTML = `<img src="${data.compositeImage}" alt="Cadáver exquisito completo" loading="lazy"><span>${date}</span>`;
      card.addEventListener("click", () => {
        els.modalImage.src = data.compositeImage;
        els.modalCaption.textContent = date ? `Completado el ${date}` : "";
        els.modal.classList.remove("hidden");
      });
      els.galleryGrid.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    els.galleryGrid.innerHTML = "<p class='gallery-empty'>No se pudo cargar la galería.</p>";
  }
}

function startIntroAnimation() {
  intro.experience.classList.remove("retracting-mode");
  
  requestAnimationFrame(() => {
    intro.paper.classList.add("printing");
  });
  intro.paper.addEventListener(
    "animationend",
    (e) => {
      if(e.animationName === 'printOut') {
        intro.paper.classList.remove("printing");
        intro.paper.classList.add("ready");
        setTimeout(() => {
          intro.experience.classList.add("drawing-mode");
        }, 250);
      }
    },
    { once: true }
  );
}
