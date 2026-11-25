import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./App.css";
import { LANGUAGES, makeT } from "./i18n.js";

/* ---------- constants & helpers ---------- */
const KEY = "votesecure_v4_state";
const LANG_KEY = "votesecure_lang";
const ADMIN = { username: "admin", password: "admin123", name: "Election Admin", phone: "9000000001" };
const DEMO_VOTER = { id: "VOTER001", password: "voter123", name: "Demo Voter", phone: "9876543210" };

// locale used by fmt(); set from the selected language on every App render
let LOCALE = "en-IN";
const toLocalInput = (ts) => { const d = new Date(ts); return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fmt = (ts) => new Date(ts).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const mask = (p) => p.slice(0, 2) + "******" + p.slice(-2);
const identityT = (k) => k;
const duration = (ms, t = identityT) => {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const [D, H, M, S] = [t("unit.d"), t("unit.h"), t("unit.m"), t("unit.s")];
  return d ? `${d}${D} ${h}${H} ${m}${M}` : h ? `${h}${H} ${m}${M} ${s % 60}${S}` : `${m}${M} ${s % 60}${S}`;
};
async function makeReceipt(voterId, cid) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${voterId}:${cid}:${Date.now()}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16).toUpperCase();
}

const seed = () => {
  const e1 = "e" + Date.now();
  return {
    voters: { [DEMO_VOTER.id]: { name: DEMO_VOTER.name, phone: DEMO_VOTER.phone, password: DEMO_VOTER.password } },
    elections: {
      [e1]: {
        id: e1,
        title: "Student Council Election",
        candidates: [
          { id: "c1", name: "Anika Rao", party: "Progress Alliance", pledge: "Free campus Wi-Fi and 24/7 library access" },
          { id: "c2", name: "Marcus Dell", party: "Student Voice", pledge: "Transparent budgets and open council meetings" },
          { id: "c3", name: "Priya Nair", party: "Green Future", pledge: "Zero-waste campus and cycle lanes" },
        ],
        votes: {}, voted: {}, announced: false, suspended: false,
        schedule: { start: Date.now() - 3600e3, end: Date.now() + 2 * 86400e3 },
      },
    },
    activeElectionId: e1,
    session: null,
  };
};

/* ---------- reducer + hooks ---------- */
function editElection(s, id, fn) {
  const el = s.elections[id];
  if (!el) return s;
  return { ...s, elections: { ...s.elections, [id]: fn(el) } };
}
function reducer(s, a) {
  switch (a.type) {
    case "REGISTER": return { ...s, voters: { ...s.voters, [a.id]: a.voter } };
    case "RESET_PASSWORD": return s.voters[a.id] ? { ...s, voters: { ...s.voters, [a.id]: { ...s.voters[a.id], password: a.password } } } : s;
    case "SYNC": return { ...a.state, session: s.session }; // state changed in another tab; keep this tab's login
    case "LOGIN": return { ...s, session: a.session };
    case "LOGOUT": return { ...s, session: null };
    case "ADD_ELECTION": {
      const id = "e" + Date.now();
      return {
        ...s,
        elections: {
          ...s.elections,
          [id]: { id, title: a.title, candidates: [], votes: {}, voted: {}, announced: false, suspended: false, schedule: { start: Date.now(), end: Date.now() + 86400e3 } },
        },
        activeElectionId: id,
      };
    }
    case "REMOVE_ELECTION": {
      const rest = { ...s.elections };
      delete rest[a.id];
      const ids = Object.keys(rest);
      return { ...s, elections: rest, activeElectionId: s.activeElectionId === a.id ? (ids[0] || null) : s.activeElectionId };
    }
    case "SET_ACTIVE_ELECTION": return { ...s, activeElectionId: a.id };
    case "ADD_CAND": return editElection(s, a.electionId, (el) => ({ ...el, candidates: [...el.candidates, { id: "c" + Date.now(), ...a.cand }] }));
    case "REMOVE_CAND": return editElection(s, a.electionId, (el) => ({ ...el, candidates: el.candidates.filter((c) => c.id !== a.id) }));
    case "SET_SCHEDULE": return editElection(s, a.electionId, (el) => ({ ...el, schedule: a.schedule }));
    case "TOGGLE_SUSPEND": return editElection(s, a.electionId, (el) => ({ ...el, suspended: !el.suspended }));
    case "ANNOUNCE": return editElection(s, a.electionId, (el) => ({ ...el, announced: a.value }));
    case "CAST_VOTE":
      return editElection(s, a.electionId, (el) => {
        if (el.voted[a.voterId] || getStatus(el, Date.now()).key !== "open") return el; // ignore votes outside the open window
        return { ...el, votes: { ...el.votes, [a.cid]: (el.votes[a.cid] || 0) + 1 }, voted: { ...el.voted, [a.voterId]: a.receipt } };
      });
    case "RESET_ELECTION": return editElection(s, a.electionId, (el) => ({ ...el, votes: {}, voted: {}, announced: false, suspended: false }));
    default: return s;
  }
}
function usePersistentReducer() {
  const [state, dispatch] = useReducer(reducer, null, () => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch {}
    return seed();
  });
  const syncing = useRef(false);
  useEffect(() => {
    if (syncing.current) { syncing.current = false; return; } // came from another tab, don't echo it back
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state]);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try { syncing.current = true; dispatch({ type: "SYNC", state: JSON.parse(e.newValue) }); } catch { syncing.current = false; }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [state, dispatch];
}

/* language is kept outside the election state so it is per-browser and never overwritten by tab sync */
function useLanguage() {
  const [lang, setLangState] = useState(() => {
    try { const l = localStorage.getItem(LANG_KEY); if (LANGUAGES.some((x) => x.code === l)) return l; } catch {}
    return "en";
  });
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {}
  }, []);
  const meta = LANGUAGES.find((x) => x.code === lang) || LANGUAGES[0];
  LOCALE = meta.locale; // used by fmt() during this render
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const t = useMemo(() => makeT(lang), [lang]);
  return { lang, setLang, t };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
function getStatus(el, now, t = identityT) {
  const { start, end } = el?.schedule || {};
  if (!el) return { key: "unset", label: t("status.na"), note: "" };
  if (!start || !end) return { key: "unset", label: t("status.unset"), note: "" };
  if (el.suspended) return { key: "paused", label: t("status.paused"), note: "" };
  if (now < start) return { key: "upcoming", label: t("status.upcoming"), note: t("status.opensIn", { d: duration(start - now, t) }) };
  if (now > end) return { key: "closed", label: t("status.closed"), note: t("status.closedAt", { t: fmt(end) }) };
  return { key: "open", label: t("status.open"), note: t("status.closesIn", { d: duration(end - now, t) }) };
}
function computeTally(el) {
  if (!el) return { total: 0, rows: [], winners: [] };
  const total = Object.values(el.votes).reduce((a, b) => a + b, 0);
  const rows = el.candidates.map((c) => ({ ...c, n: el.votes[c.id] || 0, pct: total ? Math.round(((el.votes[c.id] || 0) / total) * 100) : 0 }));
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const top = sorted[0]?.n || 0;
  const winners = total ? sorted.filter((r) => r.n === top) : [];
  return { total, rows, winners };
}
function useTally(el) {
  return useMemo(() => computeTally(el), [el]);
}

/* ---------- language switcher ---------- */
function LanguageSwitcher() {
  const { lang, setLang, t } = useApp();
  return (
    <label className="lang-switch">
      <span aria-hidden="true">🌐</span>
      <select aria-label={t("nav.language")} value={lang} onChange={(e) => setLang(e.target.value)}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}

/* ---------- live status ---------- */
function LiveStatus({ election, now, showBar = true }) {
  const { t } = useApp();
  const st = getStatus(election, now, t);
  const { start, end } = election.schedule || {};
  const pct = start && end ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : 0;
  return (
    <div className={"live " + st.key}>
      <div className="live-top">
        <span className="dot" aria-hidden="true" />
        <strong role="status">{st.label}</strong>
        {st.note && <span className="live-note">{st.note}</span>}
      </div>
      {showBar && start && end && (
        <>
          <div className="live-bar" aria-hidden="true"><div style={{ width: pct + "%" }} /></div>
          <div className="live-times small"><span>{fmt(start)}</span><span>{fmt(end)}</span></div>
        </>
      )}
    </div>
  );
}

function StatusToasts() {
  const { state, t } = useApp();
  const now = useNow();
  const prev = useRef(null);
  const [toasts, setToasts] = useState([]); // stores {id, key, title}; text is translated at render so it follows the language
  useEffect(() => {
    const next = {}, fresh = [];
    Object.values(state.elections).forEach((el) => {
      const key = getStatus(el, now).key;
      next[el.id] = key;
      const before = prev.current?.[el.id];
      if (before && before !== key && ["open", "closed", "paused"].includes(key)) fresh.push({ id: el.id + key + now, key, title: el.title });
    });
    prev.current = next;
    if (!fresh.length) return;
    setToasts((all) => [...all, ...fresh]);
    fresh.forEach((f) => setTimeout(() => setToasts((all) => all.filter((x) => x.id !== f.id)), 7000));
  }, [state.elections, now]);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="region" aria-label={t("toast.region")}>
      {toasts.map((x) => (
        <div key={x.id} className={"toast " + x.key}>
          <span>{t("toast." + x.key, { title: x.title })}</span>
          <button aria-label={t("toast.dismiss")} onClick={() => setToasts((all) => all.filter((y) => y.id !== x.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ---------- root ---------- */
export default function App() {
  const [state, dispatch] = usePersistentReducer();
  const { lang, setLang, t } = useLanguage();
  const [page, setPage] = useState("home");
  const [focusId, setFocusId] = useState(null); // election to pre-select on the results page
  const go = useCallback((p, id = null) => { setPage(p); setFocusId(id); window.scrollTo(0, 0); }, []);
  const role = state.session?.role;

  let view = <Home />;
  if (page === "login") view = <AuthPage role="voter" mode="login" />;
  else if (page === "register") view = <AuthPage role="voter" mode="register" />;
  else if (page === "reset") view = <ResetPassword />;
  else if (page === "admin-login") view = <AuthPage role="admin" mode="login" />;
  else if (page === "verify") view = <VerifyReceipt />;
  else if (page === "results") view = <ResultsPage />;
  else if (page === "dashboard" && role === "admin") view = <AdminPanel />;
  else if (page === "dashboard" && role === "voter") view = <VoterDashboard />;

  return (
    <Ctx.Provider value={{ state, dispatch, go, page, focusId, lang, setLang, t }}>
      <Header />
      {view}
      <StatusToasts />
    </Ctx.Provider>
  );
}

function Header() {
  const { state, dispatch, go, page, t } = useApp();
  const me = state.session;
  const [open, setOpen] = useState(false);
  const announced = Object.values(state.elections).filter((el) => el.announced).length;
  const nav = (p) => { setOpen(false); go(p); };
  const link = (p, label, badge) => (
    <button key={p} className={"navlink" + (page === p ? " active" : "")} aria-current={page === p ? "page" : undefined} onClick={() => nav(p)}>
      {label}{badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );
  return (
    <header className="top">
      <button className="brand" onClick={() => nav("home")} aria-label={t("nav.homeAria")}>
        <span className="logo" aria-hidden="true">✓</span>VoteSecure
      </button>
      <button className="burger" aria-label={t("nav.menu")} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "✕" : "☰"}</button>
      <nav className={open ? "open" : ""} aria-label={t("nav.main")}>
        <div className="navlinks">
          {link("home", t("nav.home"))}
          {link("results", t("nav.results"), announced)}
          {link("verify", t("nav.verify"))}
          {me && link("dashboard", me.role === "admin" ? t("nav.adminPanel") : t("nav.myElections"))}
        </div>
        <div className="navauth">
          <LanguageSwitcher />
          {me ? (
            <>
              <span className="who">{me.name} ({t("role." + me.role)})</span>
              <button className="ghost light" onClick={() => { setOpen(false); dispatch({ type: "LOGOUT" }); go("home"); }}>{t("nav.logout")}</button>
            </>
          ) : (
            <>
              <button className="ghost light" onClick={() => nav("login")}>{t("nav.login")}</button>
              <button className="ghost light" onClick={() => nav("register")}>{t("nav.register")}</button>
              <button className="ghost light" onClick={() => nav("admin-login")}>{t("nav.admin")}</button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

/* ---------- home ---------- */
function Home() {
  const { state, go, t } = useApp();
  const now = useNow();
  const elections = Object.values(state.elections);
  const announcedElections = elections.filter((el) => el.announced);
  const openCount = elections.filter((el) => getStatus(el, now).key === "open").length;
  const features = [1, 2, 3, 4, 5, 6, 7].map((i) => [t(`f${i}.t`), t(`f${i}.d`)]);
  return (
    <main>
      <section className="hero">
        <div>
          <span className="eyebrow">{t("home.eyebrow")}</span>
          <h1>{t("home.h1")}</h1>
          <p className="lede">{t("home.lede")}</p>
          <div className="cta">
            <button className="primary" onClick={() => go("login")}>{t("nav.login")}</button>
            <button className="secondary" onClick={() => go("register")}>{t("nav.register")}</button>
            <button className="ghost" onClick={() => go("results")}>{t("home.viewResults")}</button>
            <button className="ghost" onClick={() => go("verify")}>{t("nav.verify")}</button>
          </div>
        </div>
        <aside className="status-card">
          <h2>{t("home.running")}</h2>
          <p className="big">{elections.length}</p>
          <p className="small">{t("home.registered", { n: Object.keys(state.voters).length })}</p>
          <p className="live-count"><span className={"dot" + (openCount ? " on" : "")} aria-hidden="true" />{t("home.openNow", { n: openCount })}</p>
          {elections.length > 0 && (
            <ul className="election-mini-list">
              {elections.map((el) => {
                const st = getStatus(el, now, t);
                return (
                  <li key={el.id}>
                    <span>{el.title}</span>
                    <span className={"pill " + st.key}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </section>

      <section className="band">
        <div className="band-head">
          <h2>{t("home.latest")}</h2>
          <button className="link" onClick={() => go("results")}>{t("home.seeAll")}</button>
        </div>
        {announcedElections.length === 0 ? (
          <p className="notice">{t("home.noResults")}</p>
        ) : (
          <div className="demo-grid">
            {announcedElections.map((el) => {
              const tl = computeTally(el);
              return (
                <div className="demo" key={el.id}>
                  <h3>{el.title}</h3>
                  <span className="pill closed">{t("home.announced")}</span>
                  <p className="small">{tl.total ? `${tl.winners.length > 1 ? t("home.tie") : t("home.winner")}: ${tl.winners.map((w) => w.name).join(" & ")}` : t("home.noVotesCast")}</p>
                  <p className="small">{t("home.votesCast", { n: tl.total })}</p>
                  <button className="primary" onClick={() => go("results", el.id)}>{t("home.viewFull")}</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="band">
        <h2>{t("home.whatTitle")}</h2>
        <dl className="features">
          {features.map(([ti, d]) => (<div key={ti}><dt>{ti}</dt><dd>{d}</dd></div>))}
        </dl>
      </section>

      <section className="band">
        <h2>{t("home.howTitle")}</h2>
        <ol className="steps">
          {[1, 2, 3, 4].map((i) => <li key={i}>{t("how." + i)}</li>)}
        </ol>
      </section>

      <section className="band" id="demo">
        <h2>{t("home.demoTitle")}</h2>
        <p className="sub">{t("home.demoSub")}</p>
        <div className="demo-grid">
          <div className="demo"><h3>{t("demo.voter")}</h3><p>{t("demo.voterId")}: <b>{DEMO_VOTER.id}</b></p><p>{t("demo.password")}: <b>{DEMO_VOTER.password}</b></p><p>{t("demo.name")}: <b>{DEMO_VOTER.name}</b></p><p>{t("demo.phone")}: <b>{DEMO_VOTER.phone}</b></p><button className="primary" onClick={() => go("login")}>{t("demo.goVoter")}</button></div>
          <div className="demo"><h3>{t("demo.admin")}</h3><p>{t("demo.username")}: <b>{ADMIN.username}</b></p><p>{t("demo.password")}: <b>{ADMIN.password}</b></p><p>{t("demo.name")}: <b>{ADMIN.name}</b></p><p>{t("demo.phone")}: <b>{ADMIN.phone}</b></p><button className="primary" onClick={() => go("admin-login")}>{t("demo.goAdmin")}</button></div>
          <div className="demo"><h3>{t("demo.newVoter")}</h3><p>{t("demo.newDesc")}</p><button className="secondary" onClick={() => go("register")}>{t("nav.register")}</button></div>
        </div>
      </section>
      <footer className="foot">
        <nav className="foot-links" aria-label="Footer">
          <button className="link" onClick={() => go("home")}>{t("nav.home")}</button>
          <button className="link" onClick={() => go("results")}>{t("nav.results")}</button>
          <button className="link" onClick={() => go("verify")}>{t("nav.verify")}</button>
          <button className="link" onClick={() => go("login")}>{t("foot.voterLogin")}</button>
          <button className="link" onClick={() => go("admin-login")}>{t("nav.admin")}</button>
        </nav>
        {t("foot.text")}
      </footer>
    </main>
  );
}

/* ---------- auth + otp ---------- */
function OtpStep({ phone, onVerified, onBack }) {
  const { t } = useApp();
  const gen = () => String(Math.floor(100000 + Math.random() * 900000));
  const [otp, setOtp] = useState(gen);
  const [expires, setExpires] = useState(Date.now() + 120000);
  const [input, setInput] = useState("");
  const [err, setErr] = useState(""); // holds a translation key so the message follows the language
  const now = useNow();
  const left = Math.max(0, Math.ceil((expires - now) / 1000));
  const resend = () => { setOtp(gen()); setExpires(Date.now() + 120000); setInput(""); setErr(""); };
  const verify = (e) => {
    e.preventDefault();
    if (left === 0) return setErr("otp.expiredErr");
    if (input !== otp) return setErr("otp.wrong");
    onVerified();
  };
  const [before, after] = t("otp.yours", { otp: "\u0000" }).split("\u0000");
  return (
    <form className="panel" onSubmit={verify}>
      <h2>{t("otp.title")}</h2>
      <p>{t("otp.sent", { phone: mask(phone) })}</p>
      <div className="sms"><b>{t("otp.sim")}</b><br />{before}<code>{otp}</code>{after}</div>
      <label>{t("otp.label")}<input inputMode="numeric" maxLength={6} value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))} autoFocus /></label>
      <p className="small">{left > 0 ? t("otp.expiresIn", { s: left }) : t("otp.expired")}</p>
      {err && <p className="error" role="alert">{t(err)}</p>}
      <button className="primary" type="submit">{t("otp.verify")}</button>
      <div className="row"><button type="button" className="ghost" onClick={resend}>{t("otp.resend")}</button><button type="button" className="ghost" onClick={onBack}>{t("otp.change")}</button></div>
    </form>
  );
}

function AuthPage({ role, mode }) {
  const { state, dispatch, go, t } = useApp();
  const isAdmin = role === "admin", isReg = mode === "register";
  const [f, setF] = useState({ id: "", password: "", name: "", phone: "" });
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState(""); // translation key
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const demo = isAdmin ? { id: ADMIN.username, password: ADMIN.password, name: ADMIN.name, phone: ADMIN.phone } : DEMO_VOTER;

  function submit(e) {
    e.preventDefault(); setErr("");
    const id = isAdmin ? f.id.trim().toLowerCase() : f.id.trim().toUpperCase();
    const name = f.name.trim(), phone = f.phone.trim();
    if (!name) return setErr("err.name");
    if (!id) return setErr(isAdmin ? "err.adminUser" : "err.voterId");
    if (!/^[6-9]\d{9}$/.test(phone)) return setErr("err.phone");
    if (isReg) {
      if (!/^[A-Z0-9]{4,12}$/.test(id)) return setErr("err.idFormat");
      if (f.password.length < 6) return setErr("err.passMin");
      if (state.voters[id]) return setErr("err.idTaken");
      if (Object.values(state.voters).some((v) => v.phone === phone)) return setErr("err.phoneTaken");
    } else if (isAdmin) {
      if (id !== ADMIN.username || f.password !== ADMIN.password || name.toLowerCase() !== ADMIN.name.toLowerCase() || phone !== ADMIN.phone)
        return setErr("err.adminMismatch");
    } else {
      const v = state.voters[id];
      if (!v || v.password !== f.password || v.name.toLowerCase() !== name.toLowerCase() || v.phone !== phone)
        return setErr("err.voterMismatch");
    }
    setPending({ id, name, phone, password: f.password });
  }
  function verified() {
    if (isReg) dispatch({ type: "REGISTER", id: pending.id, voter: { name: pending.name, phone: pending.phone, password: pending.password } });
    dispatch({ type: "LOGIN", session: { role, id: pending.id, name: pending.name } });
    go("dashboard");
  }

  return (
    <main className="auth">
      <section>
        <h1>{isAdmin ? t("auth.adminLogin") : isReg ? t("auth.register") : t("auth.voterLogin")}</h1>
        <p className="lede">{isAdmin ? t("auth.adminLede") : t("auth.voterLede")}</p>
        {!isReg && <button className="ghost" type="button" onClick={() => { setF(demo); setPending(null); }}>{t("auth.fillDemo")}</button>}
        {!isAdmin && (
          <p className="small">{isReg ? t("auth.already") : t("auth.newHere")}{" "}
            <button className="link" onClick={() => go(isReg ? "login" : "register")}>{isReg ? t("nav.login") : t("nav.register")}</button></p>
        )}
        {!isAdmin && !isReg && (
          <p className="small"><button className="link" onClick={() => go("reset")}>{t("auth.forgot")}</button></p>
        )}
      </section>
      {pending ? (
        <OtpStep phone={pending.phone} onVerified={verified} onBack={() => setPending(null)} />
      ) : (
        <form className="panel" onSubmit={submit} noValidate>
          <label>{t("auth.fullName")}<input value={f.name} onChange={set("name")} autoComplete="name" /></label>
          <label>{isAdmin ? t("auth.adminUser") : t("auth.voterId")}<input value={f.id} onChange={set("id")} placeholder={isAdmin ? "admin" : "e.g. STU2026"} /></label>
          <label>{t("auth.mobile")}<input inputMode="numeric" maxLength={10} value={f.phone} onChange={set("phone")} placeholder={t("auth.phPhone")} /></label>
          <label>{t("auth.password")}<input type="password" value={f.password} onChange={set("password")} /></label>
          {err && <p className="error" role="alert">{t(err)}</p>}
          <button className="primary" type="submit">{t("auth.sendOtp")}</button>
        </form>
      )}
    </main>
  );
}

/* ---------- forgot password / reset ---------- */
function ResetPassword() {
  const { state, dispatch, go, t } = useApp();
  const [step, setStep] = useState("details"); // details -> otp -> newpass -> done
  const [f, setF] = useState({ id: "", name: "", phone: "" });
  const [newPass, setNewPass] = useState("");
  const [err, setErr] = useState(""); // translation key
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submitDetails(e) {
    e.preventDefault(); setErr("");
    const id = f.id.trim().toUpperCase();
    const name = f.name.trim(), phone = f.phone.trim();
    const v = state.voters[id];
    if (!v || v.name.toLowerCase() !== name.toLowerCase() || v.phone !== phone) return setErr("err.resetMismatch");
    setF({ id, name, phone });
    setStep("otp");
  }
  function submitNewPass(e) {
    e.preventDefault(); setErr("");
    if (newPass.length < 6) return setErr("err.passMin");
    dispatch({ type: "RESET_PASSWORD", id: f.id, password: newPass });
    setStep("done");
  }

  return (
    <main className="auth">
      <section>
        <h1>{t("reset.title")}</h1>
        <p className="lede">{t("reset.lede")}</p>
        <p className="small">{t("reset.remembered")} <button className="link" onClick={() => go("login")}>{t("nav.login")}</button></p>
      </section>

      {step === "details" && (
        <form className="panel" onSubmit={submitDetails} noValidate>
          <label>{t("auth.voterId")}<input value={f.id} onChange={set("id")} placeholder="e.g. STU2026" /></label>
          <label>{t("auth.fullName")}<input value={f.name} onChange={set("name")} /></label>
          <label>{t("auth.mobile")}<input inputMode="numeric" maxLength={10} value={f.phone} onChange={set("phone")} placeholder={t("auth.phPhone")} /></label>
          {err && <p className="error" role="alert">{t(err)}</p>}
          <button className="primary" type="submit">{t("auth.sendOtp")}</button>
        </form>
      )}

      {step === "otp" && <OtpStep phone={f.phone} onVerified={() => setStep("newpass")} onBack={() => setStep("details")} />}

      {step === "newpass" && (
        <form className="panel" onSubmit={submitNewPass}>
          <h2>{t("reset.setNew")}</h2>
          <label>{t("reset.newPass")}<input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></label>
          {err && <p className="error" role="alert">{t(err)}</p>}
          <button className="primary" type="submit">{t("reset.save")}</button>
        </form>
      )}

      {step === "done" && (
        <div className="panel">
          <h2>{t("reset.updated")}</h2>
          <p>{t("reset.canLogin")}</p>
          <button className="primary" onClick={() => go("login")}>{t("reset.goLogin")}</button>
        </div>
      )}
    </main>
  );
}

/* ---------- verify receipt ---------- */
function VerifyReceipt() {
  const { state, t } = useApp();
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const check = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    const found = c && Object.values(state.elections).some((el) => Object.values(el.voted).includes(c));
    setResult(c && found ? "valid" : "invalid");
  };
  return (
    <main className="auth">
      <section>
        <h1>{t("verify.title")}</h1>
        <p className="lede">{t("verify.lede")}</p>
      </section>
      <form className="panel" onSubmit={check}>
        <label>{t("verify.code")}<input value={code} onChange={(e) => { setCode(e.target.value); setResult(null); }} placeholder="e.g. 3F9A1C0B7D2E4A55" /></label>
        {result === "valid" && <p className="ok">{t("verify.valid")}</p>}
        {result === "invalid" && <p className="error">{t("verify.invalid")}</p>}
        <button className="primary" type="submit">{t("verify.btn")}</button>
      </form>
    </main>
  );
}

/* ---------- public results page ---------- */
function ResultsPage() {
  const { state, go, focusId, t } = useApp();
  const now = useNow();
  const elections = Object.values(state.elections);
  const announced = elections.filter((el) => el.announced);
  const pending = elections.filter((el) => !el.announced);
  const [selId, setSelId] = useState(() => (focusId && state.elections[focusId]?.announced ? focusId : announced[0]?.id || null));
  const el = announced.find((e) => e.id === selId) || announced[0];
  const tally = useTally(el);
  const voterCount = Object.keys(state.voters).length;
  const turnout = voterCount ? Math.round((tally.total / voterCount) * 100) : 0;
  const ranked = [...tally.rows].sort((a, b) => b.n - a.n);
  const winnerIds = new Set(tally.winners.map((w) => w.id));

  return (
    <main className="content wide">
      <section className="page-head">
        <h1>{t("res.title")}</h1>
        <p className="lede">{t("res.lede")}</p>
      </section>

      {announced.length === 0 ? (
        <p className="notice">{t("res.none")}</p>
      ) : (
        <>
          {announced.length > 1 && (
            <div className="tabs" role="tablist" aria-label={t("res.elections")}>
              {announced.map((e) => (
                <button key={e.id} role="tab" aria-selected={el.id === e.id} className={el.id === e.id ? "on" : ""} onClick={() => setSelId(e.id)}>{e.title}</button>
              ))}
            </div>
          )}

          <h2 className="election-heading">{el.title}</h2>
          <WinnerBanner tally={tally} />

          <div className="stats">
            <div><b>{tally.total}</b><span>{t("res.votesCast")}</span></div>
            <div><b>{turnout}%</b><span>{t("res.turnout", { n: voterCount })}</span></div>
            <div><b>{el.candidates.length}</b><span>{t("res.candidates")}</span></div>
            <div><b className="stat-sm">{fmt(el.schedule.end)}</b><span>{t("res.closed")}</span></div>
          </div>

          <h3>{t("res.share")}</h3>
          <div className="bars">
            {ranked.map((c) => (
              <div key={c.id}>
                <div className="bar-label"><strong>{c.name}{winnerIds.has(c.id) && <span className="crown" title={t("res.winnerTitle")}> 🏆</span>}</strong><span>{t("res.votesPct", { n: c.n, p: c.pct })}</span></div>
                <div className="track"><div className={"fill" + (winnerIds.has(c.id) ? " win" : "")} style={{ width: c.pct + "%" }} /></div>
              </div>
            ))}
          </div>

          <h3>{t("res.standings")}</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>{t("res.rank")}</th><th>{t("res.candidate")}</th><th>{t("res.party")}</th><th>{t("res.votes")}</th><th>{t("res.pct")}</th></tr></thead>
            <tbody>
              {ranked.map((c) => (
                <tr key={c.id} className={winnerIds.has(c.id) ? "row-win" : ""}>
                  <td>{ranked.findIndex((r) => r.n === c.n) + 1}</td><td>{c.name}</td><td>{c.party}</td><td>{c.n}</td><td>{c.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="small">{t("res.wantVerify")} <button className="link" onClick={() => go("verify")}>{t("res.verifyLink")}</button></p>
        </>
      )}

      {pending.length > 0 && (
        <section className="band results-pending">
          <h2>{t("res.awaiting")}</h2>
          <ul className="election-mini-list wide-list">
            {pending.map((e) => {
              const st = getStatus(e, now, t);
              return (
                <li key={e.id}>
                  <span>{e.title}</span>
                  <span className={"pill " + st.key}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

/* ---------- shared ---------- */
function ResultBars({ tally }) {
  const { t } = useApp();
  return (
    <div className="bars">
      {tally.rows.map((c) => (
        <div key={c.id}>
          <div className="bar-label"><strong>{c.name}</strong><span>{t("res.votesPct", { n: c.n, p: c.pct })}</span></div>
          <div className="track"><div className="fill" style={{ width: c.pct + "%" }} /></div>
        </div>
      ))}
    </div>
  );
}
function WinnerBanner({ tally }) {
  const { t } = useApp();
  if (!tally.total) return <p className="notice">{t("shared.noVotes")}</p>;
  const names = tally.winners.map((w) => w.name).join(t("shared.and"));
  return <div className="winner"><span>{tally.winners.length > 1 ? t("shared.tieBetween") : t("shared.winner")}</span><strong>{names}</strong></div>;
}
function Tabs({ tabs, tab, setTab }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => (<button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>))}</div>;
}

/* ---------- voter dashboard (election list + per-election ballot) ---------- */
function VoterDashboard() {
  const { state, t } = useApp();
  const [selected, setSelected] = useState(null);
  const now = useNow();
  const elections = Object.values(state.elections);
  const me = state.session;

  if (selected && state.elections[selected]) {
    return <ElectionVoter election={state.elections[selected]} onBack={() => setSelected(null)} />;
  }

  return (
    <main className="content wide">
      <h1>{t("vd.title")}</h1>
      {elections.length === 0 ? (
        <p className="notice">{t("vd.none")}</p>
      ) : (
        <div className="demo-grid">
          {elections.map((el) => {
            const voted = el.voted[me.id];
            return (
              <div className="demo" key={el.id}>
                <h3>{el.title}</h3>
                <LiveStatus election={el} now={now} showBar={false} />
                {voted && <p className="small">{t("vd.voted")}</p>}
                <button className="primary" onClick={() => setSelected(el.id)}>
                  {voted ? t("vd.viewReceipt") : t("vd.openBallot")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function ElectionVoter({ election, onBack }) {
  const { state, dispatch, go, t } = useApp();
  const now = useNow();
  const st = getStatus(election, now);
  const me = state.session;
  const tally = useTally(election);
  const [tab, setTab] = useState("vote");
  const [choice, setChoice] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [castErr, setCastErr] = useState(false);
  const receipt = election.voted[me.id];
  const eid = election.id;

  // if the window closes (or is paused) while the confirm dialog is up, dismiss it
  useEffect(() => { if (st.key !== "open") setConfirm(false); }, [st.key]);

  async function cast() {
    if (getStatus(election, Date.now()).key !== "open") {
      setConfirm(false);
      setCastErr(true);
      return;
    }
    setCastErr(false);
    const r = await makeReceipt(me.id, choice);
    dispatch({ type: "CAST_VOTE", electionId: eid, voterId: me.id, cid: choice, receipt: r });
    setConfirm(false);
  }

  const closedMsg = st.key === "upcoming" ? t("ev.opensAt", { t: fmt(election.schedule.start) })
    : st.key === "closed" ? t("ev.closedMsg")
    : st.key === "paused" ? t("ev.pausedMsg")
    : t("ev.unsetMsg");

  return (
    <main className="content">
      <button className="ghost" onClick={onBack}>{t("ev.back")}</button>
      <h1>{election.title}</h1>
      <LiveStatus election={election} now={now} />
      <Tabs tabs={[["vote", t("ev.tabVote")], ["results", t("ev.tabResults")]]} tab={tab} setTab={setTab} />
      {castErr && <p className="error" role="alert">{t("ev.notRecorded")}</p>}

      {tab === "vote" && (receipt ? (
        <div className="receipt">
          <h2>{t("ev.recorded")}</h2>
          <p>{t("ev.keep")}</p>
          <code>{receipt}</code>
        </div>
      ) : st.key !== "open" ? (
        <p className="notice">{closedMsg}</p>
      ) : election.candidates.length === 0 ? (
        <p className="notice">{t("ev.noCands")}</p>
      ) : (
        <>
          <h2>{t("ev.cast")}</h2>
          <p className="sub">{t("ev.pickOne")}</p>
          <div className="ballot">
            {election.candidates.map((c) => (
              <label key={c.id} className={"cand" + (choice === c.id ? " picked" : "")}>
                <input type="radio" name="cand" checked={choice === c.id} onChange={() => setChoice(c.id)} />
                <span className="mark" aria-hidden="true" />
                <span className="info"><strong>{c.name}</strong><em>{c.party}</em><span>{c.pledge}</span></span>
              </label>
            ))}
          </div>
          <button className="primary" disabled={!choice} onClick={() => setConfirm(true)}>{t("ev.review")}</button>
        </>
      ))}

      {tab === "results" && (election.announced ? (
        <>
          <h2>{t("ev.official")}</h2>
          <WinnerBanner tally={tally} />
          <p className="sub">{t("ev.votesCast", { n: tally.total })}</p>
          <ResultBars tally={tally} />
          <button className="ghost" onClick={() => go("results", election.id)}>{t("ev.openResults")}</button>
        </>
      ) : <p className="notice">{t("ev.notAnnounced")}</p>)}

      {confirm && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{t("ev.confirmTitle")}</h3>
            <p>{t("ev.confirmPre")}<strong>{election.candidates.find((c) => c.id === choice)?.name}</strong>{t("ev.confirmPost")}</p>
            <div className="row"><button className="ghost" onClick={() => setConfirm(false)}>{t("ev.goBack")}</button><button className="primary" onClick={cast}>{t("ev.confirmBtn")}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- admin panel (election switcher + per-election admin) ---------- */
function AdminPanel() {
  const { state, dispatch, t } = useApp();
  const elections = Object.values(state.elections);
  const activeId = state.activeElectionId;
  const election = state.elections[activeId];
  const [newTitle, setNewTitle] = useState("");

  function createElection(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    dispatch({ type: "ADD_ELECTION", title: newTitle.trim() });
    setNewTitle("");
  }
  function deleteElection() {
    if (window.confirm(t("ad.deleteConfirm", { title: election.title }))) {
      dispatch({ type: "REMOVE_ELECTION", id: activeId });
    }
  }

  return (
    <main className="content wide">
      <h1>{t("ad.title")}</h1>

      <div className="election-switch">
        {elections.length > 0 && (
          <label>{t("ad.managing")}
            <select value={activeId || ""} onChange={(e) => dispatch({ type: "SET_ACTIVE_ELECTION", id: e.target.value })}>
              {elections.map((el) => <option key={el.id} value={el.id}>{el.title}</option>)}
            </select>
          </label>
        )}
        <form className="inline-form small-form" onSubmit={createElection}>
          <input placeholder={t("ad.newElection")} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button className="secondary" type="submit">{t("ad.create")}</button>
        </form>
        {election && <button className="ghost danger" onClick={deleteElection}>{t("ad.delete")}</button>}
      </div>

      {!election ? (
        <p className="notice">{t("ad.createFirst")}</p>
      ) : (
        <ElectionAdmin key={election.id} election={election} />
      )}
    </main>
  );
}

function ElectionAdmin({ election }) {
  const { state, dispatch, t } = useApp();
  const now = useNow();
  const st = getStatus(election, now);
  const tally = useTally(election);
  const [tab, setTab] = useState("overview");
  const [cand, setCand] = useState({ name: "", party: "", pledge: "" });
  const [candErr, setCandErr] = useState(""); // translation key
  const [sched, setSched] = useState({ start: toLocalInput(election.schedule.start), end: toLocalInput(election.schedule.end) });
  const [schedMsg, setSchedMsg] = useState(null); // { key, ok }
  const voterList = Object.entries(state.voters);
  const turnout = voterList.length ? Math.round((tally.total / voterList.length) * 100) : 0;
  const canAnnounce = st.key === "closed" || st.key === "paused";
  const eid = election.id;

  function addCand(e) {
    e.preventDefault();
    if (!cand.name.trim() || !cand.party.trim()) return setCandErr("ad.errCand");
    if (election.candidates.some((c) => c.name.toLowerCase() === cand.name.trim().toLowerCase())) return setCandErr("ad.errDup");
    dispatch({ type: "ADD_CAND", electionId: eid, cand: { name: cand.name.trim(), party: cand.party.trim(), pledge: cand.pledge.trim() } });
    setCand({ name: "", party: "", pledge: "" }); setCandErr("");
  }
  function saveSchedule(e) {
    e.preventDefault();
    const start = new Date(sched.start).getTime(), end = new Date(sched.end).getTime();
    if (!start || !end) return setSchedMsg({ key: "ad.schedBoth", ok: false });
    if (end <= start) return setSchedMsg({ key: "ad.schedOrder", ok: false });
    dispatch({ type: "SET_SCHEDULE", electionId: eid, schedule: { start, end } });
    setSchedMsg({ key: "ad.schedSaved", ok: true });
  }

  return (
    <>
      <h2 className="election-heading">{election.title}</h2>
      <Tabs tabs={[["overview", t("ad.tabOverview")], ["candidates", t("ad.tabCandidates")], ["schedule", t("ad.tabSchedule")], ["voters", t("ad.tabVoters")], ["results", t("ad.tabResults")]]} tab={tab} setTab={setTab} />

      {tab === "overview" && (
        <>
          <div className="stats">
            <div><b>{election.candidates.length}</b><span>{t("ad.sCands")}</span></div>
            <div><b>{voterList.length}</b><span>{t("ad.sVoters")}</span></div>
            <div><b>{tally.total}</b><span>{t("ad.sVotes")}</span></div>
            <div><b>{turnout}%</b><span>{t("ad.sTurnout")}</span></div>
          </div>
          <LiveStatus election={election} now={now} />
          <div className="row left">
            <button className="secondary" onClick={() => dispatch({ type: "TOGGLE_SUSPEND", electionId: eid })}>{election.suspended ? t("ad.resume") : t("ad.pause")}</button>
            <button className="ghost danger" onClick={() => { if (window.confirm(t("ad.resetConfirm"))) dispatch({ type: "RESET_ELECTION", electionId: eid }); }}>{t("ad.reset")}</button>
          </div>
        </>
      )}

      {tab === "candidates" && (
        <>
          <h2>{t("ad.nCands", { n: election.candidates.length })}</h2>
          <form className="inline-form" onSubmit={addCand}>
            <input placeholder={t("ad.phName")} value={cand.name} onChange={(e) => setCand({ ...cand, name: e.target.value })} />
            <input placeholder={t("ad.phParty")} value={cand.party} onChange={(e) => setCand({ ...cand, party: e.target.value })} />
            <input placeholder={t("ad.phPledge")} value={cand.pledge} onChange={(e) => setCand({ ...cand, pledge: e.target.value })} />
            <button className="primary" type="submit">{t("ad.addCand")}</button>
          </form>
          {candErr && <p className="error">{t(candErr)}</p>}
          <div className="table-wrap"><table>
            <thead><tr><th>{t("ad.thName")}</th><th>{t("ad.thParty")}</th><th>{t("ad.thPledge")}</th><th>{t("ad.thVotes")}</th><th></th></tr></thead>
            <tbody>
              {election.candidates.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td>{c.party}</td><td>{c.pledge}</td><td>{election.votes[c.id] || 0}</td>
                  <td><button className="ghost danger" disabled={tally.total > 0} title={tally.total > 0 ? t("ad.removeHint") : ""} onClick={() => dispatch({ type: "REMOVE_CAND", electionId: eid, id: c.id })}>{t("ad.remove")}</button></td></tr>
              ))}
            </tbody>
          </table></div>
          {tally.total > 0 && <p className="small">{t("ad.cantRemove")}</p>}
        </>
      )}

      {tab === "schedule" && (
        <form className="panel schedule" onSubmit={saveSchedule}>
          <h2>{t("ad.schedTitle")}</h2>
          <label>{t("ad.starts")}<input type="datetime-local" value={sched.start} onChange={(e) => setSched({ ...sched, start: e.target.value })} /></label>
          <label>{t("ad.ends")}<input type="datetime-local" value={sched.end} onChange={(e) => setSched({ ...sched, end: e.target.value })} /></label>
          {schedMsg && <p className={schedMsg.ok ? "ok" : "error"}>{t(schedMsg.key)}</p>}
          <button className="primary" type="submit">{t("ad.saveSched")}</button>
          <p className="small">{t("ad.current", { a: fmt(election.schedule.start), b: fmt(election.schedule.end) })}</p>
        </form>
      )}

      {tab === "voters" && (
        <>
          <h2>{t("ad.nVoters", { n: voterList.length })}</h2>
          <p className="small">{t("ad.votersShared")}</p>
          <div className="table-wrap"><table>
            <thead><tr><th>{t("ad.thName")}</th><th>{t("ad.thVoterId")}</th><th>{t("ad.thPhone")}</th><th>{t("ad.thVotedHere")}</th></tr></thead>
            <tbody>{voterList.map(([id, v]) => (<tr key={id}><td>{v.name}</td><td>{id}</td><td>{v.phone}</td><td>{election.voted[id] ? t("ad.yes") : t("ad.no")}</td></tr>))}</tbody>
          </table></div>
        </>
      )}

      {tab === "results" && (
        <>
          <h2>{t("ad.liveTally")}</h2>
          <p className="sub">{t("ad.liveSub", { n: tally.total })}</p>
          <ResultBars tally={tally} />
          {election.announced && <WinnerBanner tally={tally} />}
          <div className="row left">
            {election.announced ? (
              <button className="secondary" onClick={() => dispatch({ type: "ANNOUNCE", electionId: eid, value: false })}>{t("ad.withdraw")}</button>
            ) : (
              <button className="primary" disabled={!canAnnounce} onClick={() => dispatch({ type: "ANNOUNCE", electionId: eid, value: true })}>{t("ad.announce")}</button>
            )}
          </div>
          {!canAnnounce && !election.announced && <p className="small">{t("ad.announceHint")}</p>}
        </>
      )}
    </>
  );
}