import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  onSnapshot, serverTimestamp, query, orderBy, limit
} from "firebase/firestore";

// ─── Constants ───────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const ADMIN_PIN = "1234";

const NHL_TEAMS = [
  "Anaheim Ducks","Boston Bruins","Buffalo Sabres","Calgary Flames",
  "Carolina Hurricanes","Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets",
  "Dallas Stars","Detroit Red Wings","Edmonton Oilers","Florida Panthers",
  "Los Angeles Kings","Minnesota Wild","Montreal Canadiens","Nashville Predators",
  "New Jersey Devils","New York Islanders","New York Rangers","Ottawa Senators",
  "Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks","Seattle Kraken",
  "St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs","Vancouver Canucks",
  "Vegas Golden Knights","Washington Capitals","Winnipeg Jets"
];

const TEAM_ABBR = {
  "Anaheim Ducks":"ANA","Boston Bruins":"BOS","Buffalo Sabres":"BUF","Calgary Flames":"CGY",
  "Carolina Hurricanes":"CAR","Chicago Blackhawks":"CHI","Colorado Avalanche":"COL",
  "Columbus Blue Jackets":"CBJ","Dallas Stars":"DAL","Detroit Red Wings":"DET",
  "Edmonton Oilers":"EDM","Florida Panthers":"FLA","Los Angeles Kings":"LAK",
  "Minnesota Wild":"MIN","Montreal Canadiens":"MTL","Nashville Predators":"NSH",
  "New Jersey Devils":"NJD","New York Islanders":"NYI","New York Rangers":"NYR",
  "Ottawa Senators":"OTT","Philadelphia Flyers":"PHI","Pittsburgh Penguins":"PIT",
  "San Jose Sharks":"SJS","Seattle Kraken":"SEA","St. Louis Blues":"STL",
  "Tampa Bay Lightning":"TBL","Toronto Maple Leafs":"TOR","Vancouver Canucks":"VAN",
  "Vegas Golden Knights":"VGK","Washington Capitals":"WSH","Winnipeg Jets":"WPG"
};

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function buildSampleGames() {
  const teams = pickRandom(NHL_TEAMS, 8);
  const count = Math.floor(Math.random() * 2) + 2; // 2-3 games
  const games = [];
  for (let i = 0; i < count; i++) {
    games.push({ id: `g${i+1}`, home: teams[i*2], away: teams[i*2+1] });
  }
  return games;
}

// ─── AI Question Generation ───────────────────────────────────────────────────
async function generateQuestionsForGame(game) {
  const prompt = `Generate 3 fun 50-50 pick'em questions for the NHL game: ${game.away} (away) vs ${game.home} (home).

Each question should have exactly two options that feel roughly equal in probability. Use creative angles like: first team to score, total goals over/under, whether a game goes to OT, which period has more goals, goalie save totals, etc.

Return ONLY a raw JSON array, no markdown fences, no explanation:
[{"q":"Question?","optA":"Option A","optB":"Option B"},...]`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await resp.json();
  const text = data.content.map(b => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [name, setName] = useState("");
  const [users, setUsers] = useState([]);

  useEffect(() => {
    onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(d => d.id));
    });
  }, []);

  async function handleJoin() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await setDoc(doc(db, "users", trimmed), { joinedAt: serverTimestamp() }, { merge: true });
    onLogin(trimmed);
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.puckEmoji}>🏒</div>
        <h1 style={S.loginTitle}>NHL Pick'em</h1>
        <p style={S.loginSub}>50-50 questions · every game night</p>
        <input
          style={S.input}
          placeholder="Enter your name…"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleJoin()}
          autoFocus
        />
        {users.length > 0 && (
          <div style={S.existingWrap}>
            <p style={S.existingLabel}>Or tap your name:</p>
            <div style={S.chipRow}>
              {users.map(u => (
                <button key={u} style={S.chip} onClick={() => { setName(u); onLogin(u); }}>{u}</button>
              ))}
            </div>
          </div>
        )}
        <button style={{ ...S.primaryBtn, opacity: name.trim() ? 1 : 0.5 }} onClick={handleJoin} disabled={!name.trim()}>
          Let's Play →
        </button>
      </div>
    </div>
  );
}

// ─── TODAY TAB ────────────────────────────────────────────────────────────────
function TodayTab({ user }) {
  const [dayData, setDayData] = useState(null);
  const [myPicks, setMyPicks] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [error, setError] = useState(null);

  // Live-listen to today's doc
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "days", TODAY), snap => {
      if (snap.exists()) setDayData(snap.data());
      else setDayData(null);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Live-listen to my picks
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "days", TODAY, "picks", user), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setMyPicks(d.picks || {});
        setSubmitted(d.locked || false);
      }
    });
    return unsub;
  }, [user]);

  async function loadGames() {
    setGenerating(true);
    setError(null);
    try {
      const games = buildSampleGames();
      const questions = {};
      for (const game of games) {
        setGenStatus(`Generating: ${game.away} @ ${game.home}…`);
        questions[game.id] = await generateQuestionsForGame(game);
      }
      await setDoc(doc(db, "days", TODAY), { games, questions, createdAt: serverTimestamp() });
      setGenStatus("");
    } catch (e) {
      setError("Failed to generate questions. Check your connection.");
    }
    setGenerating(false);
  }

  async function handlePick(gameId, qi, choice) {
    if (submitted) return;
    const key = `${gameId}_${qi}`;
    const updated = { ...myPicks, [key]: choice };
    setMyPicks(updated);
    await setDoc(doc(db, "days", TODAY, "picks", user), { picks: updated, locked: false, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function handleSubmit() {
    await setDoc(doc(db, "days", TODAY, "picks", user), { locked: true, lockedAt: serverTimestamp() }, { merge: true });
    setSubmitted(true);
  }

  if (loading) return <div style={S.centerBox}><div style={S.spinner} /></div>;

  const games = dayData?.games || [];
  const questions = dayData?.questions || {};
  const totalQ = games.length * 3;
  const answeredQ = Object.keys(myPicks).length;
  const allAnswered = totalQ > 0 && answeredQ >= totalQ;

  if (!dayData) {
    return (
      <div style={S.centerBox}>
        {generating ? (
          <div style={S.loadingBox}>
            <div style={S.spinner} />
            <p style={S.loadingText}>{genStatus || "Loading…"}</p>
          </div>
        ) : (
          <>
            <p style={S.emptyText}>No games loaded for tonight yet.</p>
            {error && <p style={S.errorText}>{error}</p>}
            <button style={S.primaryBtn} onClick={loadGames}>🏒 Load Tonight's Games</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={S.tabContent}>
      {submitted && <div style={S.successBanner}>🔒 Picks locked! Results tomorrow.</div>}

      <div style={S.progressRow}>
        <span style={S.progressLabel}>{answeredQ}/{totalQ} answered</span>
        <div style={S.progressTrack}>
          <div style={{ ...S.progressFill, width: `${totalQ ? (answeredQ/totalQ)*100 : 0}%` }} />
        </div>
      </div>

      {games.map(game => (
        <div key={game.id} style={S.gameCard}>
          <div style={S.gameHeader}>
            <div style={S.teamBlock}>
              <span style={S.abbr}>{TEAM_ABBR[game.away] || "AWY"}</span>
              <span style={S.teamFull}>{game.away}</span>
            </div>
            <span style={S.atSign}>@</span>
            <div style={{ ...S.teamBlock, alignItems: "flex-end" }}>
              <span style={S.abbr}>{TEAM_ABBR[game.home] || "HME"}</span>
              <span style={S.teamFull}>{game.home}</span>
            </div>
          </div>

          {(questions[game.id] || []).map((q, qi) => {
            const key = `${game.id}_${qi}`;
            const picked = myPicks[key];
            return (
              <div key={qi} style={S.qBlock}>
                <p style={S.qText}>{qi+1}. {q.q}</p>
                <div style={S.optRow}>
                  {["A","B"].map(side => (
                    <button
                      key={side}
                      style={{
                        ...S.optBtn,
                        ...(picked === side ? S.optSelected : {}),
                        ...(submitted && picked !== side ? S.optDimmed : {})
                      }}
                      onClick={() => handlePick(game.id, qi, side)}
                      disabled={submitted}
                    >
                      {side === "A" ? q.optA : q.optB}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {!submitted && allAnswered && (
        <button style={S.primaryBtn} onClick={handleSubmit}>🔒 Lock In My Picks</button>
      )}
      {!submitted && !allAnswered && totalQ > 0 && (
        <p style={S.hint}>Answer all {totalQ} questions to lock in.</p>
      )}
      <button style={S.ghostBtn} onClick={loadGames} disabled={generating}>
        🔄 Regenerate Tonight's Questions
      </button>
    </div>
  );
}

// ─── RESULTS TAB ──────────────────────────────────────────────────────────────
function ResultsTab({ user }) {
  const [dayData, setDayData] = useState(null);
  const [myPicks, setMyPicks] = useState({});
  const [answers, setAnswers] = useState({});
  const [adminMode, setAdminMode] = useState(false);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [scoresSaved, setScoresSaved] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "days", YESTERDAY), snap => {
      if (snap.exists()) setDayData(snap.data());
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "days", YESTERDAY, "picks", user), snap => {
      if (snap.exists()) setMyPicks(snap.data().picks || {});
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "days", YESTERDAY, "meta", "answers"), snap => {
      if (snap.exists()) setAnswers(snap.data().answers || {});
    });
    return unsub;
  }, []);

  async function saveAnswer(key, side) {
    const updated = { ...answers, [key]: side };
    setAnswers(updated);
    await setDoc(doc(db, "days", YESTERDAY, "meta", "answers"), { answers: updated, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function finalizeScores() {
    setSaving(true);
    const usersSnap = await getDocs(collection(db, "users"));
    const users = usersSnap.docs.map(d => d.id);
    const totalQ = Object.keys(answers).length;

    // Check if already processed — guard against double-finalize
    const processedRef = doc(db, "days", YESTERDAY, "meta", "processed");
    const processedSnap = await getDoc(processedRef);
    if (processedSnap.exists()) {
      setSaving(false);
      setScoresSaved(true);
      return;
    }

    for (const u of users) {
      const pickSnap = await getDoc(doc(db, "days", YESTERDAY, "picks", u));
      const picks = pickSnap.exists() ? (pickSnap.data().picks || {}) : {};
      let correct = 0;
      Object.entries(answers).forEach(([k, ans]) => { if (picks[k] === ans) correct++; });

      // Hat trick = perfect score for the day (answered all Qs correctly)
      const answeredAll = Object.keys(answers).every(k => picks[k] !== undefined);
      const hatTrick = answeredAll && correct === totalQ ? 1 : 0;

      const scoreRef = doc(db, "scores", u);
      const scoreSnap = await getDoc(scoreRef);
      const prev = scoreSnap.exists() ? scoreSnap.data() : { correct: 0, total: 0, hatTricks: 0 };

      await setDoc(scoreRef, {
        correct: (prev.correct || 0) + correct,
        total: (prev.total || 0) + totalQ,
        hatTricks: (prev.hatTricks || 0) + hatTrick,
        name: u
      }, { merge: true });
    }
    await setDoc(processedRef, { at: serverTimestamp() });
    setSaving(false);
    setScoresSaved(true);
  }

  if (!dayData) {
    return (
      <div style={S.centerBox}>
        <p style={S.emptyText}>No games found for {YESTERDAY}.</p>
        <p style={S.hint}>Results appear here the day after games are played.</p>
      </div>
    );
  }

  const { games = [], questions = {} } = dayData;
  const totalQ = games.length * 3;
  const answeredCount = Object.keys(answers).length;
  const resultsReady = answeredCount === totalQ;
  const adminUnlocked = adminMode && pin === ADMIN_PIN;

  let myCorrect = 0;
  if (resultsReady) {
    Object.entries(answers).forEach(([k, ans]) => { if (myPicks[k] === ans) myCorrect++; });
  }

  return (
    <div style={S.tabContent}>
      <div style={S.resultsHeader}>
        <div>
          <h2 style={S.resultsTitle}>Results</h2>
          <p style={S.resultsDate}>{YESTERDAY}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {!adminMode
            ? <button style={S.ghostBtnSm} onClick={() => setAdminMode(true)}>Admin</button>
            : <input style={{ ...S.input, width: 110, marginBottom: 0, padding: "8px 12px" }}
                placeholder="PIN" value={pin} onChange={e => setPin(e.target.value)} />
          }
        </div>
      </div>

      {!resultsReady && !adminUnlocked && (
        <div style={S.warningBanner}>⏳ Admin hasn't entered results yet.</div>
      )}

      {resultsReady && (() => {
        const isHatTrick = myCorrect === totalQ && Object.keys(answers).every(k => myPicks[k] !== undefined);
        return (
          <div style={{ ...S.scoreBanner, ...(isHatTrick ? S.scoreBannerHatTrick : {}) }}>
            {isHatTrick
              ? <span>🎩 HAT TRICK! Perfect day — <strong>{myCorrect}/{totalQ}</strong> 🎩</span>
              : <span>Your score: <strong>{myCorrect}/{totalQ}</strong>{myCorrect === 0 ? " 😬 Rough night!" : ""}</span>
            }
          </div>
        );
      })()}

      {games.map(game => (
        <div key={game.id} style={S.gameCard}>
          <div style={S.gameHeader}>
            <div style={S.teamBlock}>
              <span style={S.abbr}>{TEAM_ABBR[game.away] || "AWY"}</span>
              <span style={S.teamFull}>{game.away}</span>
            </div>
            <span style={S.atSign}>@</span>
            <div style={{ ...S.teamBlock, alignItems: "flex-end" }}>
              <span style={S.abbr}>{TEAM_ABBR[game.home] || "HME"}</span>
              <span style={S.teamFull}>{game.home}</span>
            </div>
          </div>

          {(questions[game.id] || []).map((q, qi) => {
            const key = `${game.id}_${qi}`;
            const ans = answers[key];
            const myPick = myPicks[key];

            return (
              <div key={qi} style={S.qBlock}>
                <p style={S.qText}>{qi+1}. {q.q}</p>
                <div style={S.optRow}>
                  {["A","B"].map(side => {
                    const label = side === "A" ? q.optA : q.optB;
                    const isCorrect = ans === side;
                    const isMyPick = myPick === side;
                    let extra = {};
                    if (ans) {
                      extra = isCorrect ? S.optCorrect : S.optWrong;
                    } else if (isMyPick) {
                      extra = S.optSelected;
                    }
                    return (
                      <button
                        key={side}
                        style={{ ...S.optBtn, ...extra }}
                        onClick={() => adminUnlocked && saveAnswer(key, side)}
                        disabled={!adminUnlocked}
                      >
                        <span>{label}</span>
                        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                          {isMyPick && <span style={S.badge}>my pick</span>}
                          {adminUnlocked && isCorrect && <span style={{ ...S.badge, background: "#2a9d4a22", color: "#4de87a" }}>✓ correct</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {ans && myPick && (
                  <p style={myPick === ans ? S.resultOk : S.resultBad}>
                    {myPick === ans ? "✅ Correct" : "❌ Wrong"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {adminUnlocked && resultsReady && !scoresSaved && (
        <button style={S.primaryBtn} onClick={finalizeScores} disabled={saving}>
          {saving ? "Saving scores…" : "💾 Finalize & Save Scores"}
        </button>
      )}
      {scoresSaved && <div style={S.successBanner}>✅ Scores saved to leaderboard!</div>}
    </div>
  );
}

// ─── LEADERBOARD TAB ─────────────────────────────────────────────────────────
function LeaderboardTab() {
  const [scores, setScores] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "scores"), snap => {
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .map(s => ({ ...s, hatTricks: s.hatTricks || 0, pct: s.total ? Math.round((s.correct / s.total) * 100) : 0 }))
        // Sort: hat tricks first, then correct answers, then pct as final tiebreaker
        .sort((a, b) => b.hatTricks - a.hatTricks || b.correct - a.correct || b.pct - a.pct);
      setScores(data);
    });
    return unsub;
  }, []);

  const medals = ["🥇","🥈","🥉"];

  if (!scores.length) {
    return (
      <div style={S.centerBox}>
        <p style={S.emptyText}>No scores yet.</p>
        <p style={S.hint}>Standings appear after the admin enters the first results.</p>
      </div>
    );
  }

  return (
    <div style={S.tabContent}>
      <h2 style={S.lbTitle}>Season Standings</h2>

      <div style={S.lbLegend}>
        <span style={S.lbLegendItem}>🎩 Hat Tricks</span>
        <span style={S.lbLegendSep}>·</span>
        <span style={S.lbLegendItem}>ranked by 🎩 first, then ✅ correct</span>
      </div>

      {scores.map((s, i) => (
        <div key={s.id} style={{
          ...S.lbRow,
          ...(i === 0 ? S.lbGold : i === 1 ? S.lbSilver : {}),
          ...(s.hatTricks > 0 ? S.lbHasHatTrick : {})
        }}>
          <span style={S.lbMedal}>{medals[i] || `#${i+1}`}</span>
          <div style={S.lbCenter}>
            <span style={S.lbName}>{s.name || s.id}</span>
            {s.hatTricks > 0 && (
              <div style={S.lbHatTricks}>
                {Array.from({ length: Math.min(s.hatTricks, 8) }).map((_, hi) => (
                  <span key={hi} style={S.hatIcon}>🎩</span>
                ))}
                {s.hatTricks > 8 && <span style={S.lbPct}>+{s.hatTricks - 8}</span>}
              </div>
            )}
          </div>
          <div style={S.lbRight}>
            <div style={S.lbHatTrickCount}>
              <span style={S.lbHatNum}>{s.hatTricks}</span>
              <span style={S.lbHatLabel}>hat{s.hatTricks !== 1 ? "s" : ""}</span>
            </div>
            <div style={S.lbDivider} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={S.lbNum}>{s.correct}<span style={S.lbDenom}>/{s.total}</span></span>
              <span style={S.lbPct}>{s.pct}%</span>
            </div>
          </div>
        </div>
      ))}

      <div style={S.lbFootnote}>
        🎩 A hat trick = answering every question correctly on a single day.<br/>
        Hat tricks rank above everything — one 🎩 beats any number of correct answers.
      </div>
    </div>
  );
}

// ─── CHAT TAB ─────────────────────────────────────────────────────────────────
function ChatTab({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "chat"), orderBy("ts", "asc"), limit(100));
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
    return unsub;
  }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    await addDoc(collection(db, "chat"), {
      user,
      text,
      ts: serverTimestamp()
    });
    setSending(false);
  }

  function formatTime(ts) {
    if (!ts?.toDate) return "";
    const d = ts.toDate();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDay(ts) {
    if (!ts?.toDate) return "";
    return ts.toDate().toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Group messages by day
  let lastDay = null;

  return (
    <div style={S.chatWrap}>
      <div style={S.chatMessages}>
        {messages.length === 0 && (
          <div style={{ ...S.centerBox, paddingTop: 60 }}>
            <p style={{ fontSize: 40 }}>💬</p>
            <p style={S.emptyText}>No messages yet. Start the trash talk!</p>
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.user === user;
          const day = msg.ts ? formatDay(msg.ts) : null;
          const showDay = day && day !== lastDay;
          lastDay = day;
          return (
            <div key={msg.id}>
              {showDay && <div style={S.dayDivider}><span style={S.dayLabel}>{day}</span></div>}
              <div style={{ ...S.msgRow, justifyContent: isMe ? "flex-end" : "flex-start" }}>
                {!isMe && <div style={S.avatar}>{msg.user?.[0]?.toUpperCase()}</div>}
                <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 2 }}>
                  {!isMe && <span style={S.msgUser}>{msg.user}</span>}
                  <div style={{ ...S.bubble, ...(isMe ? S.bubbleMe : S.bubbleThem) }}>
                    {msg.text}
                  </div>
                  <span style={S.msgTime}>{formatTime(msg.ts)}</span>
                </div>
                {isMe && <div style={{ ...S.avatar, background: "#c8102e22", color: "#c8102e" }}>{user[0]?.toUpperCase()}</div>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div style={S.chatInputRow}>
        <input
          style={S.chatInput}
          placeholder="Talk some trash…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
        />
        <button style={S.sendBtn} onClick={sendMessage} disabled={!input.trim() || sending}>
          ➤
        </button>
      </div>
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => localStorage.getItem("nhl_user") || null);
  const [tab, setTab] = useState("today");

  function handleLogin(name) {
    localStorage.setItem("nhl_user", name);
    setUser(name);
  }

  function handleLogout() {
    localStorage.removeItem("nhl_user");
    setUser(null);
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  const tabs = [
    { id: "today", label: "🎯 Tonight" },
    { id: "results", label: "📋 Results" },
    { id: "leaderboard", label: "🏆 Standings" },
    { id: "chat", label: "💬 Chat" },
  ];

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div style={S.headerL}>
          <span style={S.logoIcon}>🏒</span>
          <span style={S.appTitle}>NHL Pick'em</span>
        </div>
        <div style={S.headerR}>
          <span style={S.hUser}>{user}</span>
          <button style={S.logoutBtn} onClick={handleLogout} title="Switch user">↩</button>
        </div>
      </header>

      <nav style={S.nav}>
        {tabs.map(t => (
          <button key={t.id} style={{ ...S.navBtn, ...(tab === t.id ? S.navActive : {}) }} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ ...S.main, ...(tab === "chat" ? { display: "flex", flexDirection: "column" } : {}) }}>
        {tab === "today" && <TodayTab user={user} />}
        {tab === "results" && <ResultsTab user={user} />}
        {tab === "leaderboard" && <LeaderboardTab />}
        {tab === "chat" && <ChatTab user={user} />}
      </main>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const ICE = "#e8f4fd";
const NAVY = "#0a1628";
const BLUE = "#1a3a6e";
const RED = "#c8102e";
const GOLD = "#f5c518";
const MID = "#0d1f3c";
const BORDER = "#1e3a6a";

const S = {
  app: { minHeight: "100vh", background: NAVY, color: "#fff", fontFamily: "'Barlow Condensed', sans-serif", display: "flex", flexDirection: "column" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "#060f1e", borderBottom: `3px solid ${RED}`, position: "sticky", top: 0, zIndex: 10 },
  headerL: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: { fontSize: 26 },
  appTitle: { fontSize: 22, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", color: ICE },
  headerR: { display: "flex", alignItems: "center", gap: 10 },
  hUser: { fontSize: 14, color: "#7aafda", letterSpacing: 1 },
  logoutBtn: { background: "transparent", border: `1px solid ${BORDER}`, color: "#7a9fba", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 15 },

  nav: { display: "flex", background: "#08162a", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 54, zIndex: 9, overflowX: "auto" },
  navBtn: { flex: 1, minWidth: 80, padding: "13px 6px", background: "transparent", border: "none", borderBottom: "3px solid transparent", color: "#5a8fba", fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap", transition: "color .15s" },
  navActive: { color: "#fff", borderBottom: `3px solid ${RED}`, background: "#0d1f3c" },

  main: { flex: 1, overflowY: "auto" },
  tabContent: { padding: "18px 16px", maxWidth: 640, margin: "0 auto" },
  centerBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 16, padding: 24, textAlign: "center" },

  // Login
  loginWrap: { minHeight: "100vh", background: `linear-gradient(150deg, ${NAVY}, #0d1f3c)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  loginCard: { background: MID, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "40px 32px", maxWidth: 400, width: "100%", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,.6)" },
  puckEmoji: { fontSize: 60, marginBottom: 10 },
  loginTitle: { fontSize: 42, fontWeight: 900, letterSpacing: 4, textTransform: "uppercase", color: ICE, marginBottom: 6 },
  loginSub: { color: "#5a8fba", letterSpacing: 2, marginBottom: 28, fontSize: 13 },
  input: { width: "100%", padding: "12px 16px", background: "#060f1e", border: `1px solid ${BORDER}`, borderRadius: 10, color: "#fff", fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 16, fontFamily: "inherit" },
  existingWrap: { marginBottom: 16 },
  existingLabel: { fontSize: 12, color: "#5a8fba", marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  chip: { background: "#112240", border: `1px solid ${BORDER}`, color: ICE, borderRadius: 20, padding: "7px 18px", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 600 },

  primaryBtn: { background: RED, color: "#fff", border: "none", borderRadius: 10, padding: "14px 24px", fontSize: 15, fontWeight: 700, letterSpacing: 1, cursor: "pointer", width: "100%", textTransform: "uppercase", marginTop: 8, fontFamily: "inherit" },
  ghostBtn: { background: "transparent", color: "#5a8fba", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 20px", fontSize: 13, cursor: "pointer", width: "100%", marginTop: 12, fontFamily: "inherit" },
  ghostBtnSm: { background: "transparent", color: "#5a8fba", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },

  gameCard: { background: MID, border: `1px solid ${BORDER}`, borderRadius: 14, marginBottom: 20, overflow: "hidden", animation: "fadeUp .3s ease" },
  gameHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "#060f1e", borderBottom: `1px solid ${BORDER}` },
  teamBlock: { display: "flex", flexDirection: "column", alignItems: "flex-start" },
  abbr: { fontSize: 26, fontWeight: 900, color: ICE, letterSpacing: 2 },
  teamFull: { fontSize: 11, color: "#5a8fba", letterSpacing: 1, textTransform: "uppercase" },
  atSign: { fontSize: 20, color: RED, fontWeight: 900 },
  qBlock: { padding: "14px 20px", borderBottom: `1px solid #102040` },
  qText: { color: "#bdd8f0", fontSize: 15, marginBottom: 10, lineHeight: 1.4, fontFamily: "'Barlow', sans-serif", fontWeight: 500 },
  optRow: { display: "flex", gap: 10 },
  optBtn: { flex: 1, padding: "10px 10px", background: "#112240", border: `1px solid ${BORDER}`, borderRadius: 8, color: "#8abbd8", fontSize: 13, cursor: "pointer", fontFamily: "'Barlow', sans-serif", fontWeight: 500, textAlign: "left", transition: "all .15s", display: "flex", flexDirection: "column" },
  optSelected: { background: BLUE, border: `1px solid #4a8fd8`, color: "#fff" },
  optDimmed: { opacity: 0.4 },
  optCorrect: { background: "#0f3d1a", border: "1px solid #2a9d4a", color: "#4de87a" },
  optWrong: { background: "#3d0f15", border: "1px solid #9d2a35", color: "#e85565" },
  badge: { fontSize: 10, background: "#1e3a6a44", color: "#6a9fd8", borderRadius: 4, padding: "1px 6px", display: "inline-block" },

  progressRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
  progressLabel: { fontSize: 13, color: "#5a8fba", whiteSpace: "nowrap", letterSpacing: 1 },
  progressTrack: { flex: 1, height: 6, background: "#112240", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: `linear-gradient(90deg, ${BLUE}, ${RED})`, borderRadius: 3, transition: "width .4s" },

  successBanner: { background: "#0f3d1a", border: "1px solid #2a9d4a", color: "#4de87a", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14, textAlign: "center" },
  warningBanner: { background: "#2a1a06", border: "1px solid #7a5010", color: "#d4952a", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14, textAlign: "center" },
  scoreBanner: { background: "#0a2040", border: `1px solid ${BORDER}`, color: ICE, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 16, textAlign: "center", letterSpacing: 1 },
  resultsHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  resultsTitle: { fontSize: 26, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", color: ICE },
  resultsDate: { fontSize: 13, color: "#5a8fba", letterSpacing: 1 },
  resultOk: { color: "#4de87a", fontSize: 13, marginTop: 6, fontFamily: "'Barlow', sans-serif" },
  resultBad: { color: "#e85565", fontSize: 13, marginTop: 6, fontFamily: "'Barlow', sans-serif" },

  lbTitle: { fontSize: 22, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", color: ICE, marginBottom: 8, textAlign: "center" },
  lbLegend: { display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: 18, flexWrap: "wrap" },
  lbLegendItem: { fontSize: 12, color: "#5a8fba", letterSpacing: 0.5 },
  lbLegendSep: { color: "#2a4a6a" },
  lbRow: { display: "flex", alignItems: "center", background: MID, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 20px", marginBottom: 10, gap: 14, animation: "fadeUp .3s ease" },
  lbGold: { background: "#1a1a08", border: `1px solid ${GOLD}`, boxShadow: `0 0 24px ${GOLD}22` },
  lbSilver: { background: "#131820", border: "1px solid #8899aa" },
  lbHasHatTrick: { boxShadow: "0 0 16px #ffffff18" },
  lbMedal: { fontSize: 26, width: 32, flexShrink: 0 },
  lbCenter: { flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  lbName: { fontSize: 18, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: ICE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  lbHatTricks: { display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" },
  hatIcon: { fontSize: 14, lineHeight: 1 },
  lbRight: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  lbHatTrickCount: { display: "flex", flexDirection: "column", alignItems: "center", background: "#1a1a0a", border: "1px solid #5a4a10", borderRadius: 8, padding: "6px 10px", minWidth: 44 },
  lbHatNum: { fontSize: 22, fontWeight: 900, color: GOLD, lineHeight: 1 },
  lbHatLabel: { fontSize: 10, color: "#8a7a30", letterSpacing: 1, textTransform: "uppercase" },
  lbDivider: { width: 1, height: 36, background: BORDER },
  lbNum: { fontSize: 22, fontWeight: 900, color: ICE, lineHeight: 1 },
  lbDenom: { fontSize: 14, color: "#4a7ab0" },
  lbPct: { fontSize: 12, color: "#6a9fd8", background: "#112240", borderRadius: 6, padding: "2px 7px" },
  lbFootnote: { fontSize: 12, color: "#3a6a9a", textAlign: "center", marginTop: 16, lineHeight: 1.6, fontFamily: "'Barlow', sans-serif", padding: "12px 16px", background: "#060f1e", borderRadius: 10, border: `1px solid ${BORDER}` },
  scoreBannerHatTrick: { background: "#1a1a08", border: `2px solid ${GOLD}`, color: GOLD, boxShadow: `0 0 24px ${GOLD}33`, fontSize: 18, fontWeight: 700 },

  // Chat
  chatWrap: { display: "flex", flexDirection: "column", flex: 1, height: "calc(100vh - 110px)" },
  chatMessages: { flex: 1, overflowY: "auto", padding: "16px 16px 8px" },
  chatInputRow: { display: "flex", gap: 8, padding: "12px 16px", background: "#060f1e", borderTop: `1px solid ${BORDER}` },
  chatInput: { flex: 1, padding: "12px 16px", background: MID, border: `1px solid ${BORDER}`, borderRadius: 24, color: "#fff", fontSize: 15, outline: "none", fontFamily: "'Barlow', sans-serif" },
  sendBtn: { background: RED, color: "#fff", border: "none", borderRadius: 24, padding: "0 20px", fontSize: 18, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 },
  msgRow: { display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "#1a3a6e", color: ICE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 },
  msgUser: { fontSize: 11, color: "#5a8fba", letterSpacing: 0.5, textTransform: "uppercase", marginLeft: 4 },
  bubble: { padding: "10px 14px", borderRadius: 16, fontSize: 15, lineHeight: 1.4, fontFamily: "'Barlow', sans-serif" },
  bubbleMe: { background: RED, color: "#fff", borderBottomRightRadius: 4 },
  bubbleThem: { background: MID, color: ICE, border: `1px solid ${BORDER}`, borderBottomLeftRadius: 4 },
  msgTime: { fontSize: 11, color: "#3a6a9a", marginLeft: 4, marginRight: 4 },
  dayDivider: { display: "flex", alignItems: "center", justifyContent: "center", margin: "16px 0 8px" },
  dayLabel: { fontSize: 11, color: "#3a6a9a", background: "#060f1e", border: `1px solid ${BORDER}`, padding: "3px 12px", borderRadius: 20, letterSpacing: 1, textTransform: "uppercase" },

  loadingBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 },
  spinner: { width: 44, height: 44, border: `4px solid ${BORDER}`, borderTop: `4px solid ${RED}`, borderRadius: "50%", animation: "spin 1s linear infinite" },
  loadingText: { color: "#5a8fba", fontSize: 15 },
  emptyText: { color: "#5a8fba", fontSize: 16 },
  errorText: { color: RED, fontSize: 14 },
  hint: { color: "#3a6a9a", fontSize: 13, textAlign: "center", marginTop: 8, fontFamily: "'Barlow', sans-serif" },
};
