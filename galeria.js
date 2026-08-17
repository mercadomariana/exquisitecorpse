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
  getFirestore, collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const corpsesRef = collection(db, "corpses");

const carousel = document.getElementById("gallery-carousel");
const modal = document.getElementById("reveal-modal");
const modalImage = document.getElementById("modal-image");
const modalCaption = document.getElementById("modal-caption");
const modalClose = document.getElementById("modal-close");

modalClose.addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

async function loadGallery() {
  try {
    const q = query(corpsesRef, where("status", "==", "completed"), orderBy("completedAt", "desc"), limit(50));
    const snap = await getDocs(q);

    if (snap.empty) {
      carousel.innerHTML = "<p class='gallery-empty'>Todavía no hay cadáveres completos. ¡Sé parte del primero!</p>";
      return;
    }

    carousel.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const date = data.completedAt?.toDate ? data.completedAt.toDate().toLocaleDateString("es-AR") : "";
      
      const card = document.createElement("div");
      card.className = "gallery-ticket-card";
      card.innerHTML = `
        <div class="ticket-image-wrap">
            <img src="${data.compositeImage}" alt="Cadáver exquisito completo" loading="lazy">
        </div>
        <div class="ticket-footer">
            <span>${date}</span>
        </div>
        <div class="paper-jagged-edge"></div>
      `;

      card.addEventListener("click", () => {
        modalImage.src = data.compositeImage;
        modalCaption.textContent = date ? `Completado el ${date}` : "";
        modal.classList.remove("hidden");
      });

      carousel.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    carousel.innerHTML = "<p class='gallery-empty'>No se pudo cargar la galería.</p>";
  }
}

loadGallery();