import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import {
  Home,
  MessageSquare,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  MoreHorizontal,
  LogOut,
  Download,
  Check,
  Send,
} from "lucide-react";
import "./style.css";
import "./sidebar-fixes.css";
import { BrandMark } from "./BrandMark";
import { CasesPage } from "./CasesPage";
const API = "http://localhost:8000/api/v1";
let token = localStorage.getItem("dpo_session") || "";
const api = (p: string, o: any = {}) =>
  fetch(API + p, { ...o, headers: { "x-session": token, ...o.headers } }).then(
    async (r) => {
      if (!r.ok) throw Error((await r.json()).detail);
      return r.json();
    },
  );
const S: any = {
  NEW: "Новое обращение",
  COLLECTING_SPEC_DATA: "Подготовка ТЗ",
  SPEC_REVIEW: "Проверка ТЗ",
  COMPLETED: "Завершено",
  ESCALATED_TO_DPO: "Требуется участие ДПО",
};
const L: any = {
  subject: "Предмет закупки",
  purpose: "Цель закупки",
  scope: "Объём работ / поставки",
  functional_requirements: "Функциональные требования",
  nonfunctional_requirements: "Нефункциональные требования",
  deadline: "Срок выполнения",
  acceptance_criteria: "Критерии приёмки",
  other_conditions: "Прочие условия",
};
const dl = (p: string, n: string) =>
  fetch(API + p, { headers: { "x-session": token } })
    .then((r) => r.blob())
    .then((b) => {
      let a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = n;
      a.click();
    });
function Login({ setUser }: any) {
  let n = useNavigate(),
    [l, setL] = useState("ivanov"),
    [p, setP] = useState("ivanov"),
    [e, setE] = useState("");
  if (token) return <Navigate to="/" />;
  return (
    <main className="login">
      <form
        onSubmit={async (x) => {
          x.preventDefault();
          try {
            let r = await api("/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ external_id: l, password: p }),
            });
            token = r.session_id;
            localStorage.setItem("dpo_session", token);
            setUser(r.user);
            n("/");
          } catch {
            setE("Неверный логин или пароль");
          }
        }}
      >
        <div className="logo">
          ДПО <span>Ассистент</span>
        </div>
        <p>Помощник по подготовке закупочных документов</p>
        <h1>Вход в систему</h1>
        <label>
          Логин
          <input value={l} onChange={(x) => setL(x.target.value)} />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={p}
            onChange={(x) => setP(x.target.value)}
          />
        </label>
        {e && <div className="error">{e}</div>}
        <button>Войти</button>
      </form>
    </main>
  );
}
function Account({ u, logout }: any) {
  let [o, setO] = useState(false),
    ini = u.full_name
      .split(" ")
      .slice(0, 2)
      .map((x: string) => x[0])
      .join("");
  return (
    <div className="account">
      <button className="account-btn" onClick={() => setO(!o)}>
        <i>{ini}</i>
        <span>
          <b>{u.full_name.split(" ").slice(0, 2).join(" ")}</b>
          <small>{u.department}</small>
        </span>
        <MoreHorizontal size={18} />
      </button>
      {o && (
        <div className="account-pop">
          <b>{u.full_name}</b>
          <small>{u.email}</small>
          <small>{u.department}</small>
          <hr />
          <button onClick={logout}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}
function Contract({ r }: any) {
  return (
    <section className="contract">
      <Check />
      <small>ПОДХОДЯЩИЙ ШАБЛОН НАЙДЕН</small>
      <h3>{r.name}</h3>
      <p>{r.description}</p>
      <button
        onClick={() =>
          dl("/templates/" + r.template_id + "/download", r.name + ".docx")
        }
      >
        <Download size={16} /> Скачать шаблон
      </button>
    </section>
  );
}
function Shell({ u, logout }: any) {
  let nav = useNavigate(),
    loc = useLocation(),
    id = loc.pathname.match(/^\/cases\/([^/]+)$/)?.[1],
    [cases, setCases] = useState<any[]>([]),
    [c, setC] = useState<any>(),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [collapsed, setCollapsed] = useState(localStorage.getItem("side") === "1");
  let file = useRef<HTMLInputElement>(null);
  let load = async () => {
    let list = await api("/cases");
    setCases(list);
    setC(id ? await api("/cases/" + id) : undefined);
  };
  useEffect(() => {
    load().catch(logout);
  }, [id, u.id]);
  let create = async () => {
    let empty = cases.find(
      (x) => x.title === "Новое обращение" && x.state === "NEW",
    );
    nav(
      "/cases/" +
        (empty?.id ||
          (
            await api("/cases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          ).id),
    );
  };
  let send = async () => {
    if (!text) return;
    setBusy(true);
    await api("/cases/" + c.id + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    setText("");
    await load();
    setBusy(false);
  };
  let upload = async (f: File) => {
    setBusy(true);
    let form = new FormData();
    form.append("file", f);
    let r = await api("/cases/" + c.id + "/attachments", {
      method: "POST",
      body: form,
    });
    setC(r.case);
    await load();
    setBusy(false);
  };
  let confirm = async () => {
    let r = await api("/cases/" + c.id + "/technical-specification/confirm", {
      method: "POST",
    });
    setResult(r);
    await load();
  };
  let rename = async () => {
    let t = prompt("Название обращения", c.title);
    if (t) {
      await api("/cases/" + c.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      load();
    }
  };
  if (loc.pathname === "/login") return <Navigate to="/" />;
  return (
    <div className={"app " + (collapsed ? "collapsed" : "")}>
      <aside className="side">
        <div className="side-head">
          <div className="sidebar-brand" onClick={() => nav("/")}>
            <BrandMark />
            <span className="brand-name">
              <b>ДПО</b> <strong>Ассистент</strong>
            </span>
          </div>
          <button
            className="collapse"
            onClick={() => {
              let v = !collapsed;
              setCollapsed(v);
              localStorage.setItem("side", v ? "1" : "0");
            }}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <button className="new" onClick={create}>
          <Plus />
          <span className="compact-plus" aria-hidden="true" style={collapsed?{display:"block",opacity:1,visibility:"visible",transform:"none",color:"#fff",fontSize:30,lineHeight:"20px"}:{display:"none"}}>+</span>
          <span>Новое обращение</span>
        </button>
        <button className="nav" onClick={() => nav("/")}>
          <Home style={collapsed?{display:"block",opacity:1,visibility:"visible",color:"#30423a"}:undefined} />
          <span>Главная</span>
        </button>
        <button className="nav" onClick={() => nav("/cases")}>
          <MessageSquare style={collapsed?{display:"block",opacity:1,visibility:"visible",color:"#30423a"}:undefined} />
          <span>Мои обращения</span>
        </button>
        <small className="recent">НЕДАВНИЕ</small>
        {cases.slice(0, 5).map((x) => (
          <button
            className="case"
            key={x.id}
            onClick={() => nav("/cases/" + x.id)}
          >
            <span>{x.title}</span>
            <em>{S[x.state]}</em>
          </button>
        ))}
        <Account u={u} logout={logout} />
      </aside>
      <main className="main">
        {loc.pathname === "/cases" ? (
          <CasesPage cases={cases} statuses={S} onOpen={(caseId) => nav("/cases/" + caseId)} />
        ) : !id ? (
          <section className="home">
            <p>Добрый день, {u.full_name.split(" ")[1]}!</p>
            <h1>Чем я могу помочь?</h1>
            <h2>
              Опишите задачу своими словами или загрузите готовое техническое
              задание.
            </h2>
            <div className="start">
              <button onClick={create}>
                <b>Подготовить техническое задание</b>
                <span>Собрать требования и сформировать документ</span>
              </button>
              <button onClick={create}>
                <b>Загрузить готовое ТЗ</b>
                <span>Проанализировать документ и подобрать шаблон</span>
              </button>
            </div>
            <h3>Последние обращения</h3>
            {cases.slice(0, 3).map((x) => (
              <button
                className="row"
                key={x.id}
                onClick={() => nav("/cases/" + x.id)}
              >
                {x.title}
                <span>{S[x.state]}</span>
              </button>
            ))}
          </section>
        ) : c ? (
          <section className="chat">
            <header>
              <div>
                <h2>
                  {c.title}
                  <button className="edit" onClick={rename}>
                    <Pencil size={15} />
                  </button>
                </h2>
                <p>Изменено недавно</p>
              </div>
              <b>{S[c.state]}</b>
            </header>
            <div className="feed">
              {c.messages.map((m: any) => (
                <article className={"msg " + m.role} key={m.id}>
                  {m.content}
                </article>
              ))}
              {busy && (
                <div className="thinking">Ассистент анализирует данные…</div>
              )}
              {result && <Contract r={result} />}
            </div>
            <div className="compose">
              <input
                ref={file}
                type="file"
                accept=".docx,.pdf,.xlsx"
                hidden
                onChange={(e) =>
                  e.target.files?.[0] && upload(e.target.files[0])
                }
              />
              <button className="attach" onClick={() => file.current?.click()}>
                <Paperclip />
              </button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Напишите сообщение…"
              />
              <button onClick={send}>
                <Send size={17} /> Отправить
              </button>
            </div>
          </section>
        ) : null}
      </main>
      {c && (
        <aside className="context">
          <h3>Обращение</h3>
          <p>
            Статус<b>{S[c.state]}</b>
          </p>
          {c.technical_specification && (
            <section className="spec">
              <h3>
                Техническое задание{" "}
                <small>Версия {c.technical_specification.version}</small>
              </h3>
              {Object.entries(c.technical_specification.data)
                .filter((x: any) => x[1])
                .map(([k, v]: any) => (
                  <div className="spec-line" key={k}>
                    <span>{L[k]}</span>
                    <b>{v}</b>
                  </div>
                ))}
              <div className="actions">
                <button
                  className="outline"
                  onClick={() =>
                    dl(
                      "/cases/" + c.id + "/technical-specification/download",
                      "Техническое_задание.docx",
                    )
                  }
                >
                  <Download size={15} /> Скачать ТЗ
                </button>
                <button onClick={confirm}>
                  <Check size={15} /> Подтвердить ТЗ
                </button>
              </div>
            </section>
          )}
          {c.recommendation && <Contract r={c.recommendation} />}
        </aside>
      )}
    </div>
  );
}
function App() {
  let [u, setU] = useState<any>(),
    [boot, setBoot] = useState(true);
  useEffect(() => {
    if (token)
      api("/auth/me")
        .then(setU)
        .catch(() => {
          token = "";
          localStorage.removeItem("dpo_session");
        })
        .finally(() => setBoot(false));
    else setBoot(false);
  }, []);
  let logout = async () => {
    if (token) await api("/auth/logout", { method: "POST" }).catch(() => {});
    token = "";
    localStorage.removeItem("dpo_session");
    setU(null);
    location.assign("/login");
  };
  return (
    <BrowserRouter>
      {boot ? (
        <main className="login">Загрузка…</main>
      ) : u ? (
        <Shell u={u} logout={logout} />
      ) : (
        <Login setUser={setU} />
      )}
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
