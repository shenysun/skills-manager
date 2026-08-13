function App() {
  const [surface, setSurface] = React.useState("installed");
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState(["langfuse", "code-review"]);
  const [skills, setSkills] = React.useState(window.SM_DATA.skills);
  const [drawer, setDrawer] = React.useState(null);
  const [more, setMore] = React.useState(false);
  const [toast, setToast] = React.useState("");
  const [advanced, setAdvanced] = React.useState(false);

  function ping(msg) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  function toggle(name) {
    setSelected((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }

  function wire(consumer) {
    if (!selected.length) return;
    setSkills((list) => list.map((s) => {
      if (!selected.includes(s.name)) return s;
      if (consumer === "claude") return { ...s, claude: true };
      return { ...s, agents: true };
    }));
    ping("已接到 " + (consumer === "claude" ? "Claude" : "Agents") + " · " + selected.length + " 个");
    setMore(false);
  }

  function unwire(consumer) {
    setSkills((list) => list.map((s) => {
      if (!selected.includes(s.name)) return s;
      if (consumer === "claude") return { ...s, claude: false };
      return { ...s, agents: false };
    }));
    ping("已从 " + (consumer === "claude" ? "Claude" : "Agents") + " 拿掉");
    setMore(false);
  }

  const filtered = skills.filter((s) => {
    const hay = (s.name + s.desc + s.category).toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  const wiredClaude = skills.filter((s) => s.claude).length;
  const wiredAgents = skills.filter((s) => s.agents).length;
  const updates = skills.filter((s) => s.update).length;

  return (
    <div className="app" data-screen-label="dashboard">
      <aside className="side">
        <div className="brand">Skills Manager</div>
        <nav>
          {[
            ["overview", "概览"],
            ["installed", "Skills"],
            ["sources", "来源"],
            ["registry", "注册表"],
            ["activity", "活动"]
          ].map(([id, label]) => (
            <button key={id} className={"nav-btn" + (surface === id ? " active" : "")} onClick={() => setSurface(id)}>
              <IconDot></IconDot>
              {label}
            </button>
          ))}
        </nav>
        <div className="side-meta">
          hub<br></br>
          {window.SM_DATA.home}
        </div>
      </aside>
      <section className="main">
        <header className="top">
          <div className="top-title">{({ overview: "概览", installed: "Skills", sources: "来源", registry: "注册表", activity: "活动" })[surface]}</div>
          <div className="top-actions">
            <button className="ghost" onClick={() => ping("安装向导（原型）")}>安装 Skill</button>
          </div>
        </header>
        <div className="page">
          {surface === "overview" && (
            <div data-screen-label="overview">
              <h1 className="h1">这台机器上的技能库</h1>
              <p className="lede">内容只在 hub 管一份。Claude / Agents 能加载的，是已经接到运行时的那些。</p>
              <div className="stats">
                <div className="stat"><div className="k">Hub skills</div><div className="v">{skills.length}</div></div>
                <div className="stat"><div className="k">Claude</div><div className="v">{wiredClaude}</div><div className="n">已接入运行时</div></div>
                <div className="stat"><div className="k">Agents</div><div className="v">{wiredAgents}</div><div className="n">已接入运行时</div></div>
                <div className="stat"><div className="k">可更新</div><div className="v">{updates}</div></div>
              </div>
              <div className="health">
                <span className="dot ok"></span>
                <div>
                  <div>运行时健康</div>
                  <div style={{ color: "var(--muted)", marginTop: 4 }}>没有损坏的链接。2 个 skill 有上游更新。</div>
                </div>
              </div>
            </div>
          )}

          {surface === "installed" && (
            <div data-screen-label="installed">
              <h1 className="h1">Hub 里的 skills</h1>
              <p className="lede">勾选后接到 Claude 或 Agents。更新、归档、项目分发放在「更多」——默认不占主路径。</p>
              <div className="toolbar">
                <input className="search" placeholder="搜索名称、分类…" value={q} onChange={(e) => setQ(e.target.value)}></input>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Skill</th>
                    <th>运行时</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.name} className={selected.includes(s.name) ? "selected" : ""} onClick={() => setDrawer(s)}>
                      <td onClick={(e) => { e.stopPropagation(); toggle(s.name); }}>
                        <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggle(s.name)}></input>
                      </td>
                      <td>
                        <div className="skill-name">{s.name}</div>
                        <div className="skill-desc">{s.desc}</div>
                      </td>
                      <td>
                        <div className="pills">
                          {s.claude ? <span className="pill on-claude">Claude</span> : null}
                          {s.agents ? <span className="pill on-agents">Agents</span> : null}
                          {!s.claude && !s.agents ? <span className="pill">未接入</span> : null}
                        </div>
                      </td>
                      <td>{s.update ? <span className="pill" style={{ color: "var(--warn)" }}>可更新</span> : <span className="pill">当前</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {surface === "sources" && (
            <div data-screen-label="sources">
              <h1 className="h1">来源</h1>
              <p className="lede">按仓库发现和更新。安装新 skill 用顶栏。</p>
              <div className="sources-list">
                {window.SM_DATA.sources.map((src) => (
                  <div className="source-row" key={src.url}>
                    <code>{src.url}</code>
                    <span className="pill">{src.count} skills</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {surface === "registry" && (
            <div data-screen-label="registry">
              <h1 className="h1">注册表</h1>
              <p className="lede">只编辑安全字段。这里不接线到运行时。</p>
              <p className="empty">选择 Skills 列表里的条目，在抽屉中看元数据。</p>
            </div>
          )}

          {surface === "activity" && (
            <div data-screen-label="activity">
              <h1 className="h1">活动</h1>
              <p className="lede">操作记录与 workspace。主题和语言在这里不抢主导航。</p>
              <div className="health"><span className="dot ok"></span><div>最近：接到 Claude · langfuse, code-review</div></div>
            </div>
          )}
        </div>
      </section>

      {selected.length > 0 && surface === "installed" ? (
        <div className="command" style={{ position: "fixed" }}>
          <span className="count">{selected.length} 已选</span>
          <button className="primary" onClick={() => wire("claude")}>接到 Claude</button>
          <button className="ghost" onClick={() => wire("agents")}>接到 Agents</button>
          <div style={{ position: "relative" }}>
            <button className="ghost" onClick={() => setMore((v) => !v)}>更多</button>
            {more ? (
              <div className="more">
                <button onClick={() => unwire("claude")}>从 Claude 拿掉</button>
                <button onClick={() => unwire("agents")}>从 Agents 拿掉</button>
                <button onClick={() => ping("已更新选中项（原型）")}>更新选中</button>
                <button onClick={() => setAdvanced(true)}>项目分发 / 模式…</button>
                <button onClick={() => ping("回滚上一刀（原型）")}>回滚上次分发</button>
                <button onClick={() => ping("已归档（原型）")}>归档</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {drawer ? (
        <div>
          <div className="drawer-mask" onClick={() => setDrawer(null)}></div>
          <aside className="drawer">
            <h2>{drawer.name}</h2>
            <p style={{ color: "var(--muted)" }}>{drawer.desc}</p>
            <div className="field">
              <label>分类</label>
              <div>{drawer.category}</div>
            </div>
            <div className="field">
              <label>运行时</label>
              <div className="pills" style={{ marginTop: 4 }}>
                {drawer.claude ? <span className="pill on-claude">Claude</span> : <span className="pill">Claude 未接</span>}
                {drawer.agents ? <span className="pill on-agents">Agents</span> : <span className="pill">Agents 未接</span>}
              </div>
            </div>
            <button className="primary" onClick={() => { setSelected([drawer.name]); wire("claude"); }}>接到 Claude</button>
          </aside>
        </div>
      ) : null}

      {advanced ? (
        <div>
          <div className="drawer-mask" onClick={() => setAdvanced(false)}></div>
          <aside className="drawer">
            <h2>高级分发</h2>
            <p style={{ color: "var(--muted)" }}>默认是接到这台机器。项目 copy 和模式放这里，不进主工具栏。</p>
            <div className="field">
              <label>目标</label>
              <select defaultValue="user">
                <option value="user">这台机器（symlink）</option>
                <option value="project">某个项目（copy）</option>
              </select>
            </div>
            <div className="field">
              <label>项目根目录</label>
              <input placeholder="/path/to/project"></input>
            </div>
            <button className="primary" onClick={() => { ping("已按高级选项分发（原型）"); setAdvanced(false); }}>应用</button>
          </aside>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App></App>);
