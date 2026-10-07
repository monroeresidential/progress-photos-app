//#region src/shared/srcset.ts
var e = (e) => Object.entries(e).map(([e, t]) => [Number(e), t]).sort((e, t) => e[0] - t[0]);
function t(t) {
	return e(t).map(([e, t]) => `${t} ${e}w`).join(", ");
}
function n(t) {
	return e(t)[0]?.[1] ?? "";
}
function r(t) {
	let n = e(t);
	return n[n.length - 1]?.[1] ?? "";
}
//#endregion
//#region src/embed/days.ts
function i(e) {
	return e.slice(0, 10);
}
function a(e, t) {
	return new Intl.DateTimeFormat(t, {
		dateStyle: "long",
		timeZone: "UTC"
	}).format(/* @__PURE__ */ new Date(`${e}T00:00:00Z`));
}
//#endregion
//#region src/shared/alt.ts
function o(e, t, n) {
	let r = t.caption?.trim() ?? "", a = t.area?.trim() ?? "", o = [
		e,
		a !== "" && r.toLocaleLowerCase().startsWith(a.toLocaleLowerCase()) ? "" : a,
		r
	].filter((e) => e !== "");
	return o.length > 1 ? o.join(" – ") : `${e} construction progress, ${new Intl.DateTimeFormat(n ?? "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC"
	}).format(/* @__PURE__ */ new Date(`${i(t.takenAt)}T00:00:00Z`))}`;
}
//#endregion
//#region src/embed/styles.ts
var s = "\n:host { display: block; background: var(--pf-bg, transparent); color: var(--pf-text, currentColor); font-family: var(--pf-font, inherit); }\n* { box-sizing: border-box; }\n.day { margin: 0 0 calc(var(--pf-gap, 8px) * 3); }\n.day-heading { font-family: var(--pf-heading-font, inherit); text-transform: var(--pf-heading-transform, none); font-size: 1.125em; margin: 0 0 var(--pf-gap, 8px); }\n.grid { display: grid; gap: var(--pf-gap, 8px); grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--pf-columns-min, 280px)), 1fr)); }\n.photo { margin: 0; }\n.open { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }\n.open:focus-visible { outline: 2px solid var(--pf-accent, currentColor); outline-offset: 2px; }\n.open img { display: block; width: 100%; height: auto; border-radius: var(--pf-radius, 0); }\n.caption { margin-top: 4px; font-size: .9em; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }\n.status { padding: 16px 0; text-align: center; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }\n.retry { margin-left: 8px; font: inherit; color: var(--pf-accent, currentColor); background: none; border: 1px solid currentColor; border-radius: var(--pf-radius, 0); padding: 4px 12px; cursor: pointer; }\n.sentinel { height: 1px; }\n.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--pf-overlay-bg, rgba(0,0,0,.92)); color: #fff; display: flex; align-items: center; justify-content: center; touch-action: pan-y; }\n.overlay[hidden] { display: none; }\n.overlay figure { margin: 0; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; align-items: center; }\n.viewer-stage { position: relative; display: flex; justify-content: center; }\n.viewer-img { display: block; max-width: 100vw; max-height: calc(100vh - 64px); width: auto; height: auto; object-fit: contain; transition: opacity .15s; }\n.viewer-stage.loading .viewer-img { opacity: 0; transition: none; }\n.viewer-spinner { display: none; position: absolute; top: 50%; left: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px; border: 3px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; opacity: 0; }\n/* Shown only after 150 ms, so instant (cached/preloaded) steps don't flash it. */\n.viewer-stage.loading .viewer-spinner { display: block; animation: pf-spin .8s linear infinite, pf-show 0s .15s forwards; }\n@keyframes pf-spin { to { transform: rotate(360deg); } }\n@keyframes pf-show { to { opacity: 1; } }\n.viewer-caption { padding: 8px 16px; text-align: center; }\n.viewer-counter { margin-right: 12px; font-variant-numeric: tabular-nums; opacity: .75; white-space: nowrap; }\n.overlay button { position: absolute; display: flex; align-items: center; justify-content: center; padding: 0; width: 56px; height: 56px; border-radius: 50%; color: #fff; background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.35); cursor: pointer; }\n.overlay button svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }\n.overlay button:hover:not(:disabled), .overlay button:focus-visible { color: var(--pf-accent, #fff); border-color: var(--pf-accent, #fff); background: rgba(0,0,0,.75); }\n.overlay button:focus-visible { outline: 2px solid var(--pf-accent, #fff); outline-offset: 2px; }\n.overlay button:disabled { opacity: .35; cursor: default; }\n.close { top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); }\n.prev { left: max(12px, env(safe-area-inset-left)); top: 50%; transform: translateY(-50%); }\n.next { right: max(12px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); }\n", c = 50, l = "http://www.w3.org/2000/svg";
function u(e) {
	let t = document.createElementNS(l, "svg");
	t.setAttribute("viewBox", "0 0 24 24"), t.setAttribute("aria-hidden", "true");
	let n = document.createElementNS(l, "path");
	return n.setAttribute("d", e), t.append(n), t;
}
function d(e, t, n) {
	let r = document.createElement("button");
	return r.type = "button", r.className = e, r.setAttribute("aria-label", t), r.append(u(n)), r;
}
function f(e, t) {
	let n = document.createElement(e);
	return n.className = t, n;
}
var p = class {
	element = document.createElement("div");
	#e = f("div", "viewer-stage loading");
	#t = f("img", "viewer-img");
	#n = f("figcaption", "viewer-caption");
	#r = f("span", "viewer-counter");
	#i = f("span", "viewer-caption-text");
	#a = d("close", "Close", "M6 6l12 12M18 6L6 18");
	#o = d("prev", "Previous photo", "M15 5l-7 7 7 7");
	#s = d("next", "Next photo", "M9 5l7 7-7 7");
	#c = [];
	#l = 0;
	#u = -1;
	#d = null;
	#f = !1;
	#p = "";
	root;
	src;
	constructor(e, t) {
		this.root = e, this.src = t;
		let n = this.element;
		n.className = "overlay", n.hidden = !0, n.tabIndex = -1, n.setAttribute("role", "dialog"), n.setAttribute("aria-modal", "true"), n.setAttribute("aria-label", "Photo viewer"), this.#t.decoding = "async", this.#e.append(this.#t, f("span", "viewer-spinner")), this.#r.setAttribute("aria-live", "polite"), this.#n.append(this.#r, this.#i);
		let r = document.createElement("figure");
		r.append(this.#e, this.#n), n.append(r, this.#o, this.#s, this.#a), this.#a.addEventListener("click", () => this.close()), this.#o.addEventListener("click", () => void this.step(-1)), this.#s.addEventListener("click", () => void this.step(1)), n.addEventListener("click", (e) => {
			if (this.#f) {
				this.#f = !1;
				return;
			}
			e.target === n && this.close();
		}), n.addEventListener("keydown", (e) => this.#g(e)), n.addEventListener("pointerdown", (e) => {
			this.#d = e.clientX, this.#f = !1, e.target instanceof HTMLButtonElement || n.focus({ preventScroll: !0 });
		}), n.addEventListener("pointerup", (e) => {
			if (this.#d === null) return;
			let t = e.clientX - this.#d;
			this.#d = null, Math.abs(t) > c && (this.#f = !0, this.step(t < 0 ? 1 : -1));
		}), n.addEventListener("pointercancel", () => this.#d = null);
	}
	get isOpen() {
		return this.#u >= 0;
	}
	open(e) {
		this.#u = e, this.element.hidden = !1, this.#p = document.documentElement.style.overflow, document.documentElement.style.overflow = "hidden", this.#m(), this.#a.focus();
	}
	dismiss() {
		this.close(!1);
	}
	close(e = !0) {
		if (!this.isOpen) return;
		let t = this.#u;
		this.#u = -1, this.#l++, this.#e.classList.add("loading"), this.#t.removeAttribute("srcset"), this.#t.removeAttribute("src"), this.#c = [], this.element.hidden = !0, document.documentElement.style.overflow = this.#p, e && this.src.opener(t)?.focus();
	}
	async step(e) {
		let t = this.#u + e;
		!this.isOpen || t < 0 || t >= this.src.count() && (!this.src.hasMore() || (await this.src.loadMore(), !this.isOpen || t >= this.src.count())) || (this.#u = t, this.#m());
	}
	#m() {
		let e = this.src.photo(this.#u);
		if (!e) return;
		let n = ++this.#l, i = this.#t;
		this.#e.classList.add("loading"), i.removeAttribute("srcset"), i.width = e.width, i.height = e.height, i.alt = o(this.src.projectName(), e), i.sizes = "100vw", i.srcset = t(e.srcset), i.src = r(e.srcset);
		let a = () => {
			n === this.#l && this.#e.classList.remove("loading");
		};
		i.decode().then(a, a), this.#h(), this.#i.textContent = e.caption ?? "", this.#r.textContent = `${this.#u + 1} / ${this.src.count()}${this.src.hasMore() ? "+" : ""}`;
		let s = this.#u === 0, c = this.#u >= this.src.count() - 1 && !this.src.hasMore(), l = this.root.activeElement;
		(s && l === this.#o || c && l === this.#s) && this.#a.focus(), this.#o.disabled = s, this.#s.disabled = c;
	}
	#h() {
		this.#c = [this.#u - 1, this.#u + 1].flatMap((e) => {
			let n = e >= 0 ? this.src.photo(e) : void 0;
			if (!n) return [];
			let i = new Image();
			return i.decoding = "async", i.sizes = "100vw", i.srcset = t(n.srcset), i.src = r(n.srcset), [i];
		});
	}
	#g(e) {
		if (e.key === "Escape") e.preventDefault(), this.close();
		else if (e.key === "ArrowRight") e.preventDefault(), this.step(1);
		else if (e.key === "ArrowLeft") e.preventDefault(), this.step(-1);
		else if (e.key === "Tab") {
			let t = [
				this.#o,
				this.#s,
				this.#a
			].filter((e) => !e.disabled), n = t[0], r = t[t.length - 1], i = this.root.activeElement;
			e.shiftKey && i === n ? (e.preventDefault(), r?.focus()) : !e.shiftKey && i === r ? (e.preventDefault(), n?.focus()) : t.includes(i) || (e.preventDefault(), n?.focus());
		}
	}
}, m = new URL(import.meta.url).origin, h = "(min-width: 1200px) 400px, (min-width: 640px) 50vw, 100vw";
function g(e, t) {
	let n = document.createElement(e);
	return n.className = t, n;
}
var _ = class extends HTMLElement {
	#e = this.attachShadow({ mode: "open" });
	#t = "";
	#n = g("div", "days");
	#r = g("div", "status");
	#i = g("div", "sentinel");
	#a = [];
	#o = [];
	#s = null;
	#c = null;
	#l = !1;
	#u = null;
	#d = !1;
	#f = !1;
	#p = !1;
	#m = new IntersectionObserver((e) => {
		this.#p = e.some((e) => e.isIntersecting), this.#p && !this.#f && this.loadMore();
	}, { rootMargin: "800px 0px" });
	#h = new p(this.#e, {
		count: () => this.#a.length,
		photo: (e) => this.#a[e],
		hasMore: () => !this.#d,
		loadMore: () => this.loadMore(),
		opener: (e) => this.#o[e],
		projectName: () => this.#t
	});
	connectedCallback() {
		if (!this.#l) {
			this.#l = !0, this.#r.setAttribute("role", "status");
			let e = document.createElement("style");
			e.textContent = s, this.#e.append(e, this.#n, this.#r, this.#i, this.#h.element), this.loadMore();
		}
		this.#m.observe(this.#i);
	}
	disconnectedCallback() {
		this.#m.disconnect(), this.#h.dismiss();
	}
	loadMore() {
		if (this.#u) return this.#u;
		if (this.#d) return Promise.resolve();
		let e = this.#g().finally(() => {
			this.#u === e && (this.#u = null), !this.#d && !this.#f && this.#p && this.loadMore();
		});
		return this.#u = e, e;
	}
	async #g() {
		let e = this.getAttribute("project");
		if (!e) {
			this.#f = !0, this.#v();
			return;
		}
		this.#f = !1, this.#_("Loading photos…");
		try {
			let t = new URL(`/api/feed/${encodeURIComponent(e)}`, m);
			this.#c && t.searchParams.set("cursor", this.#c);
			let n = await fetch(t);
			if (!n.ok) throw Error(`HTTP ${n.status}`);
			let r = await n.json();
			this.#t = r.project.name;
			for (let e of r.photos) this.#y(e);
			this.#c = r.nextCursor, this.#d = r.nextCursor === null, this.#d ? this.#_(this.#a.length === 0 ? "No photos yet." : "That's the beginning", this.#a.length > 0) : this.#_("");
		} catch {
			this.#f = !0, this.#v();
			return;
		}
	}
	#_(e, t = !1) {
		this.#r.className = t ? "status end" : "status", this.#r.textContent = e;
	}
	#v() {
		let e = g("button", "retry");
		e.type = "button", e.textContent = "Retry", e.addEventListener("click", () => void this.loadMore()), this.#r.className = "status error", this.#r.replaceChildren("Couldn't load photos", e);
	}
	#y(e) {
		let r = i(e.takenAt);
		if (this.#s?.key !== r) {
			let e = g("section", "day"), t = g("h2", "day-heading");
			t.textContent = a(r);
			let n = g("div", "grid");
			e.append(t, n), this.#n.append(e), this.#s = {
				key: r,
				grid: n
			};
		}
		let s = this.#a.length;
		this.#a.push(e);
		let c = document.createElement("img");
		c.loading = "lazy", c.decoding = "async", c.width = e.width, c.height = e.height, c.alt = o(this.#t, e), c.sizes = h, c.srcset = t(e.srcset), c.src = n(e.srcset);
		let l = g("button", "open");
		l.type = "button", l.append(c), l.addEventListener("click", () => this.#h.open(s)), this.#o.push(l);
		let u = g("figure", "photo");
		if (u.append(l), e.caption) {
			let t = g("figcaption", "caption");
			t.textContent = e.caption, u.append(t);
		}
		this.#s.grid.append(u);
	}
};
customElements.get("progress-feed") || customElements.define("progress-feed", _);
//#endregion
export { _ as ProgressFeed };
