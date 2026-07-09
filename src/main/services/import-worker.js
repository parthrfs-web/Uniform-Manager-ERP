const { inspectWorkbook, parseCandidate } = require("./smart-importer");

process.on("message", (message) => {
  if (!message) return;

  try {
    if (message.type === "inspect-workbook") {
      process.send({ ok: true, inspection: inspectWorkbook(message.filePath) });
      return;
    }

    if (message.type === "parse-workbook") {
      const parsed = parseCandidate(message.filePath, message.sheetName || null);
      process.send({ ok: true, parsed });
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
