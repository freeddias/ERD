const STORAGE_KEY = "erd-builder-state";

const statusEl = document.getElementById("status");
const themeToggleButton = document.getElementById("theme-toggle");
const sandboxNewEmptyBtn = document.getElementById("sandbox-new-empty");
const sandboxBuildDbBtn = document.getElementById("sandbox-build-db");
const sandboxClearDbBtn = document.getElementById("sandbox-clear-db");
const sandboxSqlInput = document.getElementById("sandbox-sql-input");
const sandboxRunBtn = document.getElementById("sandbox-run");
const sandboxClearOutputBtn = document.getElementById("sandbox-clear-output");
const sandboxOutputWrap = document.getElementById("sandbox-output-wrap");
const sandboxDbBadge = document.getElementById("sandbox-db-badge");

let sqlJsFactory = null;
let sandboxDb = null;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleButton.textContent = theme === "light" ? "Tema: Claro" : "Tema: Escuro";
}

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  persistTheme(next);
}

function persistTheme(theme) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === "object" && parsed !== null) {
      parsed.theme = theme;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore
  }
}

function loadDiagramStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : []
    };
  } catch {
    return null;
  }
}

function initThemeFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.theme === "string") {
        applyTheme(parsed.theme);
        return;
      }
    }
  } catch {
    // ignore
  }
  const fallback = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(fallback);
}

async function ensureSqlJs() {
  if (sqlJsFactory) {
    return sqlJsFactory;
  }
  const initFn =
    typeof globalThis.initSqlJs === "function" ? globalThis.initSqlJs : null;
  if (!initFn) {
    throw new Error(
      "Não foi possível carregar sql.js. Verifique a conexão e recarregue a página."
    );
  }
  sqlJsFactory = await initFn({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
  });
  return sqlJsFactory;
}

function updateSandboxBadge(hasDb) {
  if (!sandboxDbBadge) {
    return;
  }
  if (hasDb) {
    sandboxDbBadge.textContent = "Banco de dados em memória";
    sandboxDbBadge.classList.add("sandbox-badge-ok");
  } else {
    sandboxDbBadge.textContent = "Sem banco de dados";
    sandboxDbBadge.classList.remove("sandbox-badge-ok");
  }
}

function disposeSandboxDb() {
  if (sandboxDb) {
    try {
      sandboxDb.close();
    } catch {
      // ignore
    }
    sandboxDb = null;
  }
  updateSandboxBadge(false);
}

/**
 * Divide o script em comandos pelo `;` fora de strings e comentários (-- e / * * /).
 */
function splitSqlStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (c === "\n" || c === "\r") {
        inLineComment = false;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (c === "-" && next === "-") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }

    if (c === "'" && !inDouble) {
      if (inSingle && next === "'") {
        cur += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      cur += c;
      i++;
      continue;
    }

    if (c === '"' && !inSingle) {
      if (inDouble && next === '"') {
        cur += '""';
        i += 2;
        continue;
      }
      inDouble = !inDouble;
      cur += c;
      i++;
      continue;
    }

    if (c === ";" && !inSingle && !inDouble) {
      const t = cur.trim();
      if (t) {
        out.push(t);
      }
      cur = "";
      i++;
      continue;
    }

    cur += c;
    i++;
  }

  const last = cur.trim();
  if (last) {
    out.push(last);
  }
  return out;
}

function snippetForDisplay(sql, maxLen) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLen)}…`;
}

function formatResultSetsToHtml(results) {
  if (!results || results.length === 0) {
    return "";
  }

  const blocks = [];
  for (const block of results) {
    if (!block.columns || block.columns.length === 0) {
      continue;
    }
    blocks.push(renderSandboxResultTable(block.columns, block.values || []));
  }
  return blocks.join("");
}

function renderSandboxResultTable(columns, values) {
  const header = columns
    .map((col) => `<th>${escapeHtml(String(col))}</th>`)
    .join("");
  const body = (values || [])
    .map((row) => {
      const cells = row
        .map((cell) => {
          const raw = cell === null || cell === undefined ? "" : String(cell);
          return `<td>${escapeHtml(raw)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="sandbox-table-wrap">
      <table class="sandbox-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${body || ""}</tbody>
      </table>
    </div>
  `;
}

/**
 * Executa cada comando no banco e devolve HTML com status (sucesso / erro SQLite) por comando.
 */
function runStatementsOnDb(db, scriptText) {
  const statements = splitSqlStatements(scriptText);
  if (statements.length === 0) {
    return "<p class=\"sandbox-msg sandbox-msg--muted\">Nenhum comando SQL (apenas comentários ou texto vazio).</p>";
  }

  const sections = [];
  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx];
    const num = idx + 1;
    const preview = snippetForDisplay(stmt, 160);

    try {
      const results = db.exec(stmt);
      const modified = db.getRowsModified();
      const tableHtml = formatResultSetsToHtml(results);
      const hasGrid = Boolean(tableHtml);
      const okParts = [
        `<p class="sandbox-cmd-status sandbox-cmd-status--ok"><span class="sandbox-cmd-icon">✓</span> Comando ${num} executado com <strong>sucesso</strong>.</p>`
      ];
      if (typeof modified === "number" && modified > 0) {
        okParts.push(
          `<p class="sandbox-cmd-detail">Linhas afetadas (última operação de escrita neste comando): <strong>${modified}</strong></p>`
        );
      }
      if (!hasGrid && (!modified || modified === 0)) {
        okParts.push(
          `<p class="sandbox-cmd-detail">Sem conjunto de linhas retornado (DDL, PRAGMA ou comando sem resultado tabular).</p>`
        );
      }

      sections.push(`
        <section class="sandbox-cmd-block">
          <header class="sandbox-cmd-head">
            <span class="sandbox-cmd-num">#${num}</span>
            <code class="sandbox-cmd-snippet">${escapeHtml(preview)}</code>
          </header>
          ${okParts.join("")}
          ${hasGrid ? `<div class="sandbox-cmd-grid">${tableHtml}</div>` : ""}
        </section>
      `);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      sections.push(`
        <section class="sandbox-cmd-block sandbox-cmd-block--error">
          <header class="sandbox-cmd-head">
            <span class="sandbox-cmd-num">#${num}</span>
            <code class="sandbox-cmd-snippet">${escapeHtml(preview)}</code>
          </header>
          <p class="sandbox-cmd-status sandbox-cmd-status--err"><span class="sandbox-cmd-icon">✗</span> Comando ${num} <strong>falhou</strong>.</p>
          <pre class="sandbox-cmd-err-detail" role="status">${escapeHtml(msg)}</pre>
          <p class="sandbox-cmd-hint">Motivo retornado pelo SQL: sintaxe não suportada, tabela inexistent.</p>
        </section>
      `);
    }
  }

  return `<div class="sandbox-cmd-list">${sections.join("")}</div>`;
}

async function ensureSandboxDbExists() {
  if (sandboxDb) {
    return;
  }
  const SQL = await ensureSqlJs();
  sandboxDb = new SQL.Database();
  sandboxDb.run("PRAGMA foreign_keys = ON;");
  updateSandboxBadge(true);
}

async function buildSandboxFromDiagram() {
  const diagram = loadDiagramStateFromStorage();
  if (!diagram || diagram.entities.length === 0) {
    setStatus("Nenhum diagrama no armazenamento. Crie tabelas no Diagramador (salva automaticamente).");
    return;
  }

  const generateSqliteDdl = window.ErdSqliteDdl?.generateSqliteDdl;
  if (typeof generateSqliteDdl !== "function") {
    setStatus("Erro interno: gerador indisponível.");
    return;
  }

  const ddl = generateSqliteDdl(diagram);
  if (ddl.includes("Nenhuma tabela")) {
    setStatus("Não há tabelas no diagrama salvo.");
    return;
  }

  disposeSandboxDb();

  try {
    await ensureSqlJs();
    await ensureSandboxDbExists();
    sandboxOutputWrap.innerHTML = runStatementsOnDb(sandboxDb, ddl);
    setStatus("Banco montado a partir do diagrama — veja o resultado de cada comando abaixo.");
  } catch (err) {
    disposeSandboxDb();
    const msg = err && err.message ? err.message : String(err);
    sandboxOutputWrap.innerHTML = `<p class="sandbox-msg sandbox-msg--error">${escapeHtml(msg)}</p>`;
    setStatus("Falha ao criar o banco.");
  }
}

async function runSandboxSql() {
  const text = (sandboxSqlInput?.value || "").trim();
  if (!text) {
    setStatus("Digite ao menos um comando SQL.");
    return;
  }

  try {
    await ensureSandboxDbExists();
    sandboxOutputWrap.innerHTML = runStatementsOnDb(sandboxDb, text);
    setStatus("Execução concluída — veja o resultado de cada comando abaixo.");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    sandboxOutputWrap.innerHTML = `<p class="sandbox-msg sandbox-msg--error">${escapeHtml(msg)}</p>`;
    setStatus("Erro ao preparar ou executar SQL.");
  }
}

async function createNewEmptyDb() {
  disposeSandboxDb();
  try {
    await ensureSandboxDbExists();
    setStatus("Novo banco vazio criado — use o console para CREATE TABLE e demais comandos.");
    sandboxOutputWrap.innerHTML =
      "<p class=\"sandbox-msg sandbox-msg--ok\">Banco vazio pronto. Você pode criar o schema e os dados apenas com SQL no console.</p>";
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    sandboxOutputWrap.innerHTML = `<p class="sandbox-msg sandbox-msg--error">${escapeHtml(msg)}</p>`;
    setStatus("Não foi possível criar o banco.");
  }
}

//themeToggleButton.addEventListener("click", toggleTheme);

sandboxNewEmptyBtn.addEventListener("click", () => {
  void createNewEmptyDb();
});

sandboxBuildDbBtn.addEventListener("click", () => {
  void buildSandboxFromDiagram();
});

sandboxClearDbBtn.addEventListener("click", () => {
  disposeSandboxDb();
  setStatus("Banco em memória descartado.");
  sandboxClearOutputBtn.click();
});

sandboxRunBtn.addEventListener("click", () => {
  void runSandboxSql();
});

sandboxClearOutputBtn.addEventListener("click", () => {
  sandboxOutputWrap.innerHTML =
    "<p class=\"sandbox-msg sandbox-msg--muted\">Saída limpa. Execute SQL acima para ver o resultado de cada comando.</p>";
});

initThemeFromStorage();

const diagram = loadDiagramStateFromStorage();
if (diagram && diagram.entities.length > 0) {
  setStatus(
    "Diagrama encontrado no armazenamento. Você pode usar SQL puro, Novo banco vazio ou montar a partir do diagrama."
  );
} else {
  setStatus(
    "Use o console para criar o banco com SQL (um banco vazio é criado ao executar) ou importe do Diagramador."
  );
}
