/* =========================================================
   CV-Generator — todo ocurre en el navegador: nada se envía a un servidor.
   1) Leemos el formulario  2) Mostramos la vista previa
   3) Autoguardamos un borrador en este navegador  4) Generamos el PDF con jsPDF
   ========================================================= */

const CLAVE_BORRADOR_VIEJA = "cvlisto-borrador"; // de versiones anteriores, se borra al entrar
const CLAVE_BORRADOR = "cv-generator-borrador";
const VERSION_BORRADOR = 1; // subirla si cambia la forma del borrador, y migrar en migrarBorrador()
// Un campo nuevo que falta en un borrador viejo se carga vacío (ver aplicarDatos), así que sumar campos acá
// no obliga a subir VERSION_BORRADOR. "nacimiento" es el valor oculto "AAAA-MM" de sus dos listas.
const CAMPOS = ["nombre", "puesto", "email", "telefono", "ciudad", "linkedin", "nacimiento", "nacionalidad", "licencia", "perfil", "habilidades", "idiomas"];
const MODELOS = ["moderno", "clasico", "ejecutivo", "creativo", "elegante", "destacado"];
const MAX_ITEMS = { exp: 6, edu: 4 }; // máximo de trabajos y estudios para que el CV no se desarme

// Fechas: los años van desde 1900 hasta el año en curso, tomado del reloj del dispositivo,
// así la lista se actualiza sola cada año nuevo
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const HOY = new Date();
const ANIO_ACTUAL = HOY.getFullYear();
const NUM_MES_ACTUAL = HOY.getMonth() + 1;
const MES_ACTUAL = `${ANIO_ACTUAL}-${String(NUM_MES_ACTUAL).padStart(2, "0")}`;
const ANIO_MINIMO = 1900;

const form = document.getElementById("cv-form");
const preview = document.getElementById("cv-preview");
const fotoInput = document.getElementById("foto");
const fotoPreview = document.getElementById("foto-preview");
const quitarFotoBtn = document.getElementById("quitar-foto");
const iconoFotoVacia = fotoPreview.innerHTML;

let fotoCuadrada = null; // la foto ya recortada con el editor, en cuadrado (dataURL JPEG)
let modeloMuestra = "moderno"; // modelo elegido en la sección "CV de muestra"

/* ---------- Utilidades ---------- */

const $ = (id) => document.getElementById(id);

// Evita que lo que escribe la persona se interprete como HTML
function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function separarPorComa(texto) {
  return texto.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function lineasDe(texto) {
  return (texto || "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function contactoDe(d) {
  return [["Email", d.email], ["Teléfono", d.telefono], ["Ubicación", d.ciudad], ["LinkedIn / Web", d.linkedin]]
    .filter(([, valor]) => valor);
}

// Nacimiento (solo mes y año, sin día a propósito), nacionalidad y licencia: solo los que están completos
function datosPersonalesDe(d) {
  const m = /^(\d{4})-(\d{2})$/.exec(d.nacimiento || "");
  const nacimiento = m ? `${MESES_LARGOS[Number(m[2]) - 1]} ${m[1]}` : "";
  return [["Nacimiento", nacimiento], ["Nacionalidad", d.nacionalidad], ["Licencia de conducir", d.licencia]]
    .filter(([, valor]) => valor);
}

function mostrarAviso(mensaje, esError = false) {
  const toast = $("toast");
  toast.textContent = mensaje;
  toast.classList.toggle("error", esError);
  toast.classList.add("show");
  clearTimeout(mostrarAviso.timer);
  mostrarAviso.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Las fotos de internet (ej. el CV de muestra) necesitan permiso para usarse dentro del PDF
    if (src.startsWith("http")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ---------- Fechas ---------- */

// "2021-03" -> "Mar 2021"  ·  "2021" (solo año) -> "2021"
function formatearFecha(valor) {
  const m = /^(\d{4})-(\d{2})$/.exec(valor || "");
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : valor || "";
}

// Acepta "2021-03", "2021" o fechas escritas a mano ("Mar 2021") y las deja como "2021-03" o "2021"
function normalizarFecha(valor) {
  const v = (valor || "").trim();
  if (/^\d{4}-\d{2}$/.test(v) || /^\d{4}$/.test(v)) return v;
  const m = /^([a-záéíóú]{3})[a-záéíóú]*\.?\s+(\d{4})$/i.exec(v);
  if (m) {
    const indice = MESES.findIndex((mes) => mes.toLowerCase() === m[1].toLowerCase());
    if (indice >= 0) return `${m[2]}-${String(indice + 1).padStart(2, "0")}`;
  }
  return "";
}

// Texto del período: "Mar 2021 - Actualidad"
function periodo(item, textoActual) {
  const inicio = formatearFecha(item.desde);
  const fin = item.actual ? textoActual : formatearFecha(item.hasta);
  return inicio && fin ? `${inicio} - ${fin}` : inicio || fin || "";
}

// Línea debajo del puesto: "Empresa  ·  Ciudad  ·  Mar 2021 - Actualidad"
function subtituloTrabajo(e) {
  return [e.empresa, e.ubicacion, periodo(e, "Actualidad")].filter(Boolean).join("  ·  ");
}

// Arma las dos listas (mes y año) de un campo de fecha y las conecta con su valor oculto ("2021-03").
// Se puede volver a llamar para mostrar un valor oculto nuevo (nacimiento, al cargar un borrador o un ejemplo).
function armarSelectorFecha(caja) {
  const mes = caja.querySelector(".fecha-mes");
  const anio = caja.querySelector(".fecha-anio");
  const oculto = caja.querySelector('input[type="hidden"]');

  if (!caja.sincronizar) {
    mes.innerHTML = '<option value="">Mes</option>' +
      MESES_LARGOS.map((nombre, i) => `<option value="${String(i + 1).padStart(2, "0")}">${nombre}</option>`).join("");
    let anios = '<option value="">Año</option>';
    for (let a = ANIO_ACTUAL; a >= ANIO_MINIMO; a--) anios += `<option value="${a}">${a}</option>`;
    anio.innerHTML = anios;

    caja.sincronizar = () => {
      // En el año en curso no se pueden elegir meses que todavía no llegaron
      const esteAnio = Number(anio.value) === ANIO_ACTUAL;
      [...mes.options].forEach((op) => (op.disabled = Boolean(op.value) && esteAnio && Number(op.value) > NUM_MES_ACTUAL));
      if (mes.selectedOptions[0]?.disabled) mes.value = "";
      oculto.value = anio.value ? (mes.value ? `${anio.value}-${mes.value}` : anio.value) : "";
    };
    // Se ejecuta antes que el aviso general del formulario, así la vista previa ya ve la fecha nueva
    mes.addEventListener("input", caja.sincronizar);
    anio.addEventListener("input", caja.sincronizar);
  }

  const [a, m] = (oculto.value || "").split("-");
  anio.value = a || "";
  mes.value = m || "";
  caja.sincronizar();
}

// Nacimiento es opcional, pero si se usa hacen falta mes y año: nunca mostramos una fecha a medias
function validarNacimiento() {
  const caja = $("campo-nacimiento");
  const mes = caja.querySelector(".fecha-mes").value;
  const anio = caja.querySelector(".fecha-anio").value;
  const error = mes && !anio ? "Elegí también el año." : anio && !mes ? "Elegí también el mes." : "";
  caja.querySelector(".fecha-error").textContent = error;
  caja.classList.toggle("fecha-invalida", Boolean(error));
  return !error;
}

// Para comparar fechas con o sin mes: "2021" cuenta como enero (inicio) o diciembre (fin)
const claveFecha = (valor, mesSiFalta) => (/^\d{4}$/.test(valor) ? `${valor}-${mesSiFalta}` : valor);

// Revisa las fechas de un trabajo o estudio y muestra el error debajo si hay alguno
function validarFechas(item) {
  const desde = item.querySelector('[data-field="desde"]').value;
  const campoHasta = item.querySelector('[data-field="hasta"]');
  const actual = item.querySelector('[data-field="actual"]').checked;
  const hasta = actual ? "" : campoHasta.value;

  const cajaHasta = campoHasta.closest(".campo-fecha");
  cajaHasta.classList.toggle("deshabilitado", actual);
  cajaHasta.querySelectorAll("select").forEach((s) => (s.disabled = actual));

  const faltaAnio = [...item.querySelectorAll(".campo-fecha")].some((caja) =>
    !caja.classList.contains("deshabilitado") && caja.querySelector(".fecha-mes").value && !caja.querySelector(".fecha-anio").value
  );
  const inicio = claveFecha(desde, "01");
  const fin = claveFecha(hasta, "12");

  let error = "";
  if (faltaAnio) {
    error = "Elegí también el año.";
  } else if (inicio > MES_ACTUAL || (/-\d{2}$/.test(hasta) && hasta > MES_ACTUAL)) {
    error = "Las fechas no pueden ser futuras.";
  } else if (desde && hasta && fin < inicio) {
    error = "La fecha de fin no puede ser anterior a la de inicio.";
  }

  item.querySelector(".fecha-error").textContent = error;
  item.classList.toggle("fecha-invalida", Boolean(error));
  return !error;
}

/* ---------- Listas repetibles (experiencia y educación) ---------- */

function listaDe(tipo) {
  return $(tipo === "exp" ? "lista-exp" : "lista-edu");
}

function agregarItem(tipo, valores = {}) {
  const nodo = $(`tpl-${tipo}`).content.firstElementChild.cloneNode(true);

  const v = { ...valores };
  if (/^(actualidad|en curso|presente)$/i.test((v.hasta || "").trim())) {
    v.actual = true;
    v.hasta = "";
  }
  v.desde = normalizarFecha(v.desde);
  v.hasta = normalizarFecha(v.hasta);

  nodo.querySelectorAll("[data-field]").forEach((campo) => {
    if (campo.type === "checkbox") campo.checked = Boolean(v[campo.dataset.field]);
    else campo.value = v[campo.dataset.field] || "";
  });
  nodo.querySelectorAll(".campo-fecha").forEach(armarSelectorFecha);
  validarFechas(nodo);

  nodo.querySelector(".btn-remove").addEventListener("click", () => {
    nodo.remove();
    actualizarBotonesAgregar();
    actualizarCasillaActual();
    actualizar();
  });
  listaDe(tipo).appendChild(nodo);
  actualizarBotonesAgregar();
  actualizarCasillaActual();
  return nodo;
}

// "Trabajo acá actualmente" solo aparece en la primera experiencia (la más reciente).
// En las demás se oculta y se desmarca, así "Hasta" queda siempre disponible.
function actualizarCasillaActual() {
  [...listaDe("exp").querySelectorAll(".item")].forEach((item, i) => {
    const casilla = item.querySelector("[data-solo-primero]");
    casilla.hidden = i > 0;
    if (i > 0 && casilla.querySelector("input").checked) {
      casilla.querySelector("input").checked = false;
      validarFechas(item);
    }
  });
}

// Desactiva "+ Agregar" cuando se llega al máximo permitido
function actualizarBotonesAgregar() {
  document.querySelectorAll("[data-add]").forEach((btn) => {
    const tipo = btn.dataset.add;
    const lleno = listaDe(tipo).children.length >= MAX_ITEMS[tipo];
    btn.disabled = lleno;
    if (tipo === "exp") btn.textContent = lleno ? `Máximo ${MAX_ITEMS.exp} experiencias` : "+ Agregar experiencia";
    else btn.textContent = lleno ? `Máximo ${MAX_ITEMS.edu} estudios` : "+ Agregar estudio";
  });
}

function leerItems(idLista) {
  return [...$(idLista).querySelectorAll(".item")]
    .map((item) => {
      const datos = {};
      item.querySelectorAll("[data-field]").forEach((c) => {
        datos[c.dataset.field] = c.type === "checkbox" ? c.checked : c.value.trim();
      });
      return datos;
    })
    .filter((datos) => Object.entries(datos).some(([campo, valor]) => campo !== "actual" && valor));
}

/* ---------- Leer el formulario ---------- */

function leerDatos() {
  const d = {};
  CAMPOS.forEach((id) => (d[id] = $(id).value.trim()));
  d.listaHabilidades = separarPorComa(d.habilidades);
  d.listaIdiomas = separarPorComa(d.idiomas);
  d.experiencia = leerItems("lista-exp");
  d.educacion = leerItems("lista-edu");
  d.color = form.querySelector('input[name="color"]:checked').value;
  d.modelo = form.querySelector('input[name="modelo"]:checked').value;
  return d;
}

/* ---------- Vista previa (los 6 modelos) ---------- */

// Dibuja un CV en "destino". Se usa para la vista previa del formulario y para los ejemplos.
function renderVistaPrevia(d, destino = preview, fotoSrc = fotoCuadrada) {
  const modelo = MODELOS.includes(d.modelo) ? d.modelo : "moderno";
  destino.className = `cv modelo-${modelo}`;
  destino.style.setProperty("--cv-accent", d.color);

  const contacto = contactoDe(d);
  const titulo = (texto) => `<h4 class="cv-h">${texto}</h4>`;

  const foto = fotoSrc
    ? `<img class="cv-photo" src="${fotoSrc}" alt=""${fotoSrc.startsWith("http") ? ' crossorigin="anonymous"' : ""}>`
    : `<div class="cv-photo cv-initials">${esc(iniciales(d.nombre)) || "?"}</div>`;

  const cabecera = `
    <h2 class="cv-name">${esc(d.nombre) || '<span class="ph">Tu nombre</span>'}</h2>
    <p class="cv-role">${esc(d.puesto) || '<span class="ph">Tu puesto o profesión</span>'}</p>`;

  const bloqueContacto = contacto.length
    ? `<div class="cv-block"><h4>Contacto</h4>${contacto.map(([k, v]) => `<p class="cv-label">${k}</p><p class="cv-val">${esc(v)}</p>`).join("")}</div>`
    : `<div class="cv-block"><h4>Contacto</h4><p class="cv-val ph">Tu email y teléfono</p></div>`;

  // Nacimiento, nacionalidad y licencia: en las columnas van como bloque propio y en Clásico y Destacado,
  // como una línea "Nacimiento: Septiembre 1990 · Nacionalidad: Argentina" debajo del contacto
  const personales = datosPersonalesDe(d);
  const bloquePersonal = personales.length
    ? `<div class="cv-block"><h4>Datos personales</h4>${personales.map(([k, v]) => `<p class="cv-label">${k}</p><p class="cv-val">${esc(v)}</p>`).join("")}</div>`
    : "";
  const lineaPersonal = (clase, sep) => personales.length
    ? `<p class="${clase}">${personales.map(([k, v]) => `${k}: ${esc(v)}`).join(`<span class="sep">${sep}</span>`)}</p>`
    : "";

  const lista = (nombre, items) => items.length
    ? `<div class="cv-block"><h4>${nombre}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
    : "";

  const descripcion = (texto) => {
    const lineas = lineasDe(texto);
    if (lineas.length > 1) return `<ul>${lineas.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    return lineas.length ? `<p class="cv-text">${esc(lineas[0])}</p>` : "";
  };

  const perfil = d.perfil ? `<div class="cv-section">${titulo("Perfil")}<p class="cv-text">${esc(d.perfil)}</p></div>` : "";

  const experiencia = d.experiencia.length
    ? `<div class="cv-section">${titulo("Experiencia laboral")}${d.experiencia.map((e) => `
        <div class="cv-item">
          <p class="cv-item-title">${esc(e.puesto) || "Puesto"}</p>
          <p class="cv-item-sub">${esc(subtituloTrabajo(e))}</p>
          ${descripcion(e.descripcion)}
        </div>`).join("")}</div>`
    : `<div class="cv-section">${titulo("Experiencia laboral")}<p class="cv-text ph">Acá aparecen tus trabajos.</p></div>`;

  const educacion = d.educacion.length
    ? `<div class="cv-section">${titulo("Educación")}${d.educacion.map((e) => `
        <div class="cv-item">
          <p class="cv-item-title">${esc(e.titulo) || "Título"}</p>
          <p class="cv-item-sub">${esc([e.institucion, periodo(e, "En curso")].filter(Boolean).join("  ·  "))}</p>
        </div>`).join("")}</div>`
    : "";

  // Habilidades e idiomas como "etiquetas" (modelos vistosos)
  const etiquetas = (nombre, items) => items.length
    ? `<div class="cv-block"><h4>${nombre}</h4><div class="cv-chips">${items.map((i) => `<span class="cv-chip">${esc(i)}</span>`).join("")}</div></div>`
    : "";

  if (modelo === "creativo") {
    destino.innerHTML = `
      <header class="cvk-head"><div class="cvk-id">${cabecera}</div>${foto}</header>
      <div class="cvk-body">
        <div class="cvk-main">${perfil}${experiencia}${educacion}</div>
        <aside class="cvk-aside">
          ${bloqueContacto}
          ${bloquePersonal}
          ${etiquetas("Habilidades", d.listaHabilidades)}
          ${etiquetas("Idiomas", d.listaIdiomas)}
        </aside>
      </div>`;
    return;
  }

  if (modelo === "elegante") {
    destino.innerHTML = `
      <aside class="cvl-side">
        ${foto}
        ${bloqueContacto}
        ${bloquePersonal}
        ${etiquetas("Habilidades", d.listaHabilidades)}
        ${lista("Idiomas", d.listaIdiomas)}
      </aside>
      <div class="cvl-main">${cabecera}<div class="cvl-barra"></div>${perfil}${experiencia}${educacion}</div>`;
    return;
  }

  if (modelo === "destacado") {
    const lineaContacto = contacto.length
      ? contacto.map(([, v]) => esc(v)).join('<span class="sep">·</span>')
      : '<span class="ph">Tu email · teléfono · ciudad</span>';
    destino.innerHTML = `
      <header class="cvd-head">${foto}${cabecera}<p class="cvd-contacto">${lineaContacto}</p>${lineaPersonal("cvd-contacto", "·")}</header>
      <div class="cvd-body">
        <div class="cvd-main">${perfil}${experiencia}${educacion}</div>
        <aside class="cvd-aside">
          ${etiquetas("Habilidades", d.listaHabilidades)}
          ${etiquetas("Idiomas", d.listaIdiomas)}
        </aside>
      </div>`;
    return;
  }

  if (modelo === "clasico") {
    const lineaContacto = contacto.length
      ? contacto.map(([, v]) => esc(v)).join('<span class="sep">|</span>')
      : '<span class="ph">Tu email · teléfono · ciudad</span>';
    const listaEnLinea = (nombre, items) => items.length
      ? `<div class="cv-section">${titulo(nombre)}<p class="cv-text">${items.map((i) => esc(i)).join("  ·  ")}</p></div>`
      : "";
    destino.innerHTML = `
      <header class="cvc-head">
        ${fotoSrc ? foto : ""}
        <div class="cvc-id">${cabecera}<p class="cvc-contacto">${lineaContacto}</p>${lineaPersonal("cvc-contacto", "|")}</div>
      </header>
      ${perfil}${experiencia}${educacion}
      ${listaEnLinea("Habilidades", d.listaHabilidades)}
      ${listaEnLinea("Idiomas", d.listaIdiomas)}`;
    return;
  }

  if (modelo === "ejecutivo") {
    destino.innerHTML = `
      <header class="cve-head">${foto}<div class="cve-id">${cabecera}</div></header>
      <div class="cve-body">
        <div class="cve-main">${perfil}${experiencia}${educacion}</div>
        <aside class="cve-aside">
          ${bloqueContacto}
          ${bloquePersonal}
          ${lista("Habilidades", d.listaHabilidades)}
          ${lista("Idiomas", d.listaIdiomas)}
        </aside>
      </div>`;
    return;
  }

  destino.innerHTML = `
    <aside class="cv-side">
      ${foto}
      ${bloqueContacto}
      ${bloquePersonal}
      ${lista("Habilidades", d.listaHabilidades)}
      ${lista("Idiomas", d.listaIdiomas)}
    </aside>
    <div class="cv-main">${cabecera}${perfil}${experiencia}${educacion}</div>`;
}

/* ---------- Datos del formulario ---------- */

function marcarRadio(nombre, valor) {
  const radio = form.querySelector(`input[name="${nombre}"][value="${valor}"]`);
  if (radio) radio.checked = true;
}

function aplicarDatos(b) {
  CAMPOS.forEach((id) => ($(id).value = b.campos?.[id] || ""));
  armarSelectorFecha($("campo-nacimiento")); // pasa el valor oculto a las listas de mes y año
  validarNacimiento();
  listaDe("exp").innerHTML = "";
  listaDe("edu").innerHTML = "";
  (b.experiencia?.length ? b.experiencia : [{}]).slice(0, MAX_ITEMS.exp).forEach((e) => agregarItem("exp", e));
  (b.educacion?.length ? b.educacion : [{}]).slice(0, MAX_ITEMS.edu).forEach((e) => agregarItem("edu", e));
  marcarRadio("color", b.color);
  marcarRadio("modelo", b.modelo || "moderno");
  ponerFoto(b.foto || null, b.foto ? fotoEstado : null); // sin "foto" en los datos, la foto se quita
}

let generacion = 0; // cambia cada vez que se reemplaza todo el formulario (para descartar una foto que llega tarde)

// Deja el formulario vacío. El borrador guardado se borra solo en el próximo guardado (guardarBorrador).
function empezarDeCero() {
  generacion++;
  form.reset();
  aplicarDatos({ color: "#0369a1", modelo: "moderno" });
}

/* ---------- Autoguardado ----------
   Los textos del CV van a localStorage: son chicos y se leen al instante al entrar.
   La foto va aparte, a IndexedDB, porque la original puede pesar más de lo que entra en localStorage.
   El PDF no lee nada de acá: sigue saliendo del formulario y de la foto que están en pantalla. */

let temporizadorGuardado = null;
let fotoGuardada = null; // la foto que ya está en IndexedDB, para no reescribirla en cada tecla
let falloAvisado = false;

function armarBorrador() {
  const d = leerDatos();
  const campos = {};
  CAMPOS.forEach((id) => (campos[id] = $(id).value));
  return {
    version: VERSION_BORRADOR,
    guardado: new Date().toISOString(),
    campos,
    experiencia: d.experiencia,
    educacion: d.educacion,
    color: d.color,
    modelo: d.modelo,
    tieneFoto: Boolean(fotoCuadrada),
  };
}

const hayContenido = (b) =>
  Object.values(b.campos).some((v) => v.trim()) || b.experiencia.length > 0 || b.educacion.length > 0 || b.tieneFoto;

// Hoy existe una sola versión. Si en el futuro cambia la forma del borrador, acá se convierte
// el borrador viejo al formato nuevo; lo que no se reconoce se descarta en vez de romper el formulario.
function migrarBorrador(b) {
  if (!b || typeof b !== "object" || b.version !== VERSION_BORRADOR) return null;
  return b;
}

function leerBorrador() {
  try { return migrarBorrador(JSON.parse(localStorage.getItem(CLAVE_BORRADOR))); } catch { return null; }
}

function avisarFalloGuardado() {
  if (falloAvisado) return;
  falloAvisado = true;
  mostrarAviso("Este navegador no nos deja guardar el borrador. Descargá tu PDF antes de salir.", true);
}

// Guarda, borra o lee la foto (recortada + original + encuadre) en IndexedDB
function fotoDB(accion, valor) {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open("cv-generator", 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore("foto");
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onsuccess = () => {
      const db = pedido.result;
      const tx = db.transaction("foto", accion === "get" ? "readonly" : "readwrite");
      const tienda = tx.objectStore("foto");
      const op = accion === "get" ? tienda.get("actual")
        : accion === "put" ? tienda.put({ version: VERSION_BORRADOR, ...valor }, "actual")
        : tienda.delete("actual");
      tx.oncomplete = () => { db.close(); resolver(op.result); };
      tx.onerror = tx.onabort = () => { db.close(); rechazar(tx.error); };
    };
  });
}

function guardarBorrador() {
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = null;
  const b = armarBorrador();
  try {
    if (hayContenido(b)) localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    else localStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    avisarFalloGuardado();
  }
  if (fotoCuadrada !== fotoGuardada) {
    fotoGuardada = fotoCuadrada;
    const operacion = fotoCuadrada ? fotoDB("put", { cuadrada: fotoCuadrada, ...fotoEstado }) : fotoDB("delete");
    operacion.catch(avisarFalloGuardado);
  }
}

// Los textos se guardan medio segundo después de la última tecla; un cambio de foto, en el acto
function programarGuardado() {
  if (fotoCuadrada !== fotoGuardada) return guardarBorrador();
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarBorrador, 500);
}

// Si hay un borrador, lo vuelve a poner en el formulario (la foto llega un instante después)
function restaurarBorrador() {
  const b = leerBorrador();
  if (!b) {
    fotoDB("delete").catch(() => {}); // por si quedó una foto suelta sin borrador
    return false;
  }
  aplicarDatos({ campos: b.campos, experiencia: b.experiencia, educacion: b.educacion, color: b.color, modelo: b.modelo });
  const gen = generacion;
  fotoDB("get")
    .then((f) => {
      if (!f?.cuadrada || gen !== generacion || fotoCuadrada) return; // el usuario ya cambió algo: no pisamos nada
      fotoGuardada = f.cuadrada;
      ponerFoto(f.cuadrada, f.src ? { src: f.src, u: f.u, v: f.v, zoom: f.zoom } : null);
      actualizar();
    })
    .catch(() => {});
  return true;
}

/* ---------- Actualización general ---------- */

// Contador de caracteres debajo de "Sobre mí" y de cada "Tareas y logros"
function actualizarContador(campo) {
  const contador = campo.parentElement.querySelector(".contador");
  if (contador) contador.textContent = `${campo.value.length}/${campo.maxLength}`;
}

function actualizar() {
  renderVistaPrevia(leerDatos());
  form.querySelectorAll("textarea").forEach(actualizarContador);
  programarGuardado();
}

form.addEventListener("input", (e) => {
  if (e.target.id === "nombre") $("nombre").closest("label").classList.remove("has-error");
  const item = e.target.closest(".item");
  if (item) validarFechas(item);
  if (e.target.closest("#campo-nacimiento")) validarNacimiento();
  actualizar();
});

document.querySelectorAll("[data-add]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const nodo = agregarItem(btn.dataset.add);
    nodo.querySelector("input").focus();
    actualizar();
  })
);

/* ---------- Foto: carga y editor de recorte ----------
   El editor genera un cuadrado con exactamente lo que se ve dentro del círculo.
   La vista previa muestra ese cuadrado en círculo y el PDF lo recorta en el mismo círculo
   (fotoCircular), así que el encuadre elegido se respeta tal cual, sin volver a centrar nada. */

const editor = $("editor-foto");
const escena = $("editor-escena");
const editorImg = $("editor-img");
const zoomInput = $("editor-zoom");
const ajustarFotoBtn = $("ajustar-foto");
const LADO_FOTO = 600; // píxeles de la foto final (de sobra para que se vea nítida en el PDF)
const ZOOM_MAX = 4;
const CIRCULO = 0.84; // el círculo ocupa el 84% de la escena (igual que .editor-circulo en styles.css)

let fotoEstado = null; // { src, u, v, zoom }: la foto original y el encuadre elegido, para volver a ajustarlo
let edicion = null; // lo que se está editando ahora: { img, src, u, v, zoom }
// u, v = punto de la imagen original (en sus píxeles) que queda en el centro del círculo.
// Guardarlo así hace que el encuadre no dependa del tamaño de la pantalla.

function ponerFoto(dataURL, estado = null) {
  fotoCuadrada = dataURL;
  fotoEstado = dataURL ? estado : null;
  fotoPreview.innerHTML = dataURL ? `<img src="${dataURL}" alt="Tu foto">` : iconoFotoVacia;
  quitarFotoBtn.hidden = !dataURL;
  ajustarFotoBtn.hidden = !fotoEstado;
}

// Achica fotos enormes (ej. de celular) para que el editor ande fluido
function reducirImagen(img, maximo = 2000) {
  const escala = Math.min(1, maximo / Math.max(img.naturalWidth, img.naturalHeight));
  if (escala === 1) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Radio del círculo medido en píxeles de la imagen original: con zoom 1 el lado corto lo llena justo
const radioEnImagen = (e) => Math.min(e.img.naturalWidth, e.img.naturalHeight) / (2 * e.zoom);
// Píxeles de pantalla por cada píxel de la imagen
const escalaEditor = (e) => (escena.clientWidth * CIRCULO) / (2 * radioEnImagen(e));

// Evita que el círculo quede con partes vacías: limita el zoom y cuánto se puede correr la foto
function limitarEncuadre(e) {
  e.zoom = Math.min(ZOOM_MAX, Math.max(1, e.zoom));
  const r = radioEnImagen(e);
  e.u = Math.min(e.img.naturalWidth - r, Math.max(r, e.u));
  e.v = Math.min(e.img.naturalHeight - r, Math.max(r, e.v));
}

function dibujarEditor() {
  if (!edicion) return;
  limitarEncuadre(edicion);
  const s = escalaEditor(edicion);
  const centro = escena.clientWidth / 2;
  editorImg.style.width = `${edicion.img.naturalWidth * s}px`;
  editorImg.style.height = `${edicion.img.naturalHeight * s}px`;
  editorImg.style.transform = `translate(${centro - edicion.u * s}px, ${centro - edicion.v * s}px)`;
  zoomInput.value = edicion.zoom;
}

async function abrirEditor(src, estado = null) {
  const img = await cargarImagen(src);
  const w = img.naturalWidth, h = img.naturalHeight, r = Math.min(w, h) / 2;
  edicion = {
    img, src,
    zoom: estado?.zoom ?? 1,
    u: estado?.u ?? w / 2,
    // En fotos verticales arrancamos un poco más arriba del centro, donde suele estar la cara
    v: estado?.v ?? r + (h - 2 * r) * 0.3,
  };
  editorImg.src = src;
  editor.showModal();
  dibujarEditor();
  escena.focus({ preventScroll: true });
}

function aplicarEditor() {
  const e = edicion;
  limitarEncuadre(e);
  const r = radioEnImagen(e);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = LADO_FOTO;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(e.img, e.u - r, e.v - r, 2 * r, 2 * r, 0, 0, LADO_FOTO, LADO_FOTO);
  ponerFoto(canvas.toDataURL("image/jpeg", 0.92), { src: e.src, u: e.u, v: e.v, zoom: e.zoom });
  editor.close();
  actualizar();
}

// Cambia el zoom manteniendo fijo el punto que está en el centro del círculo
function cambiarZoom(nuevo) {
  if (!edicion) return;
  edicion.zoom = nuevo;
  dibujarEditor();
}

// Arrastre con mouse o dedo, y pellizco con dos dedos para el zoom
const punteros = new Map();
let pellizco = null;
const distanciaPunteros = () => {
  const [a, b] = [...punteros.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};

escena.addEventListener("pointerdown", (ev) => {
  if (!edicion) return;
  try { escena.setPointerCapture(ev.pointerId); } catch { /* sin captura, el arrastre sigue funcionando */ }
  punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (punteros.size === 2) pellizco = { distancia: distanciaPunteros(), zoom: edicion.zoom };
  escena.classList.add("arrastrando");
});

escena.addEventListener("pointermove", (ev) => {
  if (!edicion || !punteros.has(ev.pointerId)) return;
  const anterior = punteros.get(ev.pointerId);
  const actual = { x: ev.clientX, y: ev.clientY };
  punteros.set(ev.pointerId, actual);
  if (punteros.size === 1) {
    const s = escalaEditor(edicion);
    edicion.u -= (actual.x - anterior.x) / s;
    edicion.v -= (actual.y - anterior.y) / s;
    dibujarEditor();
  } else if (pellizco) {
    cambiarZoom(pellizco.zoom * (distanciaPunteros() / pellizco.distancia));
  }
});

const soltarPuntero = (ev) => {
  punteros.delete(ev.pointerId);
  if (punteros.size < 2) pellizco = null;
  if (!punteros.size) escena.classList.remove("arrastrando");
};
escena.addEventListener("pointerup", soltarPuntero);
escena.addEventListener("pointercancel", soltarPuntero);

escena.addEventListener("wheel", (ev) => {
  if (!edicion) return;
  ev.preventDefault();
  cambiarZoom(edicion.zoom * Math.exp(-ev.deltaY * 0.0015));
}, { passive: false });

escena.addEventListener("keydown", (ev) => {
  if (!edicion) return;
  const paso = 10 / escalaEditor(edicion);
  const mover = { ArrowLeft: [paso, 0], ArrowRight: [-paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] }[ev.key];
  if (mover) {
    edicion.u += mover[0];
    edicion.v += mover[1];
    dibujarEditor();
  } else if (ev.key === "+" || ev.key === "=") cambiarZoom(edicion.zoom + 0.1);
  else if (ev.key === "-") cambiarZoom(edicion.zoom - 0.1);
  else return;
  ev.preventDefault();
});

zoomInput.addEventListener("input", () => cambiarZoom(Number(zoomInput.value)));
document.querySelectorAll("[data-zoom]").forEach((btn) =>
  btn.addEventListener("click", () => edicion && cambiarZoom(edicion.zoom + Number(btn.dataset.zoom) * 0.25))
);
$("editor-aplicar").addEventListener("click", aplicarEditor);
$("editor-cancelar").addEventListener("click", () => editor.close()); // la foto anterior queda como estaba
editor.addEventListener("close", () => {
  edicion = null;
  punteros.clear();
  pellizco = null;
});
window.addEventListener("resize", dibujarEditor);

fotoInput.addEventListener("change", () => {
  const archivo = fotoInput.files[0];
  fotoInput.value = "";
  if (!archivo) return;
  if (!archivo.type.startsWith("image/")) return mostrarAviso("Elegí un archivo de imagen (JPG o PNG).", true);

  const lector = new FileReader();
  lector.onload = async () => {
    try {
      const img = await cargarImagen(lector.result);
      await abrirEditor(reducirImagen(img) || lector.result);
    } catch {
      mostrarAviso("No pudimos leer esa imagen. Probá con una foto JPG o PNG.", true);
    }
  };
  lector.readAsDataURL(archivo);
});

ajustarFotoBtn.addEventListener("click", () => {
  if (fotoEstado) abrirEditor(fotoEstado.src, fotoEstado);
});

quitarFotoBtn.addEventListener("click", () => {
  ponerFoto(null);
  actualizar();
});

/* ---------- Ejemplos, muestra y borrar ---------- */

// Datos de muestra: se usan en el CV de ejemplo del inicio y en el botón "Cargar ejemplo"
const EJEMPLO = {
  campos: {
    nombre: "Lucía Fernández",
    puesto: "Administrativa contable",
    email: "lucia.fernandez@email.com",
    telefono: "+54 11 5555-1234",
    ciudad: "Córdoba, Argentina",
    linkedin: "linkedin.com/in/luciafernandez",
    nacimiento: "1994-06",
    nacionalidad: "Argentina",
    licencia: "B1",
    perfil: "Administrativa con 5 años de experiencia en facturación, cuentas a pagar y atención a proveedores. Organizada, detallista y con muchas ganas de sumar a un equipo en crecimiento.",
    habilidades: "Excel avanzado, Tango Gestión, Facturación electrónica, Atención al cliente, Trabajo en equipo",
    idiomas: "Español (nativo), Inglés (intermedio)",
  },
  experiencia: [
    { puesto: "Asistente administrativa", empresa: "Distribuidora Andes S.A.", ubicacion: "Córdoba", desde: "2021-03", actual: true,
      descripcion: "Facturación y control de cuentas corrientes\nConciliaciones bancarias mensuales\nReduje un 30% los reclamos de proveedores ordenando los pagos" },
    { puesto: "Recepcionista", empresa: "Estudio Contable Pérez", ubicacion: "Villa Carlos Paz", desde: "2019-02", hasta: "2021-02",
      descripcion: "Atención telefónica y presencial, agenda de clientes y archivo de documentación." },
  ],
  educacion: [
    { titulo: "Técnica Superior en Administración", institucion: "Instituto Superior San Martín", desde: "2016-03", hasta: "2019-12" },
  ],
};
const FOTO_EJEMPLO = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&h=320&q=80";

// CV profesional completo para la sección "CV de muestra"
const MUESTRA = {
  campos: {
    nombre: "Martín Gómez",
    puesto: "Analista de Marketing Digital",
    email: "martin.gomez@email.com",
    telefono: "+54 11 4567-8910",
    ciudad: "Buenos Aires, Argentina",
    linkedin: "linkedin.com/in/martingomez",
    perfil: "Analista de marketing digital con 6 años de experiencia en campañas de performance, SEO y análisis de datos. Lideré estrategias que aumentaron las ventas online de marcas de retail y consumo masivo. Busco sumar mi experiencia a un equipo orientado a resultados.",
    habilidades: "Google Ads y Meta Ads, SEO y SEM, Google Analytics 4, Email marketing, Excel y Looker Studio, Liderazgo de equipos",
    idiomas: "Español (nativo), Inglés (avanzado), Portugués (básico)",
  },
  experiencia: [
    { puesto: "Analista Sr. de Marketing Digital", empresa: "Grupo Retail Sur", ubicacion: "Buenos Aires", desde: "2022-01", actual: true,
      descripcion: "Planificación y optimización de campañas en Google y Meta\nAumenté un 45% las ventas online en el primer año\nCoordinación de un equipo de 3 personas" },
    { puesto: "Analista de Marketing", empresa: "Agencia Pixel", ubicacion: "Remoto", desde: "2019-03", hasta: "2021-12",
      descripcion: "Gestión de cuentas de 12 clientes de consumo masivo\nInformes mensuales de resultados y propuestas de mejora" },
    { puesto: "Asistente de Comunicación", empresa: "Fundación Crecer", ubicacion: "La Plata", desde: "2018-02", hasta: "2019-02",
      descripcion: "Manejo de redes sociales y del newsletter institucional." },
  ],
  educacion: [
    { titulo: "Licenciatura en Comunicación Social", institucion: "Universidad de Buenos Aires", desde: "2013-03", hasta: "2018-12" },
    { titulo: "Diplomatura en Marketing Digital", institucion: "Universidad Austral", desde: "2020-04", hasta: "2020-11" },
  ],
};
const FOTO_MUESTRA = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=320&h=320&q=80";
const COLOR_MUESTRA = "#0f766e";

// Convierte un bloque de datos de ejemplo al formato que usan la vista previa y el PDF
function datosDe(bloque, color, modelo) {
  const d = { ...bloque.campos, experiencia: bloque.experiencia, educacion: bloque.educacion, color, modelo };
  d.listaHabilidades = separarPorComa(d.habilidades);
  d.listaIdiomas = separarPorComa(d.idiomas);
  return d;
}

function mostrarMuestra() {
  renderVistaPrevia(datosDe(MUESTRA, COLOR_MUESTRA, modeloMuestra), $("cv-muestra"), FOTO_MUESTRA);
}

document.querySelectorAll("[data-modelo-muestra]").forEach((btn) =>
  btn.addEventListener("click", () => {
    modeloMuestra = btn.dataset.modeloMuestra;
    document.querySelectorAll("[data-modelo-muestra]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    mostrarMuestra();
  })
);

$("descargar-muestra").addEventListener("click", (e) =>
  descargarPDF(datosDe(MUESTRA, COLOR_MUESTRA, modeloMuestra), FOTO_MUESTRA, [e.currentTarget])
);

// El ejemplo reemplaza todo lo cargado (foto incluida); solo se mantienen el modelo y el color elegidos
$("cargar-ejemplo").addEventListener("click", () => {
  if (hayContenido(armarBorrador()) && !confirm("El ejemplo va a reemplazar todo lo que cargaste, foto incluida. ¿Seguimos?")) return;
  const actual = leerDatos();
  empezarDeCero();
  aplicarDatos({ ...EJEMPLO, color: actual.color, modelo: actual.modelo });
  actualizar();
  mostrarAviso("Cargamos un ejemplo. Reemplazalo con tus datos.");
});

$("borrar-todo").addEventListener("click", () => {
  if (!confirm("Se va a borrar tu borrador guardado en este navegador (datos y foto). ¿Querés empezar un CV nuevo?")) return;
  empezarDeCero();
  actualizar();
  guardarBorrador(); // borra el borrador en el acto, sin esperar
  mostrarAviso("Listo, empezaste un CV nuevo.");
});

/* =========================================================
   GENERAR EL PDF (hoja A4, medidas en milímetros)
   ========================================================= */

const PT = 0.3528; // 1 punto tipográfico en mm

// Las fuentes básicas del PDF no tienen emojis ni algunos símbolos: los reemplazamos
function limpiar(texto) {
  return String(texto || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

function hexARgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mezclar(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

// Convierte la foto cuadrada en un círculo con fondo transparente
async function fotoCircular(src) {
  const img = await cargarImagen(src);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = img.width;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(img.width / 2, img.height / 2, img.width / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Crea el documento y las herramientas de dibujo que comparten los 6 modelos
function crearPdf(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c = {
    doc,
    W: 210,
    H: 297,
    ACENTO: hexARgb(d.color),
    BLANCO: [255, 255, 255],
    OSCURO: [17, 24, 39],
    GRIS: [75, 85, 99],
    LINEA: [229, 231, 235],
    decorarPagina: () => {}, // cada modelo define cómo se pinta una hoja nueva
  };
  c.SUAVE = mezclar(c.ACENTO, c.BLANCO, 0.7);
  c.CLARO = mezclar(c.ACENTO, c.BLANCO, 0.9);

  c.nuevaPagina = () => {
    doc.addPage();
    c.decorarPagina();
    return 20;
  };

  // Escribe un párrafo con salto de línea automático y devuelve la nueva posición vertical.
  // Si "paginar" es true, pasa a otra hoja cuando se llega al final.
  c.texto = (contenido, x, y, ancho, tamano, color, estilo = "normal", interlineado = 1.4, paginar = false) => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tamano);
    const lineas = doc.splitTextToSize(limpiar(contenido), ancho);
    for (const linea of lineas) {
      if (y > c.H - 12) {
        if (!paginar) return y;
        y = c.nuevaPagina();
        doc.setFont("helvetica", estilo);
        doc.setFontSize(tamano);
      }
      doc.setTextColor(...color);
      doc.text(linea, x, y);
      y += tamano * PT * interlineado;
    }
    return y;
  };

  // Foto circular, o un círculo con las iniciales si no hay foto
  c.foto = (fotoPdf, x, y, tam, fondo, colorTexto) => {
    if (fotoPdf) {
      doc.addImage(fotoPdf, "PNG", x, y, tam, tam);
      return;
    }
    doc.setFillColor(...fondo);
    doc.circle(x + tam / 2, y + tam / 2, tam / 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(tam * 0.68);
    doc.setTextColor(...colorTexto);
    doc.text(limpiar(iniciales(d.nombre)), x + tam / 2, y + tam / 2 + tam * 0.087, { align: "center" });
  };

  // Texto centrado en la hoja (modelo Destacado)
  c.centrado = (contenido, y, tamano, color, estilo, ancho, interlineado = 1.3) => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tamano);
    doc.setTextColor(...color);
    doc.splitTextToSize(limpiar(contenido), ancho).forEach((linea) => {
      doc.text(linea, c.W / 2, y, { align: "center" });
      y += tamano * PT * interlineado;
    });
    return y;
  };

  // Título de sección como etiqueta redondeada de color con letras blancas
  c.pastilla = (texto, x, y) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const t = limpiar(texto.toUpperCase());
    doc.setFillColor(...c.ACENTO);
    doc.roundedRect(x, y - 4.4, doc.getTextWidth(t) + 7, 6.4, 3.2, 3.2, "F");
    doc.setTextColor(...c.BLANCO);
    doc.text(t, x + 3.5, y);
  };

  // Habilidades o idiomas como etiquetas redondeadas que se acomodan en filas
  c.etiquetas = (items, x, w, y, fondo, colorTexto) => {
    const TAM = 8.5, ALTO = 6, SEP = 1.8, LINEA = TAM * PT * 1.25;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TAM);
    let cx = x, altoFila = 0;
    for (const item of items) {
      const lineas = doc.splitTextToSize(limpiar(item), w - 6);
      const ancho = Math.min(w, Math.max(...lineas.map((l) => doc.getTextWidth(l))) + 6);
      const alto = ALTO + (lineas.length - 1) * LINEA;
      if (cx > x && cx + ancho > x + w) {
        cx = x;
        y += altoFila + SEP;
        altoFila = 0;
      }
      if (y + alto > c.H - 10) break;
      doc.setFillColor(...fondo);
      doc.roundedRect(cx, y, ancho, alto, 3, 3, "F");
      doc.setTextColor(...colorTexto);
      lineas.forEach((l, i) => doc.text(l, cx + 3, y + 4.1 + i * LINEA));
      cx += ancho + SEP;
      altoFila = Math.max(altoFila, alto);
    }
    return y + altoFila;
  };

  return c;
}

// Perfil, experiencia y educación.
// Opciones: listas (suma habilidades e idiomas, modelo Clásico), lineaDeTiempo (modelo Creativo)
// y titulo: "linea" (texto con raya), "pastilla" (etiqueta de color) o "cuadro" (cuadradito de color)
function flujoPrincipal(c, d, x, w, yInicial, opciones = {}) {
  const { doc } = c;
  const { listas = false, lineaDeTiempo = false, titulo: estiloTitulo = "linea" } = opciones;
  let y = yInicial;

  const asegurarEspacio = (necesario) => {
    if (y + necesario > c.H - 12) y = c.nuevaPagina();
  };

  const seccion = (titulo) => {
    asegurarEspacio(22);
    if (estiloTitulo === "pastilla") {
      c.pastilla(titulo, x, y);
      y += 9;
      return;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    if (estiloTitulo === "cuadro") {
      doc.setFillColor(...c.ACENTO);
      doc.roundedRect(x, y - 3.3, 3.4, 3.4, 0.7, 0.7, "F");
      doc.setTextColor(...c.OSCURO);
      doc.text(titulo.toUpperCase(), x + 6, y);
      y += 8;
      return;
    }
    doc.setTextColor(...c.ACENTO);
    doc.text(titulo.toUpperCase(), x, y);
    doc.setDrawColor(...c.LINEA);
    doc.setLineWidth(0.4);
    doc.line(x, y + 2.4, x + w, y + 2.4);
    y += 8.5;
  };

  const descripcion = (contenido, dx, dw) => {
    const lineas = lineasDe(contenido);
    if (lineas.length === 1) {
      y = c.texto(lineas[0], dx, y, dw, 9.5, c.GRIS, "normal", 1.45, true);
      return;
    }
    lineas.forEach((linea) => {
      asegurarEspacio(5);
      doc.setFillColor(...c.GRIS);
      doc.circle(dx + 1, y - 1.15, 0.55, "F");
      y = c.texto(linea, dx + 4, y, dw - 4, 9.5, c.GRIS, "normal", 1.45, true) + 0.6;
    });
  };

  const item = (titulo, subtitulo, detalle) => {
    asegurarEspacio(detalle ? 18 : 14);
    // En la línea de tiempo el texto se corre a la derecha para dejar lugar al punto y la raya
    const tx = lineaDeTiempo ? x + 6 : x;
    const tw = lineaDeTiempo ? w - 6 : w;
    const pagina = doc.getNumberOfPages();
    const yInicio = y;
    if (lineaDeTiempo) {
      doc.setFillColor(...c.ACENTO);
      doc.circle(x + 1.6, y - 1.4, 1.4, "F");
      doc.setFillColor(...c.BLANCO);
      doc.circle(x + 1.6, y - 1.4, 0.55, "F");
    }
    y = c.texto(titulo, tx, y, tw, 11, c.OSCURO, "bold", 1.35, true);
    if (subtitulo) y = c.texto(subtitulo, tx, y, tw, 9, c.ACENTO, "normal", 1.4, true);
    if (detalle) {
      y += 1;
      descripcion(detalle, tx, tw);
    }
    y += 4.5;
    if (lineaDeTiempo && doc.getNumberOfPages() === pagina) {
      doc.setDrawColor(...c.SUAVE);
      doc.setLineWidth(0.5);
      doc.line(x + 1.6, yInicio + 0.6, x + 1.6, y - 3.4);
    }
  };

  if (d.perfil) {
    seccion("Perfil");
    y = c.texto(d.perfil.replace(/\s*\n\s*/g, " "), x, y, w, 9.5, c.GRIS, "normal", 1.5, true) + 5;
  }

  if (d.experiencia.length) {
    seccion("Experiencia laboral");
    d.experiencia.forEach((e) =>
      item(e.puesto || "Puesto", subtituloTrabajo(e), e.descripcion)
    );
    y += 1;
  }

  if (d.educacion.length) {
    seccion("Educación");
    d.educacion.forEach((e) =>
      item(e.titulo || "Título", [e.institucion, periodo(e, "En curso")].filter(Boolean).join("  ·  "), "")
    );
    y += 1;
  }

  if (listas) {
    [["Habilidades", d.listaHabilidades], ["Idiomas", d.listaIdiomas]].forEach(([titulo, items]) => {
      if (!items.length) return;
      seccion(titulo);
      y = c.texto(items.join("  ·  "), x, y, w, 9.5, c.GRIS, "normal", 1.5, true) + 5;
    });
  }
}

// Contacto, habilidades e idiomas en una columna angosta.
// "colores" define los tonos; además acepta: pastilla (títulos en etiqueta), chip y chipTexto
// (habilidades como etiquetas), idiomasEnLista (idiomas con viñetas) y sinContacto.
function columnaLateral(c, d, x, w, yInicial, colores) {
  const { doc } = c;
  let y = yInicial;

  const titulo = (texto) => {
    if (y > c.H - 30) return false;
    if (colores.pastilla) {
      c.pastilla(texto, x, y);
      y += 9;
      return true;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...colores.titulo);
    doc.text(texto.toUpperCase(), x, y);
    doc.setDrawColor(...colores.linea);
    doc.setLineWidth(0.3);
    doc.line(x, y + 2.2, x + w, y + 2.2);
    y += 8;
    return true;
  };

  const lista = (items) => {
    items.forEach((item) => {
      if (y > c.H - 12) return;
      doc.setFillColor(...colores.vineta);
      doc.circle(x + 0.8, y - 1.1, 0.6, "F");
      y = c.texto(item, x + 3.5, y, w - 3.5, 9, colores.valor, "normal", 1.35) + 1.2;
    });
    y += 5;
  };

  const etiquetas = (items) => {
    y = c.etiquetas(items, x, w, y - 4.2, colores.chip, colores.chipTexto) + 9;
  };

  const contacto = colores.sinContacto ? [] : contactoDe(d);
  if (contacto.length && titulo("Contacto")) {
    contacto.forEach(([etiqueta, valor]) => {
      y = c.texto(etiqueta, x, y, w, 7.5, colores.etiqueta, "bold", 1.3);
      y = c.texto(valor, x, y, w, 9, colores.valor, "normal", 1.35) + 2.5;
    });
    y += 4;
  }
  // En Destacado (sinContacto) los datos personales van en el encabezado, junto al contacto
  const personales = colores.sinContacto ? [] : datosPersonalesDe(d);
  if (personales.length && titulo("Datos personales")) {
    personales.forEach(([etiqueta, valor]) => {
      y = c.texto(etiqueta, x, y, w, 7.5, colores.etiqueta, "bold", 1.3);
      y = c.texto(valor, x, y, w, 9, colores.valor, "normal", 1.35) + 2.5;
    });
    y += 4;
  }
  if (d.listaHabilidades.length && titulo("Habilidades")) (colores.chip ? etiquetas : lista)(d.listaHabilidades);
  if (d.listaIdiomas.length && titulo("Idiomas")) (colores.chip && !colores.idiomasEnLista ? etiquetas : lista)(d.listaIdiomas);
}

// Modelo Moderno: columna de color a la izquierda
function pdfModerno(c, d, fotoPdf) {
  const { doc } = c;
  const LATERAL = 68, FOTO = 38;
  c.decorarPagina = () => {
    doc.setFillColor(...c.ACENTO);
    doc.rect(0, 0, LATERAL, c.H, "F");
  };
  c.decorarPagina();

  c.foto(fotoPdf, (LATERAL - FOTO) / 2, 16, FOTO, c.BLANCO, c.ACENTO);
  columnaLateral(c, d, 10, LATERAL - 20, 16 + FOTO + 12, {
    titulo: c.BLANCO, linea: c.SUAVE, etiqueta: c.SUAVE, valor: c.BLANCO, vineta: c.BLANCO,
  });

  const x = LATERAL + 12, w = c.W - x - 12;
  let y = c.texto(d.nombre, x, 26, w, 24, c.OSCURO, "bold", 1.15, true);
  if (d.puesto) y = c.texto(d.puesto, x, y + 1, w, 12.5, c.ACENTO, "normal", 1.3, true);
  flujoPrincipal(c, d, x, w, y + 6);
}

// Modelo Clásico: una sola columna con barra de color arriba
function pdfClasico(c, d, fotoPdf) {
  const { doc } = c;
  const M = 18, w = c.W - M * 2, FOTO = 28, Y_FOTO = 16;
  c.decorarPagina = () => {
    doc.setFillColor(...c.ACENTO);
    doc.rect(0, 0, c.W, 3, "F");
  };
  c.decorarPagina();

  let x = M;
  if (fotoPdf) {
    doc.addImage(fotoPdf, "PNG", M, Y_FOTO, FOTO, FOTO);
    x = M + FOTO + 8;
  }
  const anchoTexto = c.W - M - x;
  let y = c.texto(d.nombre, x, 27, anchoTexto, 22, c.OSCURO, "bold", 1.15);
  if (d.puesto) y = c.texto(d.puesto, x, y + 0.5, anchoTexto, 12, c.ACENTO, "normal", 1.3);
  const contacto = contactoDe(d).map(([, v]) => v).join("   |   ");
  if (contacto) y = c.texto(contacto, x, y + 1.5, anchoTexto, 9, c.GRIS, "normal", 1.4);
  const personales = datosPersonalesDe(d).map(([k, v]) => `${k}: ${v}`).join("   |   ");
  if (personales) y = c.texto(personales, x, y + 0.5, anchoTexto, 9, c.GRIS, "normal", 1.4);

  y = Math.max(y, fotoPdf ? Y_FOTO + FOTO + 4 : 0) + 2;
  doc.setDrawColor(...c.ACENTO);
  doc.setLineWidth(0.6);
  doc.line(M, y, M + w, y);
  flujoPrincipal(c, d, M, w, y + 10, { listas: true });
}

// Modelo Ejecutivo: encabezado de color y columna clara a la derecha
function pdfEjecutivo(c, d, fotoPdf) {
  const { doc } = c;
  const CABECERA = 52, COLUMNA = 138, FOTO = 34;
  const pintarColumna = (desde) => {
    doc.setFillColor(...c.CLARO);
    doc.rect(COLUMNA, desde, c.W - COLUMNA, c.H - desde, "F");
  };
  c.decorarPagina = () => pintarColumna(0);

  doc.setFillColor(...c.ACENTO);
  doc.rect(0, 0, c.W, CABECERA, "F");
  pintarColumna(CABECERA);

  c.foto(fotoPdf, 16, (CABECERA - FOTO) / 2, FOTO, c.BLANCO, c.ACENTO);
  const x = 16 + FOTO + 10, anchoTexto = c.W - x - 16;
  const y = c.texto(d.nombre, x, 25, anchoTexto, 24, c.BLANCO, "bold", 1.15);
  if (d.puesto) c.texto(d.puesto, x, y + 1, anchoTexto, 12.5, c.SUAVE, "normal", 1.3);

  columnaLateral(c, d, COLUMNA + 7, c.W - COLUMNA - 14, CABECERA + 14, {
    titulo: c.ACENTO, linea: mezclar(c.ACENTO, c.BLANCO, 0.55), etiqueta: c.ACENTO, valor: c.OSCURO, vineta: c.ACENTO,
  });
  flujoPrincipal(c, d, 16, COLUMNA - 16 - 10, CABECERA + 14);
}

// Modelo Creativo: encabezado de color con corte en diagonal, foto con aro blanco y línea de tiempo
function pdfCreativo(c, d, fotoPdf) {
  const { doc } = c;
  const FOTO = 36, fx = c.W - 16 - FOTO, fy = 8;
  doc.setFillColor(...c.ACENTO);
  doc.rect(0, 0, c.W, 48, "F");
  doc.triangle(0, 48, c.W, 48, 0, 60, "F");

  doc.setFillColor(...c.BLANCO);
  doc.circle(fx + FOTO / 2, fy + FOTO / 2, FOTO / 2 + 1.5, "F");
  c.foto(fotoPdf, fx, fy, FOTO, c.BLANCO, c.ACENTO);

  const anchoTexto = fx - 16 - 8;
  const y = c.texto(d.nombre, 16, 24, anchoTexto, 26, c.BLANCO, "bold", 1.1);
  if (d.puesto) c.texto(d.puesto, 16, y + 1, anchoTexto, 13, c.SUAVE, "normal", 1.3);

  columnaLateral(c, d, 142, 52, 76, {
    titulo: c.ACENTO, linea: mezclar(c.ACENTO, c.BLANCO, 0.55), etiqueta: c.ACENTO, valor: c.OSCURO, vineta: c.ACENTO,
    chip: c.CLARO, chipTexto: c.ACENTO,
  });
  flujoPrincipal(c, d, 16, 116, 76, { lineaDeTiempo: true });
}

// Modelo Elegante: columna oscura con aro de color en la foto y títulos con cuadradito de color
function pdfElegante(c, d, fotoPdf) {
  const { doc } = c;
  const PIZARRA = [30, 41, 59], LATERAL = 70, FOTO = 38, fx = (LATERAL - FOTO) / 2, fy = 16;
  const ACENTO_CLARO = mezclar(c.ACENTO, c.BLANCO, 0.45);
  c.decorarPagina = () => {
    doc.setFillColor(...PIZARRA);
    doc.rect(0, 0, LATERAL, c.H, "F");
  };
  c.decorarPagina();

  doc.setFillColor(...c.ACENTO);
  doc.circle(fx + FOTO / 2, fy + FOTO / 2, FOTO / 2 + 1.2, "F");
  c.foto(fotoPdf, fx, fy, FOTO, [51, 65, 85], c.BLANCO);
  columnaLateral(c, d, 10, LATERAL - 20, fy + FOTO + 12, {
    titulo: ACENTO_CLARO, linea: [71, 85, 105], etiqueta: [148, 163, 184], valor: c.BLANCO, vineta: ACENTO_CLARO,
    chip: [51, 65, 85], chipTexto: c.BLANCO, idiomasEnLista: true,
  });

  const x = LATERAL + 12, w = c.W - x - 12;
  let y = c.texto(d.nombre, x, 28, w, 26, c.OSCURO, "bold", 1.1, true);
  if (d.puesto) y = c.texto(d.puesto, x, y + 1, w, 12.5, c.ACENTO, "normal", 1.3, true);
  doc.setFillColor(...c.ACENTO);
  doc.roundedRect(x, y + 0.5, 22, 1.4, 0.7, 0.7, "F");
  flujoPrincipal(c, d, x, w, y + 12, { titulo: "cuadro" });
}

// Modelo Destacado: círculos decorativos, foto y nombre centrados, títulos en etiquetas de color
function pdfDestacado(c, d, fotoPdf) {
  const { doc } = c;
  const FOTO = 34, fx = (c.W - FOTO) / 2, fy = 14;
  doc.setFillColor(...c.CLARO);
  doc.circle(c.W - 8, 8, 42, "F");
  doc.circle(8, c.H - 4, 30, "F");

  doc.setFillColor(...c.ACENTO);
  doc.circle(c.W / 2, fy + FOTO / 2, FOTO / 2 + 1.3, "F");
  c.foto(fotoPdf, fx, fy, FOTO, c.BLANCO, c.ACENTO);

  let y = c.centrado(d.nombre, fy + FOTO + 11, 22, c.OSCURO, "bold", 170, 1.15);
  if (d.puesto) y = c.centrado(d.puesto, y + 0.5, 12, c.ACENTO, "normal", 170, 1.3);
  const contacto = contactoDe(d).map(([, v]) => v).join("   ·   ");
  if (contacto) y = c.centrado(contacto, y + 1.5, 8.5, c.GRIS, "normal", 178, 1.4);
  const personales = datosPersonalesDe(d).map(([k, v]) => `${k}: ${v}`).join("   ·   ");
  if (personales) y = c.centrado(personales, y + 0.5, 8.5, c.GRIS, "normal", 178, 1.4);
  y += 9;

  columnaLateral(c, d, 146, 48, y, {
    pastilla: true, sinContacto: true, valor: c.GRIS, vineta: c.ACENTO,
    chip: mezclar(c.ACENTO, c.BLANCO, 0.82), chipTexto: mezclar(c.ACENTO, [0, 0, 0], 0.2),
  });
  flujoPrincipal(c, d, 16, 120, y, { titulo: "pastilla" });
}

async function generarPDF() {
  const d = leerDatos();

  if (!d.nombre) {
    $("nombre").closest("label").classList.add("has-error");
    $("nombre").scrollIntoView({ behavior: "smooth", block: "center" });
    $("nombre").focus({ preventScroll: true });
    return mostrarAviso("Falta tu nombre para generar el CV.", true);
  }

  if (!validarNacimiento()) {
    $("campo-nacimiento").scrollIntoView({ behavior: "smooth", block: "center" });
    return mostrarAviso("Completá mes y año de nacimiento, o dejá los dos vacíos.", true);
  }

  const conError = [...form.querySelectorAll(".item")].filter((item) => !validarFechas(item));
  if (conError.length) {
    conError[0].scrollIntoView({ behavior: "smooth", block: "center" });
    return mostrarAviso("Revisá las fechas marcadas en rojo.", true);
  }

  await descargarPDF(d, fotoCuadrada, document.querySelectorAll(".btn-pdf"));
}

// Arma el PDF con los datos "d" y lo descarga. "botones" se deshabilitan mientras se genera.
async function descargarPDF(d, fotoSrc, botones) {
  if (!window.jspdf) {
    return mostrarAviso("No se pudo cargar el generador de PDF. Revisá tu conexión y recargá la página.", true);
  }

  const textosOriginales = [...botones].map((b) => b.textContent);
  botones.forEach((b) => { b.disabled = true; b.textContent = "Generando..."; });

  try {
    // Si la foto no se puede usar (por ejemplo, sin conexión), se ponen las iniciales
    const fotoPdf = fotoSrc ? await fotoCircular(fotoSrc).catch(() => null) : null;
    const c = crearPdf(d);
    const dibujar = {
      clasico: pdfClasico, ejecutivo: pdfEjecutivo, creativo: pdfCreativo, elegante: pdfElegante, destacado: pdfDestacado,
    }[d.modelo] || pdfModerno;
    dibujar(c, d, fotoPdf);

    const nombreArchivo = "CV-" + d.nombre
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    c.doc.save(`${nombreArchivo || "mi-cv"}.pdf`);
    mostrarAviso("¡Listo! Tu CV se descargó.");
  } catch (error) {
    console.error(error);
    mostrarAviso("Algo salió mal al generar el PDF. Probá de nuevo.", true);
  } finally {
    botones.forEach((b, i) => { b.disabled = false; b.textContent = textosOriginales[i]; });
  }
}

document.querySelectorAll(".btn-pdf").forEach((b) => b.addEventListener("click", generarPDF));

/* ---------- Inicio ---------- */
renderVistaPrevia(datosDe(EJEMPLO, "#0369a1", "moderno"), $("cv-ejemplo"), FOTO_EJEMPLO);
mostrarMuestra();
try { localStorage.removeItem(CLAVE_BORRADOR_VIEJA); } catch { /* sin acceso al almacenamiento */ }
if (restaurarBorrador()) mostrarAviso("Recuperamos tu borrador. Seguí donde lo dejaste.");
else empezarDeCero();
actualizar();

// Si se cierra la pestaña o se pasa a otra app justo después de escribir, guardamos ya
window.addEventListener("pagehide", () => temporizadorGuardado && guardarBorrador());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && temporizadorGuardado) guardarBorrador();
});
