const PDFParser = require('pdf2json');
const p = new PDFParser(null, 1);
p.on('pdfParser_dataReady', () => { process.stdout.write(p.getRawTextContent()); });
p.on('pdfParser_dataError', e => { console.error(e); });
p.loadPDF(process.argv[2]);
