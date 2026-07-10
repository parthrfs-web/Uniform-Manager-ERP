const { inspectWorkbook, parseCandidate } = require("./smart-importer");

process.on("message", (message) => {
  if (!message || typeof message !== 'object') return;

  try {
    if (message.type === "inspect-workbook") {
      const inspection = inspectWorkbook(message.filePath);
      
      // STRICT SHAPE ENFORCEMENT
      const safeInspection = inspection || {};
      safeInspection.fileName = safeInspection.fileName || "";
      safeInspection.filePath = safeInspection.filePath || "";
      safeInspection.candidates = Array.isArray(safeInspection.candidates) ? safeInspection.candidates : [];

      process.send({ ok: true, inspection: safeInspection });
      return;
    }

    if (message.type === "parse-workbook") {
      const parsed = parseCandidate(message.filePath, message.sheetName || null);
      
      // STRICT SHAPE ENFORCEMENT
      const safeParsed = parsed || {};
      safeParsed.summary = safeParsed.summary || {};
      safeParsed.worksheetRows = Array.isArray(safeParsed.worksheetRows) ? safeParsed.worksheetRows : [];
      safeParsed.employees = Array.isArray(safeParsed.employees) ? safeParsed.employees : [];
      safeParsed.reviews = Array.isArray(safeParsed.reviews) ? safeParsed.reviews : [];
      safeParsed.uniformIssues = Array.isArray(safeParsed.uniformIssues) ? safeParsed.uniformIssues : [];
      safeParsed.headerReport = safeParsed.headerReport || {};

      process.send({ ok: true, parsed: safeParsed });
    }
  } catch (error) {
    process.send({
      ok: false,
      error: {
        message: error.message || "Import failed.",
        stack: error.stack || "",
      },
    });
  }
});