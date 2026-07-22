const { dialog } = require('electron');
const XLSX = require('xlsx');
const fs = require('fs');

async function exportToExcel(window, config) {
    const { filename, sheetName, headers, data } = config;

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Export to Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    try {
        const wb = XLSX.utils.book_new();
        const wsData = [headers, ...data];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        const colWidths = headers.map((header, colIndex) => {
            let maxLen = header.toString().length;
            data.forEach(row => {
                const cellVal = row[colIndex] ? row[colIndex].toString() : "";
                if (cellVal.length > maxLen) maxLen = cellVal.length;
            });
            return { wch: Math.min(maxLen + 2, 50) };
        });
        ws['!cols'] = colWidths;
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        XLSX.utils.book_append_sheet(wb, ws, sheetName || "Export");
        XLSX.writeFile(wb, filePath);

        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate Excel file: " + error.message);
    }
}

async function exportAnalyticsExcel(window, config) {
    const { filename, sheetName, reportTitle, filtersUsed, generatedDate, summary, headers, data } = config;

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Export Analytics to Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    try {
        const wsData = [];
        
        wsData.push([reportTitle]);
        wsData.push(["Generated At:", generatedDate]);
        wsData.push([]);
        
        wsData.push(["--- FILTERS USED ---"]);
        for (const [k, v] of Object.entries(filtersUsed)) {
            wsData.push([k, v]);
        }
        wsData.push([]);
        
        wsData.push(["--- SUMMARY ---"]);
        for (const [k, v] of Object.entries(summary)) {
            wsData.push([k, v]);
        }
        wsData.push([]);
        
        const headerRowIndex = wsData.length;
        wsData.push(headers);
        wsData.push(...data);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        const colWidths = headers.map((header, colIndex) => {
            let maxLen = header.toString().length;
            data.forEach(row => {
                const cellVal = row[colIndex] ? row[colIndex].toString() : "";
                if (cellVal.length > maxLen) maxLen = cellVal.length;
            });
            return { wch: Math.min(Math.max(maxLen + 2, 12), 50) };
        });
        ws['!cols'] = colWidths;
        
        ws['!views'] = [{ state: 'frozen', ySplit: headerRowIndex + 1 }];

        XLSX.utils.book_append_sheet(wb, ws, sheetName || "Analytics");
        XLSX.writeFile(wb, filePath);

        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate Analytics Excel file: " + error.message);
    }
}

// NEW REQUIREMENT: Support exporting the specific Decision Register as a clean, text-based PDF
function writeTextPdf(filePath, lines) {
    const pageLineCount = 46;
    const pages = [];
    for (let index = 0; index < lines.length; index += pageLineCount) {
        pages.push(lines.slice(index, index + pageLineCount));
    }
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
    const pageRefs = pages.map((_, index) => `${3 + (index * 2)} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
    pages.forEach((pageLines, pageIndex) => {
        const pageObjectId = 3 + (pageIndex * 2);
        const contentObjectId = pageObjectId + 1;
        const escaped = pageLines.map((line) => String(line).replace(/[\\()]/g, "\\$&"));
        const textCommands = escaped
            .map((line, lineIndex) => `BT /F1 9 Tf 36 ${800 - (lineIndex * 15)} Td (${line}) Tj ET`)
            .join("\n");
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${3 + (pages.length * 2)} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
        objects.push(`<< /Length ${Buffer.byteLength(textCommands, "utf8")} >>\nstream\n${textCommands}\nendstream`);
    });
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf, "utf8"));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    fs.writeFileSync(filePath, pdf);
}

async function exportDecisionRegisterPdf(window, config) {
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Export Monthly Review Decision Register to PDF',
        defaultPath: config.filename,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    try {
        writeTextPdf(filePath, config.lines);
        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate PDF file: " + error.message);
    }
}

module.exports = { exportToExcel, exportAnalyticsExcel, exportDecisionRegisterPdf };