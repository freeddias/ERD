const STORAGE_KEY = "erd-builder-state";

const state = {
  entities: [],
  relations: []
};

const workspace = document.getElementById("workspace");
const relationsLayer = document.getElementById("relations-layer");
const relationsList = document.getElementById("relations-list");
const entityTemplate = document.getElementById("entity-template");
const fieldTemplate = document.getElementById("field-template");
const fromEntitySelect = document.getElementById("from-entity");
const toEntitySelect = document.getElementById("to-entity");
const fromFieldSelect = document.getElementById("from-field");
const toFieldSelect = document.getElementById("to-field");
const relTypeSelect = document.getElementById("rel-type");
const fkNameInput = document.getElementById("fk-name");
const statusEl = document.getElementById("status");
const themeToggleButton = document.getElementById("theme-toggle");

let drag = null;

document.getElementById("add-entity").addEventListener("click", () => {
  createEntity();
});

fromEntitySelect.addEventListener("change", updateFieldSelectors);
toEntitySelect.addEventListener("change", updateFieldSelectors);

window.addEventListener("resize", () => {
  resizeAllEntityCards();
  drawRelations();
});

themeToggleButton.addEventListener("click", toggleTheme);

workspace.addEventListener("dblclick", (event) => {
  if (event.target.closest(".entity-card") || event.target.closest(".relation-hit")) {
    return;
  }

  const workspaceRect = workspace.getBoundingClientRect();
  const x = clamp(
    event.clientX - workspaceRect.left + workspace.scrollLeft - 60,
    0,
    Math.max(workspace.scrollWidth - 320, 0)
  );
  const y = clamp(
    event.clientY - workspaceRect.top + workspace.scrollTop - 24,
    0,
    Math.max(workspace.scrollHeight - 120, 0)
  );

  createEntity({ x, y });
  setStatus("Tabela criada com duplo clique.");
});

document.getElementById("add-relation").addEventListener("click", () => {
  const fromId = fromEntitySelect.value;
  const toId = toEntitySelect.value;
  const fromFieldId = fromFieldSelect.value;
  const toFieldId = toFieldSelect.value;
  const type = relTypeSelect.value;
  const fkName = (fkNameInput.value || "").trim();

  if (!fromId || !toId || fromId === toId) {
    setStatus("Escolha entidades diferentes para criar um relacionamento.");
    return;
  }

  if (!fromFieldId || !toFieldId) {
    setStatus("Selecione os campos de FK (origem e destino).");
    return;
  }

  const exists = state.relations.some(
    (relation) =>
      relation.fromId === fromId &&
      relation.toId === toId &&
      relation.fromFieldId === fromFieldId &&
      relation.toFieldId === toFieldId
  );

  if (exists) {
    setStatus("Esse vínculo FK já existe.");
    return;
  }

  state.relations.push({
    id: uid(),
    fromId,
    toId,
    fromFieldId,
    toFieldId,
    fkName,
    type
  });

  drawRelations();
  persistAppState();
  setStatus("Relacionamento FK criado com sucesso.");
});

document.getElementById("export-json").addEventListener("click", async () => {
  const payload = JSON.stringify(
    {
      entities: state.entities,
      relations: state.relations,
      theme: getCurrentTheme()
    },
    null,
    2
  );

  try {
    await navigator.clipboard.writeText(payload);
    setStatus("JSON copiado para a área de transferência.");
  } catch {
    setStatus("Não foi possível copiar automaticamente. Use Ctrl+C manualmente.");
    window.prompt("Copie o JSON:", payload);
  }
});

document.getElementById("export-sql").addEventListener("click", async () => {
  const sql = generateSqlDdl();
  try {
    await navigator.clipboard.writeText(sql);
    setStatus("SQL (DDL) copiado para a área de transferência.");
  } catch {
    setStatus("Não foi possível copiar automaticamente. Use Ctrl+C manualmente.");
    window.prompt("Copie o SQL:", sql);
  }
});

relationsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-relation-id]");
  if (!button) {
    return;
  }

  removeRelationById(button.dataset.relationId);
});

relationsLayer.addEventListener("click", (event) => {
  const hit = event.target.closest(".relation-hit");
  if (!hit) {
    return;
  }

  removeRelationById(hit.dataset.relationId);
});

function createEntity(initial = {}) {
  const entity = {
    id: initial.id || uid(),
    name: initial.name || `tabela_${state.entities.length + 1}`,
    x: Number.isFinite(initial.x) ? initial.x : 40 + state.entities.length * 28,
    y: Number.isFinite(initial.y) ? initial.y : 40 + state.entities.length * 24,
    fields:
      Array.isArray(initial.fields) && initial.fields.length > 0
        ? initial.fields.map(normalizeField)
        : [
            { id: uid(), name: "id", type: "INT", pk: true },
            { id: uid(), name: "created_at", type: "DATE", pk: false }
          ]
  };

  state.entities.push(entity);
  renderEntity(entity);
  updateEntitySelectors();
  drawRelations();
  persistAppState();
}

function renderEntity(entity) {
  const fragment = entityTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".entity-card");
  const header = fragment.querySelector(".entity-header");
  const nameInput = fragment.querySelector(".entity-name");
  const fieldsWrap = fragment.querySelector(".fields");
  const addFieldBtn = fragment.querySelector(".add-field");
  const removeBtn = fragment.querySelector(".remove-entity");

  card.dataset.entityId = entity.id;
  card.style.left = `${entity.x}px`;
  card.style.top = `${entity.y}px`;
  nameInput.value = entity.name;
  autoSizeTextControl(nameInput, 12, 60);

  nameInput.addEventListener("input", () => {
    entity.name = nameInput.value.trim() || "sem_nome";
    autoSizeTextControl(nameInput, 12, 60);
    adjustEntityCardWidth(entity.id);
    updateEntitySelectors();
    drawRelations();
    persistAppState();
  });

  addFieldBtn.addEventListener("click", () => {
    const field = { id: uid(), name: "campo", type: "VARCHAR", pk: false };
    entity.fields.push(field);
    renderField(entity, fieldsWrap, field);
    adjustEntityCardWidth(entity.id);
    updateFieldSelectors();
    drawRelations();
    persistAppState();
  });

  removeBtn.addEventListener("click", () => {
    card.remove();
    state.entities = state.entities.filter((item) => item.id !== entity.id);
    syncRelations();
    updateEntitySelectors();
    drawRelations();
    persistAppState();
    setStatus("Entidade removida.");
  });

  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input,button,select,label")) {
      return;
    }

    drag = {
      entity,
      card,
      offsetX: event.clientX - card.offsetLeft,
      offsetY: event.clientY - card.offsetTop
    };

    header.style.cursor = "grabbing";
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!drag || drag.card !== card) {
      return;
    }

    const maxX = Math.max(workspace.scrollWidth - card.offsetWidth, 0);
    const maxY = Math.max(workspace.scrollHeight - card.offsetHeight, 0);

    const x = clamp(event.clientX - drag.offsetX + workspace.scrollLeft, 0, maxX);
    const y = clamp(event.clientY - drag.offsetY + workspace.scrollTop, 0, maxY);

    entity.x = x;
    entity.y = y;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    drawRelations();
  });

  card.addEventListener("pointerup", (event) => {
    if (!drag || drag.card !== card) {
      return;
    }

    drag = null;
    header.style.cursor = "grab";
    card.releasePointerCapture(event.pointerId);
    persistAppState();
  });

  entity.fields.forEach((field) => renderField(entity, fieldsWrap, field));
  workspace.appendChild(fragment);
  adjustEntityCardWidth(entity.id);
}

function renderField(entity, wrap, field) {
  const fragment = fieldTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".field-row");
  const nameInput = fragment.querySelector(".field-name");
  const typeSelect = fragment.querySelector(".field-type");
  const pkInput = fragment.querySelector(".field-pk");
  const removeFieldFkBtn = fragment.querySelector(".remove-field-fk");
  const removeBtn = fragment.querySelector(".remove-field");

  row.dataset.fieldId = field.id;
  nameInput.value = field.name;
  typeSelect.value = field.type;
  pkInput.checked = field.pk;
  autoSizeTextControl(nameInput, 10, 70);
  autoSizeSelectControl(typeSelect, 8, 22);

  nameInput.addEventListener("input", () => {
    field.name = nameInput.value.trim() || "campo";
    autoSizeTextControl(nameInput, 10, 70);
    adjustEntityCardWidth(entity.id);
    updateFieldSelectors();
    drawRelations();
    persistAppState();
  });

  typeSelect.addEventListener("change", () => {
    field.type = typeSelect.value;
    autoSizeSelectControl(typeSelect, 8, 22);
    adjustEntityCardWidth(entity.id);
    updateFieldSelectors();
    drawRelations();
    persistAppState();
  });

  pkInput.addEventListener("change", () => {
    field.pk = pkInput.checked;
    updateFieldSelectors();
    persistAppState();
  });

  removeFieldFkBtn.addEventListener("click", () => {
    const countBefore = state.relations.length;
    state.relations = state.relations.filter((relation) => relation.fromFieldId !== field.id);

    if (state.relations.length !== countBefore) {
      drawRelations();
      persistAppState();
      setStatus("FK removida do campo selecionado.");
    }
  });

  removeBtn.addEventListener("click", () => {
    entity.fields = entity.fields.filter((item) => item.id !== field.id);
    syncRelations();
    row.remove();
    adjustEntityCardWidth(entity.id);
    updateFieldSelectors();
    drawRelations();
    persistAppState();
  });

  wrap.appendChild(fragment);
}

function updateEntitySelectors() {
  const prevFrom = fromEntitySelect.value;
  const prevTo = toEntitySelect.value;

  const options = state.entities
    .map((entity) => `<option value="${entity.id}">${escapeHtml(entity.name)}</option>`)
    .join("");

  fromEntitySelect.innerHTML = options;
  toEntitySelect.innerHTML = options;

  if (prevFrom && state.entities.some((entity) => entity.id === prevFrom)) {
    fromEntitySelect.value = prevFrom;
  }

  if (prevTo && state.entities.some((entity) => entity.id === prevTo)) {
    toEntitySelect.value = prevTo;
  }

  updateFieldSelectors();
}

function updateFieldSelectors() {
  const fromEntity = getEntityById(fromEntitySelect.value);
  const toEntity = getEntityById(toEntitySelect.value);
  const prevFromField = fromFieldSelect.value;
  const prevToField = toFieldSelect.value;

  fromFieldSelect.innerHTML = createFieldOptions(fromEntity);
  toFieldSelect.innerHTML = createFieldOptions(toEntity);

  if (fromEntity && fromEntity.fields.some((field) => field.id === prevFromField)) {
    fromFieldSelect.value = prevFromField;
  }

  if (toEntity && toEntity.fields.some((field) => field.id === prevToField)) {
    toFieldSelect.value = prevToField;
  }
}

function createFieldOptions(entity) {
  if (!entity || entity.fields.length === 0) {
    return "<option value=''>Sem campos</option>";
  }

  return entity.fields
    .map((field) => {
      const flag = field.pk ? " [PK]" : "";
      return `<option value="${field.id}">${escapeHtml(field.name)} (${field.type})${flag}</option>`;
    })
    .join("");
}

function drawRelations() {
  syncRelations();

  const layerWidth = Math.max(workspace.scrollWidth, workspace.clientWidth, 1200);
  const layerHeight = Math.max(workspace.scrollHeight, workspace.clientHeight, 800);
  relationsLayer.setAttribute("width", String(layerWidth));
  relationsLayer.setAttribute("height", String(layerHeight));

  const lines = [
    "<defs><marker id='arrowhead' markerWidth='10' markerHeight='7' refX='9' refY='3.5' orient='auto'><polygon points='0 0, 10 3.5, 0 7' fill='#8af8cd'></polygon></marker></defs>"
  ];

  for (const relation of state.relations) {
    const fromAnchor = getFieldAnchor(relation.fromFieldId, "right");
    const toAnchor = getFieldAnchor(relation.toFieldId, "left");

    if (!fromAnchor || !toAnchor) {
      continue;
    }

    const curve = Math.max(Math.abs(toAnchor.x - fromAnchor.x) * 0.35, 50);
    const path = `M ${fromAnchor.x} ${fromAnchor.y} C ${fromAnchor.x + curve} ${fromAnchor.y}, ${toAnchor.x - curve} ${toAnchor.y}, ${toAnchor.x} ${toAnchor.y}`;

    const labelX = (fromAnchor.x + toAnchor.x) / 2;
    const labelY = (fromAnchor.y + toAnchor.y) / 2 - 8;

    const fromFieldName = getFieldNameById(relation.fromFieldId);
    const toFieldName = getFieldNameById(relation.toFieldId);

    const parts = [relation.fkName || "FK", relation.type, `${fromFieldName} -> ${toFieldName}`];

    lines.push(`<path class="relation-line" marker-end="url(#arrowhead)" d="${path}" />`);
    lines.push(`<path class="relation-hit" data-relation-id="${relation.id}" d="${path}" />`);
    lines.push(
      `<text class="relation-label" x="${labelX}" y="${labelY}">${escapeHtml(parts.join(" | "))}</text>`
    );
  }

  relationsLayer.innerHTML = lines.join("");
  updateFieldHighlights();
  renderRelationsList();
}

function getFieldAnchor(fieldId, side) {
  const row = workspace.querySelector(`[data-field-id="${fieldId}"]`);
  if (!row) {
    return null;
  }

  const workspaceRect = workspace.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const baseX = rowRect.left - workspaceRect.left + workspace.scrollLeft;

  return {
    x: side === "right" ? baseX + rowRect.width : baseX,
    y: rowRect.top - workspaceRect.top + workspace.scrollTop + rowRect.height / 2
  };
}

function renderRelationsList() {
  if (state.relations.length === 0) {
    relationsList.innerHTML = "<p class='hint'>Nenhum relacionamento criado.</p>";
    return;
  }

  relationsList.innerHTML = state.relations
    .map((relation) => {
      const fromEntity = getEntityById(relation.fromId);
      const toEntity = getEntityById(relation.toId);
      const fromField = getFieldNameById(relation.fromFieldId);
      const toField = getFieldNameById(relation.toFieldId);

      return `
        <article class="relation-item">
          <p><strong>${escapeHtml(relation.fkName || "FK")}</strong> (${escapeHtml(relation.type)})</p>
          <p>${escapeHtml(fromEntity?.name || "?")}.${escapeHtml(fromField)} -> ${escapeHtml(toEntity?.name || "?")}.${escapeHtml(toField)}</p>
          <button class="btn btn-small" data-relation-id="${relation.id}">Excluir relacionamento/FK</button>
        </article>
      `;
    })
    .join("");
}

function removeRelationById(relationId) {
  const before = state.relations.length;
  state.relations = state.relations.filter((relation) => relation.id !== relationId);

  if (state.relations.length !== before) {
    drawRelations();
    persistAppState();
    setStatus("Relacionamento e FK removidos.");
  }
}

function updateFieldHighlights() {
  workspace.querySelectorAll(".field-row").forEach((row) => {
    row.classList.remove("fk-source", "fk-target");

    const fkChip = row.querySelector(".fk-chip");
    const fkRemoveButton = row.querySelector(".remove-field-fk");

    if (fkChip) {
      fkChip.hidden = true;
    }

    if (fkRemoveButton) {
      fkRemoveButton.hidden = true;
    }
  });

  for (const relation of state.relations) {
    const sourceRow = workspace.querySelector(`[data-field-id="${relation.fromFieldId}"]`);
    const targetRow = workspace.querySelector(`[data-field-id="${relation.toFieldId}"]`);

    if (sourceRow) {
      sourceRow.classList.add("fk-source");
      const sourceChip = sourceRow.querySelector(".fk-chip");
      const sourceRemoveButton = sourceRow.querySelector(".remove-field-fk");
      if (sourceChip) {
        sourceChip.hidden = false;
      }
      if (sourceRemoveButton) {
        sourceRemoveButton.hidden = false;
      }
    }

    if (targetRow) {
      targetRow.classList.add("fk-target");
    }
  }
}

function syncRelations() {
  const before = state.relations.length;
  const existingEntityIds = new Set(state.entities.map((entity) => entity.id));
  const existingFieldIds = new Set(
    state.entities.flatMap((entity) => entity.fields.map((field) => field.id))
  );

  state.relations = state.relations.filter(
    (relation) =>
      existingEntityIds.has(relation.fromId) &&
      existingEntityIds.has(relation.toId) &&
      existingFieldIds.has(relation.fromFieldId) &&
      existingFieldIds.has(relation.toFieldId)
  );

  if (state.relations.length !== before) {
    persistAppState();
  }
}

function getEntityById(entityId) {
  return state.entities.find((entity) => entity.id === entityId);
}

function adjustEntityCardWidth(entityId) {
  const card = workspace.querySelector(`[data-entity-id="${entityId}"]`);
  if (!card) {
    return;
  }

  card.style.width = "max-content";
  const desiredWidth = clamp(card.scrollWidth + 2, 300, 1800);
  card.style.width = `${desiredWidth}px`;
}

function resizeAllEntityCards() {
  for (const entity of state.entities) {
    adjustEntityCardWidth(entity.id);
  }
}

function getFieldNameById(fieldId) {
  for (const entity of state.entities) {
    const field = entity.fields.find((item) => item.id === fieldId);
    if (field) {
      return field.name;
    }
  }
  return "?";
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
  persistAppState();
}

function initTheme(preferredTheme) {
  const fallback = window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
  applyTheme(preferredTheme || fallback);
}

function persistAppState() {
  const payload = {
    entities: state.entities,
    relations: state.relations,
    theme: getCurrentTheme()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreAppState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw);

    state.entities = Array.isArray(parsed.entities)
      ? parsed.entities.map(normalizeEntity)
      : [];

    state.relations = Array.isArray(parsed.relations)
      ? parsed.relations.map(normalizeRelation)
      : [];

    initTheme(typeof parsed.theme === "string" ? parsed.theme : undefined);

    workspace.querySelectorAll(".entity-card").forEach((card) => card.remove());

    for (const entity of state.entities) {
      renderEntity(entity);
    }

    syncRelations();
    updateEntitySelectors();
    drawRelations();
    resizeAllEntityCards();
    return true;
  } catch {
    return false;
  }
}

function normalizeEntity(entity) {
  return {
    id: typeof entity.id === "string" && entity.id ? entity.id : uid(),
    name:
      typeof entity.name === "string" && entity.name.trim()
        ? entity.name.trim()
        : `tabela_${state.entities.length + 1}`,
    x: Number.isFinite(entity.x) ? entity.x : 40,
    y: Number.isFinite(entity.y) ? entity.y : 40,
    fields:
      Array.isArray(entity.fields) && entity.fields.length > 0
        ? entity.fields.map(normalizeField)
        : [
            { id: uid(), name: "id", type: "INT", pk: true },
            { id: uid(), name: "created_at", type: "DATE", pk: false }
          ]
  };
}

function normalizeField(field) {
  return {
    id: typeof field.id === "string" && field.id ? field.id : uid(),
    name: typeof field.name === "string" && field.name.trim() ? field.name.trim() : "campo",
    type: typeof field.type === "string" && field.type.trim() ? field.type.trim() : "VARCHAR",
    pk: Boolean(field.pk)
  };
}

function normalizeRelation(relation) {
  return {
    id: typeof relation.id === "string" && relation.id ? relation.id : uid(),
    fromId: relation.fromId,
    toId: relation.toId,
    fromFieldId: relation.fromFieldId,
    toFieldId: relation.toFieldId,
    fkName: typeof relation.fkName === "string" ? relation.fkName : "",
    type: typeof relation.type === "string" ? relation.type : "1:N"
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function autoSizeTextControl(input, minCh, maxCh) {
  const text = (input.value || input.placeholder || "").trim();
  const desired = clamp(text.length + 1, minCh, maxCh);
  input.style.width = `${desired}ch`;
}

function autoSizeSelectControl(select, minCh, maxCh) {
  const optionText = select.options[select.selectedIndex]?.text || "";
  const desired = clamp(optionText.length + 2, minCh, maxCh);
  select.style.width = `${desired}ch`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sqlQuoteIdent(name) {
  const clean = String(name).trim();
  if (!clean) {
    return `"campo"`;
  }
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(clean)) {
    return clean;
  }
  return `"${clean.replace(/"/g, '""')}"`;
}

function mapSqlFieldType(fieldType) {
  const t = String(fieldType || "").trim().toUpperCase();
  switch (t) {
    case "INT":
      return "INT";
    case "VARCHAR":
      return "VARCHAR(255)";
    case "TEXT":
      return "TEXT";
    case "DATE":
      return "DATE";
    case "BOOLEAN":
      return "BOOLEAN";
    case "DECIMAL":
      return "DECIMAL(10,2)";
    default:
      return "VARCHAR(255)";
  }
}

function generateSqlDdl() {
  const lines = [];
  if (state.entities.length === 0) {
    lines.push("-- Nenhuma tabela para exportar.");
    return lines.join("\n");
  }

  for (const entity of state.entities) {
    const table = sqlQuoteIdent(entity.name);
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    const pkFields = fields.filter((f) => f.pk);
    const colDefs = [];

    for (const field of fields) {
      const col = sqlQuoteIdent(field.name);
      const typ = mapSqlFieldType(field.type);
      let def = `  ${col} ${typ}`;

      if (pkFields.length === 1 && field.pk) {
        def += " NOT NULL PRIMARY KEY";
      } else if (field.pk) {
        def += " NOT NULL";
      }

      colDefs.push(def);
    }

    if (pkFields.length > 1) {
      const pkCols = pkFields.map((f) => sqlQuoteIdent(f.name)).join(", ");
      colDefs.push(`  PRIMARY KEY (${pkCols})`);
    }

    lines.push(`CREATE TABLE ${table} (`);
    lines.push(colDefs.join(",\n"));
    lines.push(");");
    lines.push("");
  }

  const usedConstraintNames = new Set();

  function uniqueConstraintName(base) {
    const raw = String(base || "fk")
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const sanitized = raw.slice(0, 56) || "fk";
    let name = sanitized;
    let i = 2;
    while (usedConstraintNames.has(name)) {
      name = `${sanitized}_${i++}`;
    }
    usedConstraintNames.add(name);
    return name;
  }

  for (const rel of state.relations) {
    const fromEnt = getEntityById(rel.fromId);
    const toEnt = getEntityById(rel.toId);
    if (!fromEnt || !toEnt) {
      continue;
    }

    const fromField = fromEnt.fields.find((f) => f.id === rel.fromFieldId);
    const toField = toEnt.fields.find((f) => f.id === rel.toFieldId);
    if (!fromField || !toField) {
      continue;
    }

    const fromTable = sqlQuoteIdent(fromEnt.name);
    const toTable = sqlQuoteIdent(toEnt.name);
    const fromCol = sqlQuoteIdent(fromField.name);
    const toCol = sqlQuoteIdent(toField.name);

    let baseName = (rel.fkName || "").trim();
    if (!baseName) {
      baseName = `fk_${fromEnt.name}_${fromField.name}_${toEnt.name}`;
    }
    const fkCname = uniqueConstraintName(baseName);

    if (rel.type === "N:N") {
      lines.push(
        `-- N:N (${fromEnt.name}.${fromField.name} -> ${toEnt.name}.${toField.name}): em muitos modelos é necessária uma tabela de junção; a FK abaixo reflete o vínculo configurado.`
      );
    }

    if (rel.type === "1:1") {
      const uqBase = `uq_${fromEnt.name}_${fromField.name}`;
      const uqCname = uniqueConstraintName(uqBase);
      lines.push(
        `ALTER TABLE ${fromTable} ADD CONSTRAINT ${sqlQuoteIdent(uqCname)} UNIQUE (${fromCol});`
      );
    }

    lines.push(
      `ALTER TABLE ${fromTable} ADD CONSTRAINT ${sqlQuoteIdent(fkCname)} FOREIGN KEY (${fromCol}) REFERENCES ${toTable} (${toCol});`
    );
    lines.push("");
  }

  return lines.join("\n");
}

const restored = restoreAppState();
if (!restored) {
  initTheme();
  updateEntitySelectors();
  drawRelations();
  setStatus("Sem tabelas iniciais. Dê 2 cliques no espaço em branco para criar uma tabela.");
  persistAppState();
} else if (state.entities.length === 0) {
  setStatus("Projeto carregado sem tabelas. Dê 2 cliques no espaço em branco para criar.");
} else {
  setStatus("Projeto carregado do localStorage.");
}
