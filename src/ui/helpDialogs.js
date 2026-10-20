import { openModal, openInfo, makeButton } from "./modal.js";
import { createIcon } from "./icons.js";
import { APP_NAME, APP_VERSION, BUILD_DATE, CREDITS, LIBRARIES, LUAU_ENGINE, PHYSICS_ENGINE } from "../help/appInfo.js";
import { NotificationService } from "../services/notifications.js";
import { readJSON, writeJSON } from "../utils/storage.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function browserInfo() {
  const ua = navigator.userAgent || "";
  const rules = [
    [/Edg\/([\d.]+)/, "Microsoft Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  for (const [re, name] of rules) {
    const m = re.exec(ua);
    if (m) return name + " " + m[1];
  }
  return "Unknown browser";
}

function rendererInfo() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { version: "WebGL unavailable", gpu: "\u2014" };
    const version = String(gl.getParameter(gl.VERSION) || "WebGL");
    let gpu = "\u2014";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "\u2014");
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return { version, gpu };
  } catch (_) {
    return { version: "WebGL unavailable", gpu: "\u2014" };
  }
}

function infoRow(label, value) {
  const row = el("div", "rsw-about__row");
  row.appendChild(el("span", "rsw-about__key", label));
  const v = el("span", "rsw-about__val", value);
  row.appendChild(v);
  return { row, valueEl: v };
}


export function openLicensesDialog() {
  const body = el("div", "rsw-licenses");
  for (const lib of LIBRARIES) {
    const card = el("div", "rsw-licenses__card");
    const head = el("div", "rsw-licenses__head");
    head.appendChild(el("strong", "", lib.name + (lib.version && lib.version !== "bundled" ? " " + lib.version : "")));
    head.appendChild(el("span", "rsw-licenses__badge", lib.license));
    card.appendChild(head);
    card.appendChild(el("div", "rsw-licenses__role", lib.role));
    card.appendChild(el("div", "rsw-licenses__copy", lib.copyright));
    const txt = el("div", "rsw-licenses__text", lib.text);
    card.appendChild(txt);
    body.appendChild(card);
  }
  const handle = openModal({
    title: "Licenses",
    width: 560,
    className: "rsw-licenses-modal",
    body,
    footer: [makeButton("Close", "primary", () => handle.close())],
    ariaLabel: "Licenses",
  });
  return handle;
}




export function openAboutDialog() {
  const body = el("div", "rsw-about");

  const hero = el("div", "rsw-about__hero");
  const logo = el("div", "rsw-about__logo");
  logo.appendChild(createIcon("logo", 40));
  hero.appendChild(logo);
  const heroText = el("div", "rsw-about__herotext");
  heroText.appendChild(el("div", "rsw-about__name", APP_NAME));
  heroText.appendChild(el("div", "rsw-about__version", "Version " + APP_VERSION + " \u2022 Build " + BUILD_DATE));
  heroText.appendChild(el("div", "rsw-about__credits", CREDITS));
  hero.appendChild(heroText);
  body.appendChild(hero);

  const tech = el("div", "rsw-about__tech");
  tech.appendChild(el("div", "rsw-about__sectiontitle", "Technical information"));
  const rend = rendererInfo();
  tech.appendChild(infoRow("Browser", browserInfo()).row);
  tech.appendChild(infoRow("Renderer", rend.version).row);
  tech.appendChild(infoRow("GPU", rend.gpu).row);


  const threeLib = LIBRARIES.find((lib) => lib.name === "Three.js");
  const engineRow = infoRow("Engine", threeLib ? threeLib.name + " " + threeLib.version : "Three.js");
  tech.appendChild(engineRow.row);
  tech.appendChild(infoRow("Luau Engine", LUAU_ENGINE.name + " " + LUAU_ENGINE.version).row);
  tech.appendChild(infoRow("Physics Engine", PHYSICS_ENGINE.name + " " + PHYSICS_ENGINE.version).row);
  body.appendChild(tech);

  import("three")
    .then((THREE) => {
      if (THREE && THREE.REVISION) engineRow.valueEl.textContent = "Three.js r" + THREE.REVISION;
    })
    .catch(() => {});

  const licLink = el("button", "rsw-about__liclink", "View Licenses");
  licLink.type = "button";
  licLink.addEventListener("click", () => openLicensesDialog());
  body.appendChild(licLink);

  const handle = openModal({
    title: "About " + APP_NAME,
    width: 480,
    className: "rsw-about-modal",
    body,
    footer: [makeButton("Close", "primary", () => handle.close())],
    ariaLabel: "About " + APP_NAME,
  });
  return handle;
}




const BUG_KEY = "bugReports";
const BUG_LIMIT = 50;

export function openReportBugDialog() {
  const body = el("div", "rsw-bugform");

  const mkField = (labelText, node) => {
    const wrap = el("label", "rsw-bugform__field");
    wrap.appendChild(el("span", "rsw-bugform__label", labelText));
    wrap.appendChild(node);
    return wrap;
  };

  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 120;
  title.className = "rsw-bugform__input";
  title.placeholder = "Short summary of the problem";

  const category = document.createElement("select");
  category.className = "rsw-bugform__input";
  for (const c of ["Bug", "Crash", "Performance", "UI / Visual", "Other"]) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    category.appendChild(opt);
  }

  const desc = document.createElement("textarea");
  desc.rows = 5;
  desc.maxLength = 2000;
  desc.className = "rsw-bugform__input rsw-bugform__textarea";
  desc.placeholder = "What happened? What did you expect to happen?";

  const steps = document.createElement("textarea");
  steps.rows = 3;
  steps.maxLength = 1000;
  steps.className = "rsw-bugform__input rsw-bugform__textarea";
  steps.placeholder = "1. Open\u2026 2. Click\u2026 3. See error";

  body.appendChild(mkField("Title", title));
  body.appendChild(mkField("Category", category));
  body.appendChild(mkField("Description", desc));
  body.appendChild(mkField("Steps to reproduce (optional)", steps));
  body.appendChild(el("div", "rsw-bugform__note", "Reports are simulated and stored locally in your browser. Nothing is sent to any server."));

  const submit = () => {
    const t = title.value.trim();
    const d = desc.value.trim();
    if (!t || !d) {
      title.classList.toggle("is-invalid", !t);
      desc.classList.toggle("is-invalid", !d);
      return;
    }
    const raw = readJSON(BUG_KEY);
    const listItems = Array.isArray(raw) ? raw : [];
    listItems.unshift({
      id: "bug_" + Date.now().toString(36),
      time: new Date().toISOString(),
      title: t,
      category: category.value,
      description: d,
      steps: steps.value.trim(),
      version: APP_VERSION,
    });
    while (listItems.length > BUG_LIMIT) listItems.pop();
    writeJSON(BUG_KEY, listItems);
    handle.close();
    NotificationService.notify("success", "Bug report saved locally. Thank you!");
  };

  const handle = openModal({
    title: "Report a Bug",
    width: 460,
    className: "rsw-bugform-modal",
    body,
    footer: [makeButton("Cancel", "", () => handle.close()), makeButton("Submit Report", "primary", submit)],
    ariaLabel: "Report a Bug",
  });
  setTimeout(() => title.focus(), 0);
  return handle;
}


export function openCheckForUpdates() {
  openInfo({
    title: "Check for Updates",
    content: "You are using the latest version (" + APP_VERSION + ").",
  });
}
