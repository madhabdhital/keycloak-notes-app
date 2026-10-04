import { useEffect, useRef, useState } from "react";
import Keycloak from "keycloak-js";

const API = "http://localhost:8080/api";

const keycloak = new Keycloak({
  url: "http://localhost:8090",
  realm: "notes-realm",
  clientId: "notes-frontend",
});

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f1f5f9; color: #1e293b; }
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 32px;
            background: linear-gradient(90deg, #4338ca, #6366f1); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  .brand { font-size: 20px; font-weight: 700; }
  .user { display: flex; align-items: center; gap: 12px; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; background: #fff; color: #4338ca;
            display: flex; align-items: center; justify-content: center; font-weight: 700; text-transform: uppercase; }
  .badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,.25); }
  .badge.admin { background: #fbbf24; color: #78350f; }
  .container { max-width: 760px; margin: 28px auto; padding: 0 16px; display: grid; gap: 20px; }
  .card { background: #fff; border-radius: 14px; padding: 22px; box-shadow: 0 2px 10px rgba(15,23,42,.08); }
  .card h2 { margin: 0 0 14px; font-size: 18px; }
  .row { display: flex; gap: 10px; }
  input { flex: 1; padding: 11px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; outline: none; }
  input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.2); }
  button { cursor: pointer; border: none; border-radius: 10px; padding: 10px 18px; font-size: 14px; font-weight: 600;
           background: #6366f1; color: #fff; transition: background .15s; }
  button:hover { background: #4f46e5; }
  button.ghost { background: rgba(255,255,255,.18); }
  button.ghost:hover { background: rgba(255,255,255,.3); }
  button.danger { background: #fee2e2; color: #b91c1c; padding: 6px 12px; }
  button.danger:hover { background: #fecaca; }
  button.light { background: #e0e7ff; color: #3730a3; }
  button.light:hover { background: #c7d2fe; }
  ul { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 12px;
       padding: 12px 14px; background: #f8fafc; border-left: 4px solid #6366f1; border-radius: 8px; }
  li.admin-item { border-left-color: #f59e0b; }
  .owner { font-size: 12px; font-weight: 700; color: #b45309; display: block; }
  .empty { margin: 16px 0 0; color: #94a3b8; font-style: italic; }
  .error { background: #fee2e2; color: #991b1b; padding: 12px 16px; border-radius: 10px; }
  pre { background: #0f172a; color: #a5f3fc; padding: 14px; border-radius: 10px; overflow: auto; font-size: 13px; margin: 14px 0 0; }
  .hero { min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #4338ca, #7c3aed); padding: 16px; }
  .login-card { background: #fff; border-radius: 18px; padding: 44px 40px; text-align: center; max-width: 380px;
                box-shadow: 0 20px 50px rgba(0,0,0,.25); }
  .login-card h1 { margin: 0 0 8px; }
  .login-card p { color: #64748b; margin: 0 0 24px; }
  .login-card button { width: 100%; padding: 13px; font-size: 16px; }
`;

export default function App() {
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
  const [text, setText] = useState("");
  const [showToken, setShowToken] = useState(false);

  const roles = keycloak.tokenParsed?.realm_access?.roles || [];
  const isAdmin = roles.includes("admin");
  const username = keycloak.tokenParsed?.preferred_username || "";

  // Calls the backend, attaching the access token (refreshed if expiring soon).
  async function api(path, method = "GET", body) {
    await keycloak.updateToken(30);
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: "Bearer " + keycloak.token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} failed with status ${res.status}`);
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  }

  async function loadNotes() {
    try {
      setError("");
      setNotes(await api("/notes"));
      const currentRoles = keycloak.tokenParsed?.realm_access?.roles || [];
      if (currentRoles.includes("admin")) setAllNotes(await api("/admin/notes"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function addNote() {
    if (!text.trim()) return;
    try {
      await api("/notes", "POST", { content: text });
      setText("");
      loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteNote(id, asAdmin) {
    try {
      await api(asAdmin ? `/admin/notes/${id}` : `/notes/${id}`, "DELETE");
      loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    keycloak
      .init({ onLoad: "check-sso", pkceMethod: "S256", checkLoginIframe: false })
      .then((authenticated) => {
        setReady(true);
        if (authenticated) loadNotes();
      })
      .catch((e) => setError("Keycloak init failed: " + e));
  }, []);

  if (!ready) {
    return (<><style>{css}</style><p style={{ padding: 24 }}>Loading...</p></>);
  }

  if (!keycloak.authenticated) {
    return (
      <>
        <style>{css}</style>
        <div className="hero">
          <div className="login-card">
            <h1>Notes App</h1>
            <p>Secure notes, protected by Keycloak. Log in to see your notes.</p>
            <button onClick={() => keycloak.login()}>Login with Keycloak</button>
            {error && <p className="error" style={{ marginTop: 16 }}>{error}</p>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="topbar">
        <div className="brand">Notes App</div>
        <div className="user">
          <div className="avatar">{username.charAt(0)}</div>
          <span>{username}</span>
          {roles.filter((r) => r === "user" || r === "admin").map((r) => (
            <span key={r} className={"badge " + r}>{r}</span>
          ))}
          <button className="ghost" onClick={() => keycloak.logout({ redirectUri: window.location.origin })}>
            Logout
          </button>
        </div>
      </div>

      <div className="container">
        {error && <div className="error">{error}</div>}

        <div className="card">
          <h2>My notes</h2>
          <div className="row">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
              placeholder="Write a note and press Enter"
            />
            <button onClick={addNote}>Add</button>
          </div>
          {notes.length === 0 ? (
            <p className="empty">You have no notes yet.</p>
          ) : (
            <ul>
              {notes.map((n) => (
                <li key={n.id}>
                  <span>{n.content}</span>
                  <button className="danger" onClick={() => deleteNote(n.id, false)}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isAdmin && (
          <div className="card">
            <h2>All notes (admin only)</h2>
            {allNotes.length === 0 ? (
              <p className="empty">No notes in the system.</p>
            ) : (
              <ul>
                {allNotes.map((n) => (
                  <li key={n.id} className="admin-item">
                    <span>
                      <span className="owner">{n.ownerUsername}</span>
                      {n.content}
                    </span>
                    <button className="danger" onClick={() => deleteNote(n.id, true)}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="card">
          <h2>Access token</h2>
          <button className="light" onClick={() => setShowToken(!showToken)}>
            {showToken ? "Hide" : "Show"} decoded token
          </button>
          {showToken && <pre>{JSON.stringify(keycloak.tokenParsed, null, 2)}</pre>}
        </div>
      </div>
    </>
  );
}