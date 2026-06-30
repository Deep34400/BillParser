import { prisma } from '../src/config/db.js';
async function main() {
  const invoices = await prisma.invoice.findMany({ select: { vendorName: true, fileName: true, rawText: true } });
  for (const inv of invoices) {
    const lines = (inv.rawText ?? '').split(/\r?\n/).filter((l) => /taxable\s*amount|tax\s*inclusive/i.test(l));
    if (lines.length) {
      console.log('\n### ' + inv.vendorName + ' | ' + inv.fileName);
      for (const l of lines) console.log('   ' + l.trim().slice(0, 140));
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(2); });
