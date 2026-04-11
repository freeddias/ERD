/**
 * Gera DDL SQLite a partir do mesmo formato de estado do diagramador (entities + relations).
 * Usado pela página playground.html.
 */
(function (global) {
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

  function mapSqliteFieldType(fieldType) {
    const t = String(fieldType || "").trim().toUpperCase();
    switch (t) {
      case "INT":
        return "INTEGER";
      case "VARCHAR":
        return "VARCHAR(255)";
      case "TEXT":
        return "TEXT";
      case "DATE":
        return "TEXT";
      case "DATETIME":
        return "TEXT";
      case "BOOLEAN":
        return "INTEGER";
      case "DECIMAL":
        return "NUMERIC";
      default:
        return "TEXT";
    }
  }

  function getEntityById(entityId, entities) {
    return entities.find((entity) => entity.id === entityId);
  }

  function generateSqliteDdl(state) {
    const entities = Array.isArray(state?.entities) ? state.entities : [];
    const relations = Array.isArray(state?.relations) ? state.relations : [];

    const lines = [];
    if (entities.length === 0) {
      lines.push("-- Nenhuma tabela para exportar.");
      return lines.join("\n");
    }

    for (const entity of entities) {
      const table = sqlQuoteIdent(entity.name);
      const fields = Array.isArray(entity.fields) ? entity.fields : [];
      const pkFields = fields.filter((f) => f.pk);
      const colDefs = [];

      for (const field of fields) {
        const col = sqlQuoteIdent(field.name);
        const typ = mapSqliteFieldType(field.type);
        const isInt = typ === "INTEGER";
        const parts = [];

        if (pkFields.length === 1 && field.pk) {
          parts.push("NOT NULL");
          parts.push("PRIMARY KEY");
          if (field.autoIncrement && isInt) {
            parts.push("AUTOINCREMENT");
          }
        } else if (field.pk) {
          parts.push("NOT NULL");
        } else {
          if (field.notNull) {
            parts.push("NOT NULL");
          }
          if (field.unique) {
            parts.push("UNIQUE");
          }
        }

        let def = `  ${col} ${typ}`;
        if (parts.length > 0) {
          def += ` ${parts.join(" ")}`;
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

    for (const rel of relations) {
      const fromEnt = getEntityById(rel.fromId, entities);
      const toEnt = getEntityById(rel.toId, entities);
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

  global.ErdSqliteDdl = { generateSqliteDdl };
})(typeof window !== "undefined" ? window : global);
