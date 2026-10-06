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
//#region src/embed/styles.ts
var o = "\n:host { display: block; background: var(--pf-bg, transparent); color: var(--pf-text, currentColor); font-family: var(--pf-font, inherit); }\n* { box-sizing: border-box; }\n.day { margin: 0 0 calc(var(--pf-gap, 8px) * 3); }\n.day-heading { font-family: var(--pf-heading-font, inherit); text-transform: var(--pf-heading-transform, none); font-size: 1.125em; margin: 0 0 var(--pf-gap, 8px); }\n.grid { display: grid; gap: var(--pf-gap, 8px); grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--pf-columns-min, 280px)), 1fr)); }\n.photo { margin: 0; }\n.open { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }\n.open:focus-visible { outline: 2px solid var(--pf-accent, currentColor); outline-offset: 2px; }\n.open img { display: block; width: 100%; height: auto; border-radius: var(--pf-radius, 0); }\n.caption { margin-top: 4px; font-size: .9em; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }\n.status { padding: 16px 0; text-align: center; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }\n.retry { margin-left: 8px; font: inherit; color: var(--pf-accent, currentColor); background: none; border: 1px solid currentColor; border-radius: var(--pf-radius, 0); padding: 4px 12px; cursor: pointer; }\n.sentinel { height: 1px; }\n.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--pf-overlay-bg, rgba(0,0,0,.92)); color: #fff; display: flex; align-items: center; justify-content: center; touch-action: pan-y; }\n.overlay[hidden] { display: none; }\n.overlay figure { margin: 0; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; align-items: center; }\n.viewer-img { max-width: 100vw; max-height: calc(100vh - 64px); width: auto; height: auto; object-fit: contain; }\n.viewer-caption { padding: 8px 16px; text-align: center; }\n.overlay button { position: absolute; font: inherit; font-size: 32px; line-height: 1; color: #fff; background: rgba(0,0,0,.4); border: 0; width: 48px; height: 48px; cursor: pointer; }\n.overlay button:disabled { opacity: .3; cursor: default; }\n.overlay button:focus-visible { outline: 2px solid #fff; }\n.close { top: 8px; right: 8px; }\n.prev { left: 8px; top: 50%; transform: translateY(-50%); }\n.next { right: 8px; top: 50%; transform: translateY(-50%); }\n", s = 50;
function c(e, t, n) {
	let r = document.createElement("button");
	return r.type = "button", r.className = e, r.setAttribute("aria-label", t), r.textContent = n, r;
}
var l = class {
	element = document.createElement("div");
	#e = document.createElement("img");
	#t = document.createElement("figcaption");
	#n = c("close", "Close", "✕");
	#r = c("prev", "Previous photo", "‹");
	#i = c("next", "Next photo", "›");
	#a = -1;
	#o = null;
	#s = !1;
	#c = "";
	root;
	src;
	constructor(e, t) {
		this.root = e, this.src = t;
		let n = this.element;
		n.className = "overlay", n.hidden = !0, n.tabIndex = -1, n.setAttribute("role", "dialog"), n.setAttribute("aria-modal", "true"), n.setAttribute("aria-label", "Photo viewer"), this.#e.className = "viewer-img", this.#t.className = "viewer-caption";
		let r = document.createElement("figure");
		r.append(this.#e, this.#t), n.append(r, this.#r, this.#i, this.#n), this.#n.addEventListener("click", () => this.close()), this.#r.addEventListener("click", () => void this.step(-1)), this.#i.addEventListener("click", () => void this.step(1)), n.addEventListener("click", (e) => {
			if (this.#s) {
				this.#s = !1;
				return;
			}
			e.target === n && this.close();
		}), n.addEventListener("keydown", (e) => this.#u(e)), n.addEventListener("pointerdown", (e) => {
			this.#o = e.clientX, this.#s = !1, e.target instanceof HTMLButtonElement || n.focus({ preventScroll: !0 });
		}), n.addEventListener("pointerup", (e) => {
			if (this.#o === null) return;
			let t = e.clientX - this.#o;
			this.#o = null, Math.abs(t) > s && (this.#s = !0, this.step(t < 0 ? 1 : -1));
		}), n.addEventListener("pointercancel", () => this.#o = null);
	}
	get isOpen() {
		return this.#a >= 0;
	}
	open(e) {
		this.#a = e, this.element.hidden = !1, this.#c = document.documentElement.style.overflow, document.documentElement.style.overflow = "hidden", this.#l(), this.#n.focus();
	}
	dismiss() {
		this.close(!1);
	}
	close(e = !0) {
		if (!this.isOpen) return;
		let t = this.#a;
		this.#a = -1, this.element.hidden = !0, document.documentElement.style.overflow = this.#c, e && this.src.opener(t)?.focus();
	}
	async step(e) {
		let t = this.#a + e;
		!this.isOpen || t < 0 || t >= this.src.count() && (!this.src.hasMore() || (await this.src.loadMore(), !this.isOpen || t >= this.src.count())) || (this.#a = t, this.#l());
	}
	#l() {
		let e = this.src.photo(this.#a);
		if (!e) return;
		let n = this.#e;
		n.removeAttribute("srcset"), n.width = e.width, n.height = e.height, n.alt = e.caption ?? "Construction progress photo", n.sizes = "100vw", n.srcset = t(e.srcset), n.src = r(e.srcset), this.#t.textContent = e.caption ?? "";
		let i = this.#a === 0, a = this.#a >= this.src.count() - 1 && !this.src.hasMore(), o = this.root.activeElement;
		(i && o === this.#r || a && o === this.#i) && this.#n.focus(), this.#r.disabled = i, this.#i.disabled = a;
	}
	#u(e) {
		if (e.key === "Escape") e.preventDefault(), this.close();
		else if (e.key === "ArrowRight") e.preventDefault(), this.step(1);
		else if (e.key === "ArrowLeft") e.preventDefault(), this.step(-1);
		else if (e.key === "Tab") {
			let t = [
				this.#r,
				this.#i,
				this.#n
			].filter((e) => !e.disabled), n = t[0], r = t[t.length - 1], i = this.root.activeElement;
			e.shiftKey && i === n ? (e.preventDefault(), r?.focus()) : !e.shiftKey && i === r ? (e.preventDefault(), n?.focus()) : t.includes(i) || (e.preventDefault(), n?.focus());
		}
	}
}, u = new URL(import.meta.url).origin, d = "(min-width: 1200px) 400px, (min-width: 640px) 50vw, 100vw";
function f(e, t) {
	let n = document.createElement(e);
	return n.className = t, n;
}
var p = class extends HTMLElement {
	#e = this.attachShadow({ mode: "open" });
	#t = f("div", "days");
	#n = f("div", "status");
	#r = f("div", "sentinel");
	#i = [];
	#a = [];
	#o = null;
	#s = null;
	#c = !1;
	#l = null;
	#u = !1;
	#d = !1;
	#f = !1;
	#p = new IntersectionObserver((e) => {
		this.#f = e.some((e) => e.isIntersecting), this.#f && !this.#d && this.loadMore();
	}, { rootMargin: "800px 0px" });
	#m = new l(this.#e, {
		count: () => this.#i.length,
		photo: (e) => this.#i[e],
		hasMore: () => !this.#u,
		loadMore: () => this.loadMore(),
		opener: (e) => this.#a[e]
	});
	connectedCallback() {
		if (!this.#c) {
			this.#c = !0, this.#n.setAttribute("role", "status");
			let e = document.createElement("style");
			e.textContent = o, this.#e.append(e, this.#t, this.#n, this.#r, this.#m.element), this.loadMore();
		}
		this.#p.observe(this.#r);
	}
	disconnectedCallback() {
		this.#p.disconnect(), this.#m.dismiss();
	}
	loadMore() {
		if (this.#l) return this.#l;
		if (this.#u) return Promise.resolve();
		let e = this.#h().finally(() => {
			this.#l === e && (this.#l = null), !this.#u && !this.#d && this.#f && this.loadMore();
		});
		return this.#l = e, e;
	}
	async #h() {
		let e = this.getAttribute("project");
		if (!e) {
			this.#d = !0, this.#_();
			return;
		}
		this.#d = !1, this.#g("Loading photos…");
		try {
			let t = new URL(`/api/feed/${encodeURIComponent(e)}`, u);
			this.#s && t.searchParams.set("cursor", this.#s);
			let n = await fetch(t);
			if (!n.ok) throw Error(`HTTP ${n.status}`);
			let r = await n.json();
			for (let e of r.photos) this.#v(e);
			this.#s = r.nextCursor, this.#u = r.nextCursor === null, this.#u ? this.#g(this.#i.length === 0 ? "No photos yet." : "That's the beginning", this.#i.length > 0) : this.#g("");
		} catch {
			this.#d = !0, this.#_();
			return;
		}
	}
	#g(e, t = !1) {
		this.#n.className = t ? "status end" : "status", this.#n.textContent = e;
	}
	#_() {
		let e = f("button", "retry");
		e.type = "button", e.textContent = "Retry", e.addEventListener("click", () => void this.loadMore()), this.#n.className = "status error", this.#n.replaceChildren("Couldn't load photos", e);
	}
	#v(e) {
		let r = i(e.takenAt);
		if (this.#o?.key !== r) {
			let e = f("section", "day"), t = f("h2", "day-heading");
			t.textContent = a(r);
			let n = f("div", "grid");
			e.append(t, n), this.#t.append(e), this.#o = {
				key: r,
				grid: n
			};
		}
		let o = this.#i.length;
		this.#i.push(e);
		let s = document.createElement("img");
		s.loading = "lazy", s.decoding = "async", s.width = e.width, s.height = e.height, s.alt = e.caption ?? "Construction progress photo", s.sizes = d, s.srcset = t(e.srcset), s.src = n(e.srcset);
		let c = f("button", "open");
		c.type = "button", c.append(s), c.addEventListener("click", () => this.#m.open(o)), this.#a.push(c);
		let l = f("figure", "photo");
		if (l.append(c), e.caption) {
			let t = f("figcaption", "caption");
			t.textContent = e.caption, l.append(t);
		}
		this.#o.grid.append(l);
	}
};
customElements.get("progress-feed") || customElements.define("progress-feed", p);
//#endregion
export { p as ProgressFeed };
