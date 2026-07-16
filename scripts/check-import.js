const fs = require("fs");
const path = require("path");
const os = require("os");
const { createDatabase } = require("../src/main/database/database");
const { importWorkbook } = require("../src/main/import/smart-importer");

(async () => {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    console.error("Usage: npm run check-import -- \"C:\\path\\to\\employee-file.xlsx\"");
    process.exit(1);
  }

  if (!fs.existsSync(workbookPath)) {
    console.error(`File not found: ${workbookPath}`);
    process.exit(1);
  }

  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-manager-import-check-"));
  const db = await createDatabase(tempDbDir);

  try {
    const summary = importWorkbook(workbookPath, db);
    console.log("Import check passed.");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Import check failed.");
    console.error(error.message);
    process.exit(1);
  }
})();
